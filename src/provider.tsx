import React, {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AuthioError } from "@useauthio/node";
import { authioFetch } from "./fetch";
import { createDefaultVerifier, readJwtExp } from "./jwt";
import { ActivityTracker } from "./activity";
import { RefreshScheduler } from "./refresh";
import { isBrowser } from "./ssr";
import { createTokenStorage, type TokenStorage } from "./storage";
import { mintLobbySignInUrl } from "./lobby-context";
import { noopEmitter, type TelemetryEmitter } from "./telemetry";
import {
  coerceSessionPolicy,
  type AuthioContextValue,
  type AuthioProviderProps,
  type AuthioStatus,
  type AuthioTokenVerifier,
  type AuthioUser,
  type RawSessionPolicy,
  type SessionPolicy,
} from "./types";

export const AuthioContext = createContext<AuthioContextValue | null>(null);
AuthioContext.displayName = "AuthioContext";

interface RefreshEnvelope {
  access_token?: string;
  refresh_token?: string;
  expires_at?: string;
  user?: RawUser | null;
  session_policy?: RawSessionPolicy;
}

/**
 * Grace window around a refresh inside which user activity still counts
 * as "after" it. The tracker throttles writes to 1/s, so an interaction
 * landing just after a refresh may carry a timestamp just before it;
 * we err toward refreshing.
 */
const ACTIVITY_GRACE_MS = 1000;

interface RawUser {
  id?: string;
  user_id?: string;
  email?: string;
  emailVerified?: boolean;
  email_verified?: boolean;
  name?: string;
  avatarUrl?: string;
  avatar_url?: string;
}

const DEFAULT_REFRESH_LEAD = 60;
const DEFAULT_AUDIENCE = "authio";
/** Canonical Lobby (hosted UI) — not the auth-core identity API. */
export const DEFAULT_SIGN_IN_URL = "https://lobby.authio.com/";

/**
 * Top-level context provider. Wrap your app once at the root:
 *
 * ```tsx
 * <AuthioProvider apiUrl="https://auth-api.authio.com" projectId="proj_…">
 *   <App />
 * </AuthioProvider>
 * ```
 *
 * Lifecycle:
 *
 *   1. Mount → status `loading`. Issue a `POST /v1/auth/refresh`
 *      with `credentials: include`. Auth-core uses the BFF cookie to
 *      mint a fresh access token (or 401 if no session).
 *   2. On success: verify the token, stash it per `storage` mode,
 *      schedule the next silent refresh `refreshLeadSeconds` before
 *      `exp`. Status → `authenticated`.
 *   3. On failure: status → `unauthenticated`. The app shows its
 *      sign-in surface; `signIn()` redirects to the hosted UI.
 *
 * The refresh token is NEVER touched from JavaScript — it rides the
 * BFF cookie exclusively. The access token is in-memory by default.
 */
export function AuthioProvider(props: AuthioProviderProps): React.ReactElement {
  const {
    apiUrl,
    projectId,
    storage: storageMode = "memory",
    refreshLeadSeconds = DEFAULT_REFRESH_LEAD,
    idleRefresh = "defer",
    onTelemetryEvent,
    fetch: fetchImpl,
    signInUrl,
    jwtIssuer,
    jwtAudience = DEFAULT_AUDIENCE,
    verifyToken,
    skipInitialRefresh,
    children,
  } = props;

  const emit: TelemetryEmitter = onTelemetryEvent ?? noopEmitter;

  // We deliberately hold storage + verifier + scheduler in refs so a
  // re-render of the provider (parent re-render) doesn't tear them
  // down. They're created once per "shape" of provider props.
  const storageRef = useRef<TokenStorage | null>(null);
  if (storageRef.current === null) {
    storageRef.current = createTokenStorage(storageMode);
  }

  const verifierRef = useRef<AuthioTokenVerifier | null>(null);
  if (verifierRef.current === null) {
    verifierRef.current =
      verifyToken ??
      createDefaultVerifier(
        apiUrl,
        jwtIssuer ?? apiUrl.replace(/\/$/, ""),
        jwtAudience,
      );
  }

  // Keep mutable refs to the latest props so closures captured by
  // the scheduler / async refresh loops always see fresh values.
  const propsRef = useRef({
    apiUrl,
    projectId,
    fetchImpl,
    signInUrl,
    emit,
    idleRefresh,
  });
  propsRef.current = { apiUrl, projectId, fetchImpl, signInUrl, emit, idleRefresh };

  // User-activity tracker + the two timestamps the idle-deferral rule
  // compares. Refs, not state: the scheduler reads them from a timer
  // callback and a re-render must never re-create the tracker.
  const activityRef = useRef<ActivityTracker | null>(null);
  // Lazily (re)created so a StrictMode double-mount, which destroys the
  // tracker in the simulated unmount, gets a fresh one on the re-run.
  const getTracker = useCallback((): ActivityTracker => {
    if (activityRef.current === null) {
      activityRef.current = new ActivityTracker();
    }
    return activityRef.current;
  }, []);
  const lastRefreshAtRef = useRef(0);
  const policyRef = useRef<SessionPolicy | null>(null);

  useEffect(() => {
    if (!projectId) {
      console.warn(
        "[@useauthio/react] AuthioProvider projectId is missing — auth-core calls and Lobby sign-in will fail. Set projectId=\"proj_…\" on <AuthioProvider>.",
      );
    }
  }, [projectId]);

  const schedulerRef = useRef<RefreshScheduler | null>(null);

  // Optional in-memory refresh token. React's canonical refresh path is the
  // same-origin BFF HttpOnly cookie (performRefresh posts with
  // credentials: "include"). But a pure SPA completing a magic-link/passkey
  // sign-in via handleSignInResult may receive a refresh token directly
  // (e.g. from the callback redirect URL) with no cookie available; we hold
  // it here, memory-only (never web-storage), and send it in the refresh
  // body as a fallback. Mirrors @useauthio/vue's state.ts.
  const refreshTokenRef = useRef<string | null>(null);

  const [user, setUser] = useState<AuthioUser | null>(null);
  const [status, setStatus] = useState<AuthioStatus>(
    skipInitialRefresh ? "unauthenticated" : "loading",
  );
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [sessionPolicy, setSessionPolicy] = useState<SessionPolicy | null>(null);

  /** Adopt a policy from an envelope and mark "refreshed now". */
  const adoptPolicy = useCallback((policy: SessionPolicy | null) => {
    policyRef.current = policy;
    setSessionPolicy(policy);
    lastRefreshAtRef.current = Date.now();
  }, []);

  const clearPolicy = useCallback(() => {
    policyRef.current = null;
    setSessionPolicy(null);
    lastRefreshAtRef.current = 0;
  }, []);

  /**
   * Single refresh attempt. Returns `true` on success (state has
   * been updated to authenticated), `false` on any failure (caller
   * decides what to do with the failure — initial mount transitions
   * to unauthenticated, scheduler backs off).
   */
  const performRefresh = useCallback(async (): Promise<boolean> => {
    const p = propsRef.current;
    try {
      const env = await authioFetch<RefreshEnvelope>({
        apiUrl: p.apiUrl,
        projectId: p.projectId,
        path: "/v1/auth/refresh",
        method: "POST",
        body: refreshTokenRef.current
          ? { refresh_token: refreshTokenRef.current }
          : {},
        credentials: "include",
        fetchImpl: p.fetchImpl,
      });
      if (env.refresh_token) refreshTokenRef.current = env.refresh_token;
      const token = env.access_token;
      if (!token) {
        p.emit({
          kind: "refresh_failed",
          timestamp: Date.now(),
          reason: "missing_access_token",
          attempt: 0,
        });
        return false;
      }
      const verification = await verifierRef.current!(token).catch(() => null);
      if (!verification) {
        p.emit({
          kind: "token_rejected",
          timestamp: Date.now(),
          reason: "verification_failed",
        });
        p.emit({
          kind: "refresh_failed",
          timestamp: Date.now(),
          reason: "verification_failed",
          attempt: 0,
        });
        return false;
      }
      p.emit({
        kind: "token_verified",
        timestamp: Date.now(),
        subject: verification.subject,
      });
      storageRef.current!.set(token);
      setAccessToken(token);
      if (env.user) setUser(coerceUser(env.user));
      setStatus("authenticated");
      // Older auth-core omits session_policy; keep whatever we last saw
      // rather than flapping to null and re-enabling timer refresh.
      adoptPolicy(
        env.session_policy !== undefined
          ? coerceSessionPolicy(env.session_policy)
          : policyRef.current,
      );
      p.emit({
        kind: "refresh_succeeded",
        timestamp: Date.now(),
        expiresAt: verification.expiresAt,
      });
      const exp = verification.expiresAt ?? readJwtExp(token);
      if (exp !== null && exp !== undefined) {
        schedulerRef.current?.scheduleAt(exp);
      }
      return true;
    } catch (err) {
      const httpStatus = err instanceof AuthioError ? err.status : undefined;
      const reason =
        err instanceof Error ? err.message : "refresh_failed_unknown";
      p.emit({
        kind: "refresh_failed",
        timestamp: Date.now(),
        reason,
        status: httpStatus,
        attempt: 0,
      });
      return false;
    }
  }, [adoptPolicy]);

  // Re-spin the scheduler whenever the lead window changes.
  useEffect(() => {
    const scheduler = new RefreshScheduler({
      leadSeconds: refreshLeadSeconds,
      run: performRefresh,
      onGiveUp: () => {
        storageRef.current!.clear();
        refreshTokenRef.current = null;
        clearPolicy();
        setAccessToken(null);
        setUser(null);
        setStatus("unauthenticated");
      },
      onScheduled: (runAt) =>
        propsRef.current.emit({
          kind: "refresh_scheduled",
          timestamp: Date.now(),
          runAt,
        }),
      // Idle rule: hold the timer refresh when the effective policy has
      // an inactivity timeout and the user hasn't touched the page since
      // the last refresh. Without a policy (legacy projects, old
      // auth-core) this is never true and behaviour is unchanged.
      shouldDefer: () => {
        if (propsRef.current.idleRefresh === "always") return false;
        const policy = policyRef.current;
        if (!policy || policy.idleTimeoutMin <= 0) return false;
        const lastActivity = getTracker().lastActivityAt();
        return lastActivity + ACTIVITY_GRACE_MS < lastRefreshAtRef.current;
      },
      onDeferred: (reason) =>
        propsRef.current.emit({
          kind: "refresh_deferred",
          timestamp: Date.now(),
          reason,
        }),
    });
    schedulerRef.current = scheduler;
    // The next interaction after an idle deferral re-arms the timer —
    // immediately, if the token is already inside its lead window.
    const tracker = getTracker();
    const unsubscribe = tracker.onActivity(() => {
      if (scheduler.deferredReason() !== "idle") return;
      propsRef.current.emit({ kind: "refresh_resumed", timestamp: Date.now() });
      scheduler.resume();
    });
    return () => {
      unsubscribe();
      scheduler.destroy();
      if (schedulerRef.current === scheduler) schedulerRef.current = null;
    };
  }, [refreshLeadSeconds, performRefresh, clearPolicy, getTracker]);

  // Tear the activity tracker down with the provider.
  useEffect(() => {
    const tracker = getTracker();
    return () => {
      tracker.destroy();
      if (activityRef.current === tracker) activityRef.current = null;
    };
  }, [getTracker]);

  // Initial bootstrap.
  useEffect(() => {
    if (skipInitialRefresh) {
      // We still try to use a stored token if one is present — that
      // way `skipInitialRefresh` plus a `localStorage` token lets a
      // test or SSR-hydrated app come back authenticated without
      // hitting the network.
      const stored = storageRef.current!.get();
      if (!stored) return;
      let mounted = true;
      (async () => {
        const verification = await verifierRef.current!(stored).catch(
          () => null,
        );
        if (!mounted) return;
        if (!verification) {
          storageRef.current!.clear();
          setStatus("unauthenticated");
          return;
        }
        propsRef.current.emit({
          kind: "token_verified",
          timestamp: Date.now(),
          subject: verification.subject,
        });
        setAccessToken(stored);
        setStatus("authenticated");
        const exp = verification.expiresAt ?? readJwtExp(stored);
        if (exp !== null && exp !== undefined) {
          schedulerRef.current?.scheduleAt(exp);
        }
      })();
      return () => {
        mounted = false;
      };
    }
    if (!isBrowser()) {
      setStatus("unauthenticated");
      return;
    }
    let mounted = true;
    const stored = storageRef.current!.get();
    if (stored) {
      (async () => {
        const verification = await verifierRef.current!(stored).catch(
          () => null,
        );
        if (!mounted) return;
        if (verification) {
          propsRef.current.emit({
            kind: "token_verified",
            timestamp: Date.now(),
            subject: verification.subject,
          });
          setAccessToken(stored);
          setStatus("authenticated");
          const exp = verification.expiresAt ?? readJwtExp(stored);
          if (exp !== null && exp !== undefined) {
            schedulerRef.current?.scheduleAt(exp);
          }
          return;
        }
        propsRef.current.emit({
          kind: "token_rejected",
          timestamp: Date.now(),
          reason: "stored_token_invalid",
        });
        storageRef.current!.clear();
        const ok = await performRefresh();
        if (!ok && mounted) setStatus("unauthenticated");
      })();
      return () => {
        mounted = false;
      };
    }
    (async () => {
      const ok = await performRefresh();
      if (!ok && mounted) setStatus("unauthenticated");
    })();
    return () => {
      mounted = false;
    };
  }, [skipInitialRefresh, performRefresh]);

  const getAccessToken = useCallback(async (): Promise<string | null> => {
    if (accessToken) {
      const exp = readJwtExp(accessToken);
      const now = Math.floor(Date.now() / 1000);
      if (exp !== null && exp - now > 10) return accessToken;
    }
    const ok = await performRefresh();
    return ok ? storageRef.current!.get() : null;
  }, [accessToken, performRefresh]);

  const signIn = useCallback((opts: { returnTo?: string } = {}) => {
    void (async () => {
      const p = propsRef.current;
      p.emit({
        kind: "sign_in_started",
        timestamp: Date.now(),
        method: "redirect",
      });
      if (!isBrowser()) return;
      if (!p.projectId) {
        console.warn(
          "[@useauthio/react] AuthioProvider projectId is missing — Lobby cannot resolve your project. Set projectId=\"proj_…\" on <AuthioProvider>.",
        );
      }
      const url = await mintLobbySignInUrl({
        apiUrl: p.apiUrl,
        projectId: p.projectId,
        hostedUiUrl: p.signInUrl ?? DEFAULT_SIGN_IN_URL,
        redirectUri: opts.returnTo ?? window.location.href,
        fetchImpl: p.fetchImpl,
      });
      window.location.assign(url);
    })();
  }, []);

  const signOut = useCallback(async (): Promise<void> => {
    const p = propsRef.current;
    const token = storageRef.current!.get();
    try {
      await authioFetch({
        apiUrl: p.apiUrl,
        projectId: p.projectId,
        path: "/v1/auth/sign-out",
        method: "POST",
        body: {},
        credentials: "include",
        extraHeaders: token ? { Authorization: `Bearer ${token}` } : {},
        fetchImpl: p.fetchImpl,
      });
    } catch {
      // Best-effort. Local state still clears below — the worst case
      // is the row outlives the local token, which is the pre-revocation
      // baseline anyway.
    } finally {
      storageRef.current!.clear();
      refreshTokenRef.current = null;
      schedulerRef.current?.clear();
      clearPolicy();
      setAccessToken(null);
      setUser(null);
      setStatus("unauthenticated");
      p.emit({ kind: "sign_out", timestamp: Date.now() });
    }
  }, [clearPolicy]);

  const refresh = useCallback(
    (): Promise<boolean> => performRefresh(),
    [performRefresh],
  );

  const handleSignInResult = useCallback(
    async (input: {
      accessToken: string;
      refreshToken?: string | null;
      user?: AuthioUser | null;
      sessionPolicy?: SessionPolicy | null;
    }): Promise<void> => {
      const p = propsRef.current;
      const verification = await verifierRef
        .current!(input.accessToken)
        .catch(() => null);
      if (!verification) {
        p.emit({
          kind: "token_rejected",
          timestamp: Date.now(),
          reason: "handoff_verification_failed",
        });
        // Leave the session unauthenticated and surface the rejection so
        // the caller can show an error rather than silently swallowing it.
        storageRef.current!.clear();
        refreshTokenRef.current = null;
        setAccessToken(null);
        setUser(null);
        setStatus("unauthenticated");
        throw new AuthioError({
          code: "token_rejected",
          message: "Authio rejected the handed-off access token signature.",
          status: 0,
        });
      }
      if (input.refreshToken) refreshTokenRef.current = input.refreshToken;
      p.emit({
        kind: "token_verified",
        timestamp: Date.now(),
        subject: verification.subject,
      });
      storageRef.current!.set(input.accessToken);
      setAccessToken(input.accessToken);
      if (input.user) setUser(input.user);
      setStatus("authenticated");
      adoptPolicy(
        input.sessionPolicy !== undefined ? input.sessionPolicy : policyRef.current,
      );
      p.emit({
        kind: "sign_in_completed",
        timestamp: Date.now(),
        method: "magic_link",
      });
      const exp = verification.expiresAt ?? readJwtExp(input.accessToken);
      if (exp !== null && exp !== undefined) {
        schedulerRef.current?.scheduleAt(exp);
      }
    },
    [adoptPolicy],
  );

  const resolvedSignInUrl = signInUrl ?? DEFAULT_SIGN_IN_URL;

  const value = useMemo<AuthioContextValue>(
    () => ({
      user,
      status,
      accessToken,
      sessionPolicy,
      apiUrl,
      projectId,
      signInUrl: resolvedSignInUrl,
      fetchImpl,
      getAccessToken,
      signIn,
      signOut,
      refresh,
      handleSignInResult,
    }),
    [
      user,
      status,
      accessToken,
      sessionPolicy,
      apiUrl,
      projectId,
      resolvedSignInUrl,
      fetchImpl,
      getAccessToken,
      signIn,
      signOut,
      refresh,
      handleSignInResult,
    ],
  );

  return (
    <AuthioContext.Provider value={value}>{children}</AuthioContext.Provider>
  );
}

function coerceUser(raw: RawUser): AuthioUser {
  return {
    id: String(raw.id ?? raw.user_id ?? ""),
    email: String(raw.email ?? ""),
    emailVerified: Boolean(raw.emailVerified ?? raw.email_verified ?? false),
    name: raw.name ?? undefined,
    avatarUrl: raw.avatarUrl ?? raw.avatar_url ?? undefined,
  };
}
