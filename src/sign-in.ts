import { AuthioError } from "@useauthio/node";
import { authioFetch } from "./fetch";
import { deviceSignalsExtraHeaders } from "./device-signals";
import { isBrowser } from "./ssr";
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
    body: { credential: webauthnCredential },
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
