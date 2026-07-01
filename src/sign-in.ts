import { AuthioError } from "@useauthio/node";
import { authioFetch } from "./fetch";
import {
  deviceSignalsExtraHeaders,
  type DeviceSignalsCapture,
} from "./device-signals";
import { isBrowser } from "./ssr";
import type { ClientLocationCapture } from "./locate";
import type { AuthioUser } from "./types";

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
  signal?: AbortSignal;
  fetch?: typeof fetch;
}

export interface SignInWithPasskeyResult {
  accessToken: string;
  refreshToken?: string;
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

interface PasskeyLoginVerifyResponse {
  access_token: string;
  refresh_token?: string;
  user: {
    id: string;
    email: string;
    email_verified?: boolean;
    emailVerified?: boolean;
    name?: string;
    avatar_url?: string;
    avatarUrl?: string;
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
 *   - Whatever auth-core returns on the options or verify call.
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
        "signInWithPasskey can only be invoked in a browser environment.",
      status: 0,
    });
  }
  if (!navigator.credentials || !navigator.credentials.get) {
    throw new AuthioError({
      code: "webauthn_unsupported",
      message: "This browser does not support WebAuthn (passkeys).",
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
    throw new AuthioError({
      code: "webauthn_cancelled",
      message:
        err instanceof Error
          ? err.message
          : "Passkey ceremony cancelled by user.",
      status: 0,
    });
  }
  if (!credential) {
    throw new AuthioError({
      code: "webauthn_cancelled",
      message: "Passkey ceremony returned no credential.",
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

  const verifyRes = await authioFetch<PasskeyLoginVerifyResponse>({
    apiUrl: opts.apiUrl,
    projectId: opts.projectId,
    path: "/v1/auth/passkey/login/verify",
    method: "POST",
    body: {
      credential: webauthnCredential,
      ...(opts.next ? { next: opts.next } : {}),
      ...(opts.organizationId ? { organization_id: opts.organizationId } : {}),
    },
    extraHeaders: deviceSignalsExtraHeaders(),
    credentials: "include",
    signal: opts.signal,
    fetchImpl: opts.fetch,
  });

  return {
    accessToken: verifyRes.access_token,
    refreshToken: verifyRes.refresh_token,
    user: {
      id: verifyRes.user.id,
      email: verifyRes.user.email,
      emailVerified: Boolean(
        verifyRes.user.emailVerified ?? verifyRes.user.email_verified,
      ),
      name: verifyRes.user.name,
      avatarUrl: verifyRes.user.avatarUrl ?? verifyRes.user.avatar_url,
    },
  };
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
  signal?: AbortSignal;
  fetch?: typeof fetch;
}

export interface VerifyEmailOtpResult {
  accessToken: string;
  refreshToken?: string;
  user: AuthioUser;
}

interface EmailOtpVerifyResponse {
  decision?: string;
  challenge_id?: string;
  access_token: string;
  refresh_token?: string;
  user: {
    id: string;
    email: string;
    email_verified?: boolean;
    emailVerified?: boolean;
    name?: string;
    avatar_url?: string;
    avatarUrl?: string;
  };
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
 *   - `step_up_required` when the risk engine withholds the session
 *     pending a second factor — finish the sign-in on the hosted UI.
 *   - Whatever else auth-core returns (rate-limit, policy, etc.).
 */
export async function verifyEmailOtp(
  opts: VerifyEmailOtpOptions,
): Promise<VerifyEmailOtpResult> {
  const verifyRes = await authioFetch<EmailOtpVerifyResponse>({
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
    },
    credentials: "include",
    signal: opts.signal,
    fetchImpl: opts.fetch,
  });

  // The risk engine may withhold the session and demand a second factor.
  // A pure SPA can't run the step-up ceremony itself — surface a typed
  // error so callers can bounce the user to the hosted step-up page.
  if (verifyRes.decision === "step_up") {
    throw new AuthioError({
      code: "step_up_required",
      message:
        "Additional verification is required. Complete the step-up challenge on the hosted sign-in page.",
      status: 200,
    });
  }

  return {
    accessToken: verifyRes.access_token,
    refreshToken: verifyRes.refresh_token,
    user: {
      id: verifyRes.user.id,
      email: verifyRes.user.email,
      emailVerified: Boolean(
        verifyRes.user.emailVerified ?? verifyRes.user.email_verified,
      ),
      name: verifyRes.user.name,
      avatarUrl: verifyRes.user.avatarUrl ?? verifyRes.user.avatar_url,
    },
  };
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
