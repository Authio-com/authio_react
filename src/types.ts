import type { ReactNode } from "react";
import type { AuthioTelemetryEvent } from "./telemetry";

/**
 * Minimal user shape consumed by `@useauthio/react`. We deliberately
 * keep this lean so the SPA doesn't need to know about org pivots,
 * memberships, etc. Customers that need richer data fetch
 * `/v1/users/me` (or similar) from their own UI layer using
 * `getAccessToken()`.
 */
export interface AuthioUser {
  id: string;
  email: string;
  emailVerified: boolean;
  name?: string;
  avatarUrl?: string;
}

/**
 * The provider walks through three states:
 *   - `loading`         — initial mount; we're trying to refresh
 *                         against the BFF cookie before showing UI.
 *   - `authenticated`   — a verified access token is in memory.
 *   - `unauthenticated` — no session; show your sign-in surface.
 */
export type AuthioStatus = "loading" | "authenticated" | "unauthenticated";

export type AuthioStorageMode =
  | "memory"
  | "localStorage"
  | "sessionStorage"
  | "none";

export interface AuthioContextValue {
  user: AuthioUser | null;
  status: AuthioStatus;
  accessToken: string | null;
  /**
   * Returns the current access token, silently refreshing if it's
   * within 10 seconds of expiry. Returns `null` when no session
   * is available (the caller should `signIn()` or show the
   * unauthenticated UI).
   */
  getAccessToken: () => Promise<string | null>;
  /**
   * Navigates the tab to the auth-core hosted sign-in UI. Pass
   * `returnTo` to specify the URL the user lands back on after
   * sign-in completes; defaults to the current `window.location.href`.
   */
  signIn: (opts?: { returnTo?: string }) => void;
  /**
   * Best-effort revokes the session against auth-core and clears
   * the local in-memory / web-storage access token.
   */
  signOut: () => Promise<void>;
  /**
   * Forces a refresh now. Resolves `true` on success (state is
   * authenticated), `false` on failure (state is unauthenticated).
   */
  refresh: () => Promise<boolean>;
  /**
   * Hand a freshly-obtained `(accessToken, refreshToken?, user?)` triple to
   * the SDK — e.g. after a magic-link callback redirect lands on your SPA
   * with `?access_token=…&refresh_token=…` in the URL, or after
   * `signInWithPasskey()` resolves. Verifies the access token against the
   * live JWKS, adopts it into provider state (status → `authenticated`),
   * persists it per the `storage` mode, and (re-)arms the silent-refresh
   * scheduler.
   *
   * This is the client-side token-handoff a pure SPA needs when it does
   * NOT have a same-origin BFF refresh cookie to bootstrap from. Throws
   * `AuthioError` (code `token_rejected`) when the token fails
   * verification; state is left `unauthenticated`.
   *
   * ```tsx
   * const { handleSignInResult } = useAuthio();
   * // on your /auth/callback page:
   * const p = new URLSearchParams(window.location.search);
   * const accessToken = p.get("access_token");
   * if (accessToken) {
   *   await handleSignInResult({ accessToken, refreshToken: p.get("refresh_token") });
   * }
   * ```
   */
  handleSignInResult: (input: {
    accessToken: string;
    refreshToken?: string | null;
    user?: AuthioUser | null;
  }) => Promise<void>;
}

/** Result of a single JWT verification attempt. */
export interface AuthioTokenVerification {
  /** The verified token's subject (`sub` claim). */
  subject: string;
  /** Optional expiry (unix seconds) — used to schedule the next refresh. */
  expiresAt?: number;
}

export type AuthioTokenVerifier = (
  token: string,
) => Promise<AuthioTokenVerification | null>;

export interface AuthioProviderProps {
  /** Authio auth-core base URL, e.g. `"https://auth-api.authio.com"`. */
  apiUrl: string;
  /** Project ID (`proj_…`). Dashboard environment ID; API field `project_id`. Sent as `X-Authio-Project` on every call. */
  projectId: string;
  /**
   * Where the access token lives. Defaults to `"memory"`. NEVER stores
   * the refresh token in JS-accessible storage regardless of this
   * setting — the refresh token rides only the BFF cookie. See
   * README §Security considerations for the XSS-tradeoff discussion
   * around `localStorage` and `sessionStorage`.
   */
  storage?: AuthioStorageMode;
  /**
   * How many seconds before `exp` to schedule the silent refresh.
   * Defaults to 60. The refresh fires lazily — if the tab is hidden
   * we defer until `visibilitychange` so we don't waste battery on
   * a background tab.
   */
  refreshLeadSeconds?: number;
  /**
   * Optional sink for SDK telemetry (refresh outcomes, sign-in
   * starts/completes, token verification results). Useful for
   * Sentry / Datadog wiring. The SDK never phones home by default —
   * if you don't pass this, no events are emitted.
   */
  onTelemetryEvent?: (event: AuthioTelemetryEvent) => void;
  /** Inject a custom `fetch` implementation. Defaults to `globalThis.fetch`. */
  fetch?: typeof fetch;
  /**
   * Override the Lobby (hosted UI) sign-in URL. Defaults to
   * `https://lobby.authio.com/`. Customers running a custom Authio
   * domain (e.g. `auth.acme.com`) point this at their hosted UI.
   */
  signInUrl?: string;
  /**
   * JWT issuer to require during verification. Defaults to `apiUrl`.
   * Auth-core mints tokens with `iss` set to its own public origin.
   */
  jwtIssuer?: string;
  /** JWT audience to require. Defaults to `"authio"`. */
  jwtAudience?: string;
  /**
   * Override the JWT verification step. Default uses `JwtVerifier`
   * from `@useauthio/node` (EdDSA-pinned, refuses `alg: none`). Pass a
   * custom verifier for tests or to use a pre-distributed JWKS.
   * Failure (resolved `null` or thrown) discards the token and
   * transitions to `unauthenticated`.
   */
  verifyToken?: AuthioTokenVerifier;
  /**
   * When `true`, skips the initial refresh attempt on mount and
   * starts in the `unauthenticated` state. Useful in tests and in
   * SSR-rendered pages that hydrate without a session.
   */
  skipInitialRefresh?: boolean;
  children: ReactNode;
}
