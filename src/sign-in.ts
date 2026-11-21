import { AuthioError } from "@useauthio/node";
import { authioFetch } from "./fetch";
import {
  AUTHIO_MESSAGES,
  riskDecisionError,
  type RiskDecisionBody,
} from "./errors";
import {
  deviceSignalsExtraHeaders,
  type DeviceSignalsCapture,
} from "./device-signals";
import { isBrowser } from "./ssr";
import type { ClientLocationCapture } from "./locate";
import {
  coerceSessionPolicy,
  type AuthioUser,
  type RawSessionPolicy,
  type SessionPolicy,
} from "./types";

export interface SignInWithMagicLinkOptions {
  /** Authio auth-core base URL. */
  apiUrl: string;
  /** Project ID (`proj_…`). */
  projectId: string;
  /** Email address to send the magic-link to. */
  email: string;
  /**
   * URL on the SPA the magic-link click-through should land on.
   * Auth-core will redirect there with the access token in the URL
   * after the user clicks the link in their inbox.
   */
  redirectUri: string;
  /** Opaque, consent-gated proof minted by @useauthio/xray. */
  xrayVisitorProof?: string;
  signal?: AbortSignal;
  fetch?: typeof fetch;
}

/**
 * POSTs `/v1/auth/magic-link/send`. Top-level helper, intentionally
 * not hook-bound — drop it directly into your form submit handler.
 * Throws `AuthioError` on any failure (rate-limit, bad email,
 * network down, etc.) so the caller can render the auth-core error
 * code verbatim.
 *
 * Returns `void` on success — the link is now in the user's inbox.
 * Show a "Check your email" screen and let the user click through.
 *
 * Example:
 *
 * ```ts
 * try {
 *   await signInWithMagicLink({
 *     apiUrl: "https://auth-api.authio.com",
 *     projectId: "proj_123",
 *     email,
 *     redirectUri: `${window.location.origin}/auth/callback`,
 *   });
 *   setMessage("Check your email!");
 * } catch (err) {
 *   if (err instanceof AuthioError) setError(err.message);
 * }
 * ```
 */
export async function signInWithMagicLink(
  opts: SignInWithMagicLinkOptions,
): Promise<void> {
  await authioFetch<{ ok?: boolean }>({
    apiUrl: opts.apiUrl,
    projectId: opts.projectId,
    path: "/v1/auth/magic-link/send",
    method: "POST",
    body: {
      // auth-core's magic-link send reads the recipient as `destination`
      // (email or E.164), NOT `email`. See magiclink.go magicLinkSendReq.
      destination: opts.email,
      redirect_uri: opts.redirectUri,
      ...(opts.xrayVisitorProof
        ? { xray_visitor_proof: opts.xrayVisitorProof }
        : {}),
    },
    signal: opts.signal,
    fetchImpl: opts.fetch,
  });
}

export interface SignInWithPasskeyOptions {
  apiUrl: string;
  projectId: string;
  /**
   * Identifier hint for the passkey lookup. Optional — when omitted
   * the user picks their key from the browser's native chooser.
   */
  email?: string;
  /**
   * Post-sign-in path on the app (`next`) forwarded to auth-core on
   * the verify call. Older auth-core deployments ignore it; token
   * handling on the client is unchanged either way.
   */
  next?: string;
  /** Organization scope (`org_…`) for org-policy enforcement. */
  organizationId?: string;
  /** Opaque, consent-gated proof minted by @useauthio/xray. */
  xrayVisitorProof?: string;
  signal?: AbortSignal;
  fetch?: typeof fetch;
}

export interface SignInWithPasskeyResult {
  accessToken: string;
  refreshToken?: string;
  /** Effective session policy from the envelope, `null` on older auth-core. */
  sessionPolicy: SessionPolicy | null;
  user: AuthioUser;
}

interface PasskeyLoginOptionsResponse {
  challenge: string;
  rpId?: string;
  timeout?: number;
  userVerification?: PublicKeyCredentialRequestOptions["userVerification"];
  allowCredentials?: Array<{
    id: string;
    type: string;
    transports?: string[];
  }>;
}

/**
 * Wire shape of a sign-in verify response. Every field is optional on
 * purpose: the same endpoint returns either a session envelope or a
 * risk-engine `step_up` body (HTTP 200, no tokens, no user), so nothing
 * may be assumed present. See `sessionFromResponse`.
 */
interface SignInVerifyResponse extends RiskDecisionBody {
  access_token?: string;
  refresh_token?: string;
  session_policy?: RawSessionPolicy;
  user?: {
    id?: string;
    email?: string;
    email_verified?: boolean;
    emailVerified?: boolean;
    name?: string;
    avatar_url?: string;
    avatarUrl?: string;
  } | null;
}

interface SignInSession {
  accessToken: string;
  refreshToken?: string;
  sessionPolicy: SessionPolicy | null;
  user: AuthioUser;
}

/**
 * Map a 2xx sign-in verify body to a session, never assuming a field
 * is present:
 *
 *   - `decision: "step_up"` → `AuthioStepUpRequiredError`
 *     (`step_up_required`, carries `stepUpUrl` / `challengeId` /
 *     `requiredMethod`).
 *   - `decision: "block" | "deny"` → `AuthioSignInDeniedError`
 *     (`sign_in_denied`).
 *   - no access token or no user id → `AuthioError` `invalid_response`.
 */
export function sessionFromResponse(
  res: SignInVerifyResponse | null | undefined,
  status = 200,
): SignInSession {
  const risk = riskDecisionError(res, status);
  if (risk) throw risk;
  const accessToken =
    res && typeof res.access_token === "string" ? res.access_token : "";
  const user = res && res.user && typeof res.user === "object" ? res.user : null;
  const userId = user && typeof user.id === "string" ? user.id : "";
  if (!res || !accessToken || !user || !userId) {
    throw new AuthioError({
      code: "invalid_response",
      message: AUTHIO_MESSAGES.invalid_response,
      status,
    });
  }
  return {
    accessToken,
    refreshToken:
      typeof res.refresh_token === "string" ? res.refresh_token : undefined,
    sessionPolicy: coerceSessionPolicy(res.session_policy),
    user: {
      id: userId,
      email: typeof user.email === "string" ? user.email : "",
      emailVerified: Boolean(user.emailVerified ?? user.email_verified),
      name: user.name,
      avatarUrl: user.avatarUrl ?? user.avatar_url,
    },
  };
}

/**
 * Runs the full WebAuthn assertion ceremony against auth-core:
 *
 *   1. `POST /v1/auth/passkey/login/options` to receive the
 *      `PublicKeyCredentialRequestOptions` shaped for this project.
 *   2. `navigator.credentials.get({ publicKey: options })` to
 *      prompt the user for their authenticator (Touch ID, hardware
 *      key, platform key, etc.).
 *   3. `POST /v1/auth/passkey/login/verify` with the resulting
 *      assertion → returns `{ access_token, refresh_token, user }`.
 *
 * Throws `AuthioError` on any step failure:
 *
 *   - `not_in_browser` if `window`/`navigator` is missing (Vite SSR /
 *     test environment without jsdom).
 *   - `webauthn_unsupported` if `navigator.credentials.get` is
 *     missing (legacy browser).
 *   - `webauthn_cancelled` if the user dismisses the chooser.
 *   - `step_up_required` (`AuthioStepUpRequiredError`) when the risk
 *     engine wants one more check. Redirect to `err.stepUpUrl`.
 *   - `sign_in_denied` (`AuthioSignInDeniedError`) when the risk engine
 *     or a project policy refuses the sign-in. `err.message` is
 *     auth-core's readable reason.
 *   - `invalid_response` if auth-core answered without a session.
 *   - Whatever else auth-core returns on the options or verify call.
 *
 * The returned `refreshToken` is included for completeness, but the
 * SDK never persists it — auth-core's `/v1/auth/passkey/login/verify`
 * also sets the refresh cookie via `Set-Cookie`, which is the
 * canonical storage. Callers should typically discard `refreshToken`.
 */
export async function signInWithPasskey(
  opts: SignInWithPasskeyOptions,
): Promise<SignInWithPasskeyResult> {
  if (!isBrowser() || typeof navigator === "undefined") {
    throw new AuthioError({
      code: "not_in_browser",
      message:
        "Passkey sign-in only works in a web browser. Call signInWithPasskey from client-side code.",
      status: 0,
    });
  }
  if (!navigator.credentials || !navigator.credentials.get) {
    throw new AuthioError({
      code: "webauthn_unsupported",
      message: AUTHIO_MESSAGES.webauthn_unsupported,
      status: 0,
    });
  }

  const options = await authioFetch<PasskeyLoginOptionsResponse>({
    apiUrl: opts.apiUrl,
    projectId: opts.projectId,
    path: "/v1/auth/passkey/login/options",
    method: "POST",
    body: opts.email ? { email: opts.email } : {},
    signal: opts.signal,
    fetchImpl: opts.fetch,
  });

  if (!options || typeof options.challenge !== "string" || !options.challenge) {
    throw new AuthioError({
      code: "invalid_response",
      message: AUTHIO_MESSAGES.invalid_response,
      status: 200,
    });
  }

  const publicKey: PublicKeyCredentialRequestOptions = {
    challenge: base64UrlToBuffer(options.challenge),
    rpId: options.rpId,
    timeout: options.timeout,
    userVerification: options.userVerification,
    allowCredentials: options.allowCredentials?.map((c) => ({
      id: base64UrlToBuffer(c.id),
      type: c.type as PublicKeyCredentialType,
      transports: c.transports as AuthenticatorTransport[] | undefined,
    })),
  };

  let credential: Credential | null;
  try {
    credential = await navigator.credentials.get({
      publicKey,
      signal: opts.signal,
    });
  } catch (err) {
    // Browser text ("The operation either timed out or was not
    // allowed…") is not user-friendly; keep it on `cause` only.
    const e = new AuthioError({
      code: "webauthn_cancelled",
      message: AUTHIO_MESSAGES.webauthn_cancelled,
      status: 0,
    });
    Object.defineProperty(e, "cause", { value: err, enumerable: false });
    throw e;
  }
  if (!credential) {
    throw new AuthioError({
      code: "webauthn_cancelled",
      message: AUTHIO_MESSAGES.webauthn_cancelled,
      status: 0,
    });
  }

  const assertion = credential as PublicKeyCredential & {
    response: AuthenticatorAssertionResponse;
  };
  // auth-core's passkey login/verify expects the standard WebAuthn JSON
  // (camelCase) wrapped under a top-level `credential` key — it parses
  // req.Credential with go-webauthn's ParseCredentialRequestResponseBody
  // and rejects unknown top-level fields (DisallowUnknownFields). See
  // passkey.go passkeyLoginVerify + the P1 passkey conformance flow.
  const webauthnCredential = {
    id: assertion.id,
    rawId: bufferToBase64Url(assertion.rawId),
    type: assertion.type,
    response: {
      clientDataJSON: bufferToBase64Url(assertion.response.clientDataJSON),
      authenticatorData: bufferToBase64Url(
        assertion.response.authenticatorData,
      ),
      signature: bufferToBase64Url(assertion.response.signature),
      userHandle: assertion.response.userHandle
        ? bufferToBase64Url(assertion.response.userHandle)
        : null,
    },
  };

  const verifyRes = await authioFetch<SignInVerifyResponse>({
    apiUrl: opts.apiUrl,
    projectId: opts.projectId,
    path: "/v1/auth/passkey/login/verify",
    method: "POST",
    body: {
      credential: webauthnCredential,
      ...(opts.next ? { next: opts.next } : {}),
      ...(opts.organizationId ? { organization_id: opts.organizationId } : {}),
      ...(opts.xrayVisitorProof
        ? { xray_visitor_proof: opts.xrayVisitorProof }
        : {}),
    },
    extraHeaders: deviceSignalsExtraHeaders(),
    credentials: "include",
    signal: opts.signal,
    fetchImpl: opts.fetch,
  });

  return sessionFromResponse(verifyRes);
}

// ============================================================
// Email OTP (6-digit code) sign-in — M6
// ============================================================

export interface SendEmailOtpOptions {
  /** Authio auth-core base URL. */
  apiUrl: string;
  /** Project ID (`proj_…`). */
  projectId: string;
  /** Email address to send the 6-digit code to. */
  email: string;
  /**
   * Where auth-core should consider the sign-in to be headed. Optional —
   * when omitted, auth-core derives it from the request Origin.
   */
  redirectUri?: string;
  /** Post-sign-in path on the app, carried through to the session redirect. */
  next?: string;
  /** Organization scope (`org_…`) for org-policy enforcement. */
  organizationId?: string;
  /** Opaque, consent-gated proof minted by @useauthio/xray. */
  xrayVisitorProof?: string;
  signal?: AbortSignal;
  fetch?: typeof fetch;
}

/**
 * POSTs `/v1/auth/email-otp/send` — the same endpoint/body shape the
 * hosted Lobby's "Email me a code" button uses. Returns `void` on
 * success; the code is now in the user's inbox. Throws `AuthioError`
 * on any failure (rate-limit, invalid email, org policy, network).
 *
 * Note: unlike `verifyEmailOtp`, the send endpoint does not accept
 * `client_location` — capture location once and pass it to verify.
 */
export async function sendEmailOtp(opts: SendEmailOtpOptions): Promise<void> {
  await authioFetch<{ expires_in?: number }>({
    apiUrl: opts.apiUrl,
    projectId: opts.projectId,
    path: "/v1/auth/email-otp/send",
    method: "POST",
    body: {
      email: opts.email,
      ...(opts.redirectUri ? { redirect_uri: opts.redirectUri } : {}),
      ...(opts.next ? { next: opts.next } : {}),
      ...(opts.organizationId ? { organization_id: opts.organizationId } : {}),
      ...(opts.xrayVisitorProof
        ? { xray_visitor_proof: opts.xrayVisitorProof }
        : {}),
    },
    signal: opts.signal,
    fetchImpl: opts.fetch,
  });
}

export interface VerifyEmailOtpOptions {
  apiUrl: string;
  projectId: string;
  /** Email address the code was sent to. */
  email: string;
  /** The 6-digit code from the user's inbox. */
  code: string;
  /** Fallback redirect target when the send call didn't record one. */
  redirectUri?: string;
  /** Post-sign-in path on the app. */
  next?: string;
  /** Organization scope (`org_…`) for org-policy enforcement. */
  organizationId?: string;
  /** Optional browser geolocation for Authio Locate attestation. */
  clientLocation?: ClientLocationCapture;
  /** Optional coarse device signals for risk / device recognition. */
  deviceSignals?: DeviceSignalsCapture;
  /** Opaque, consent-gated proof minted by @useauthio/xray. */
  xrayVisitorProof?: string;
  signal?: AbortSignal;
  fetch?: typeof fetch;
}

export interface VerifyEmailOtpResult {
  accessToken: string;
  refreshToken?: string;
  /** Effective session policy from the envelope, `null` on older auth-core. */
  sessionPolicy: SessionPolicy | null;
  user: AuthioUser;
}

/**
 * POSTs `/v1/auth/email-otp/verify` with the code the user typed —
 * mirrors the hosted Lobby's verify body shape. On success returns
 * `{ accessToken, refreshToken, user }`; auth-core also sets the
 * session cookie via `Set-Cookie` (the request runs with
 * `credentials: "include"`), which is the canonical storage.
 *
 * Throws `AuthioError`:
 *
 *   - `invalid_code` for a wrong/expired code (auth-core's code).
 *   - `step_up_required` (`AuthioStepUpRequiredError`) when the risk
 *     engine withholds the session pending a second factor. Redirect to
 *     `err.stepUpUrl` to finish the sign-in on the hosted UI.
 *   - `sign_in_denied` (`AuthioSignInDeniedError`) when the sign-in is
 *     refused by risk or project policy.
 *   - `invalid_response` if auth-core answered without a session.
 *   - Whatever else auth-core returns (rate-limit, policy, etc.).
 */
export async function verifyEmailOtp(
  opts: VerifyEmailOtpOptions,
): Promise<VerifyEmailOtpResult> {
  const verifyRes = await authioFetch<SignInVerifyResponse>({
    apiUrl: opts.apiUrl,
    projectId: opts.projectId,
    path: "/v1/auth/email-otp/verify",
    method: "POST",
    body: {
      email: opts.email,
      code: opts.code,
      ...(opts.redirectUri ? { redirect_uri: opts.redirectUri } : {}),
      ...(opts.next ? { next: opts.next } : {}),
      ...(opts.organizationId ? { organization_id: opts.organizationId } : {}),
      ...(opts.clientLocation ? { client_location: opts.clientLocation } : {}),
      ...(opts.deviceSignals ? { device_signals: opts.deviceSignals } : {}),
      ...(opts.xrayVisitorProof
        ? { xray_visitor_proof: opts.xrayVisitorProof }
        : {}),
    },
    credentials: "include",
    signal: opts.signal,
    fetchImpl: opts.fetch,
  });

  // The risk engine may withhold the session (decision: "step_up") —
  // sessionFromResponse turns that into a typed error with stepUpUrl.
  return sessionFromResponse(verifyRes);
}

function base64UrlToBuffer(b64u: string): ArrayBuffer {
  const padded = b64u
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(b64u.length + ((4 - (b64u.length % 4)) % 4), "=");
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

function bufferToBase64Url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i] as number);
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
