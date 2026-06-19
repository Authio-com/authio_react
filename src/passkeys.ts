import { AuthioError } from "@useauthio/node";
import { startRegistration } from "@simplewebauthn/browser";
import { authioFetch } from "./fetch";
import { isBrowser } from "./ssr";

export interface AuthioPasskey {
  id: string;
  nickname: string | null;
  aaguid: string | null;
  authenticator_name: string;
  transports: string[];
  sign_count: number;
  last_used_at: string | null;
  created_at: string;
}

/** Shared options for authenticated `/v1/me/passkeys` calls. */
export interface PasskeyApiOptions {
  apiUrl: string;
  projectId: string;
  accessToken: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

export interface AddPasskeyOptions extends PasskeyApiOptions {
  email: string;
  /**
   * WebAuthn ceremony origin (sent as `X-Authio-Origin`). Defaults to
   * `window.location.origin` in the browser.
   */
  origin?: string;
}

export interface EnrollPasskeyOptions extends PasskeyApiOptions {
  email: string;
  /** Hosted sign-in UI base URL (lobby / custom domain). */
  signInUrl: string;
  /** Where to return after enrollment (`redirect_uri` query param). */
  returnUrl?: string;
  /** Post-login path on the return host (`next` query param). */
  next?: string;
}

export interface BuildEnrollPasskeyUrlOptions {
  signInUrl: string;
  projectId: string;
  email: string;
  registerToken: string;
  redirectUri?: string;
  next?: string;
}

/** Normalize a hosted-UI base URL (no trailing slash). */
export function signInOrigin(signInUrl: string): string {
  return signInUrl.replace(/\/$/, "");
}

/**
 * True when inline WebAuthn registration can run on the current page
 * (same origin as the hosted sign-in UI / custom auth domain).
 */
export function canEnrollPasskeyEmbedded(signInUrl: string): boolean {
  if (!isBrowser()) return false;
  return window.location.origin === signInOrigin(signInUrl);
}

/** Build the hosted-UI URL for `mode=add_credential` passkey enrollment. */
export function buildEnrollPasskeyUrl(
  opts: BuildEnrollPasskeyUrlOptions,
): string {
  const url = new URL(signInOrigin(opts.signInUrl));
  url.searchParams.set("mode", "add_credential");
  url.searchParams.set("project_id", opts.projectId);
  url.searchParams.set("email", opts.email);
  url.searchParams.set("token", opts.registerToken);
  if (opts.redirectUri) {
    url.searchParams.set("redirect_uri", opts.redirectUri);
  }
  if (opts.next) {
    url.searchParams.set("next", opts.next);
  }
  return url.toString();
}

function bearerHeaders(
  accessToken: string,
  origin?: string,
): Record<string, string> {
  const h: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
  };
  if (origin) h["X-Authio-Origin"] = origin;
  return h;
}

/** Mint a short-lived JWT for add-credential WebAuthn (`register-intent`). */
export async function mintPasskeyRegisterIntent(
  opts: PasskeyApiOptions,
): Promise<{ token: string; expiresIn: number }> {
  const body = await authioFetch<{ token: string; expires_in: number }>({
    apiUrl: opts.apiUrl,
    projectId: opts.projectId,
    path: "/v1/me/passkeys/register-intent",
    method: "POST",
    body: {},
    signal: opts.signal,
    fetchImpl: opts.fetchImpl,
    extraHeaders: bearerHeaders(opts.accessToken),
  });
  return { token: body.token, expiresIn: body.expires_in };
}

/**
 * Enroll a passkey by redirecting to the hosted sign-in UI on the
 * sign-in origin (`mode=add_credential`). Use when the SPA origin
 * differs from the WebAuthn RP ID.
 */
export async function enrollPasskey(opts: EnrollPasskeyOptions): Promise<void> {
  if (!isBrowser()) {
    throw new AuthioError({
      code: "not_in_browser",
      message: "enrollPasskey can only be invoked in a browser environment.",
      status: 0,
    });
  }

  const intent = await mintPasskeyRegisterIntent(opts);
  const redirectUri =
    opts.returnUrl ?? (typeof window !== "undefined" ? window.location.href : "");
  const target = buildEnrollPasskeyUrl({
    signInUrl: opts.signInUrl,
    projectId: opts.projectId,
    email: opts.email,
    registerToken: intent.token,
    redirectUri,
    next: opts.next,
  });
  window.location.assign(target);
}

/**
 * Enroll a passkey inline on the current origin via WebAuthn.
 *
 * 1. `POST /v1/me/passkeys/register-intent`
 * 2. `POST /v1/auth/passkey/register/options` + ceremony
 * 3. `POST /v1/auth/passkey/register/verify`
 */
export async function addPasskey(opts: AddPasskeyOptions): Promise<void> {
  if (!isBrowser()) {
    throw new AuthioError({
      code: "not_in_browser",
      message: "addPasskey can only be invoked in a browser environment.",
      status: 0,
    });
  }

  const origin = opts.origin ?? window.location.origin;
  const intent = await mintPasskeyRegisterIntent(opts);

  const options = await authioFetch<
    Parameters<typeof startRegistration>[0]["optionsJSON"]
  >({
    apiUrl: opts.apiUrl,
    projectId: opts.projectId,
    path: "/v1/auth/passkey/register/options",
    method: "POST",
    body: { email: opts.email },
    signal: opts.signal,
    fetchImpl: opts.fetchImpl,
    extraHeaders: bearerHeaders(intent.token, origin),
  });

  let attestation: Awaited<ReturnType<typeof startRegistration>>;
  try {
    attestation = await startRegistration({ optionsJSON: options });
  } catch (err) {
    throw new AuthioError({
      code: "webauthn_cancelled",
      message:
        err instanceof Error
          ? err.message
          : "Passkey registration cancelled by user.",
      status: 0,
    });
  }

  await authioFetch<{ ok?: boolean }>({
    apiUrl: opts.apiUrl,
    projectId: opts.projectId,
    path: "/v1/auth/passkey/register/verify",
    method: "POST",
    body: { email: opts.email, credential: attestation },
    signal: opts.signal,
    fetchImpl: opts.fetchImpl,
    extraHeaders: bearerHeaders(intent.token, origin),
  });
}

/** List passkeys for the signed-in user (`GET /v1/me/passkeys`). */
export async function listPasskeys(
  opts: PasskeyApiOptions,
): Promise<AuthioPasskey[]> {
  const res = await authioFetch<{ data: AuthioPasskey[] }>({
    apiUrl: opts.apiUrl,
    projectId: opts.projectId,
    path: "/v1/me/passkeys",
    signal: opts.signal,
    fetchImpl: opts.fetchImpl,
    extraHeaders: bearerHeaders(opts.accessToken),
  });
  return res.data ?? [];
}

/** Rename a passkey (`PATCH /v1/me/passkeys/{credentialId}`). */
export async function renamePasskey(
  opts: PasskeyApiOptions,
  credentialId: string,
  name: string,
): Promise<void> {
  await authioFetch<{ ok: boolean }>({
    apiUrl: opts.apiUrl,
    projectId: opts.projectId,
    path: `/v1/me/passkeys/${encodeURIComponent(credentialId)}`,
    method: "PATCH",
    body: { nickname: name },
    signal: opts.signal,
    fetchImpl: opts.fetchImpl,
    extraHeaders: bearerHeaders(opts.accessToken),
  });
}

/** Revoke a passkey (`DELETE /v1/me/passkeys/{credentialId}`). */
export async function revokePasskey(
  opts: PasskeyApiOptions,
  credentialId: string,
): Promise<void> {
  await authioFetch<{ ok: boolean }>({
    apiUrl: opts.apiUrl,
    projectId: opts.projectId,
    path: `/v1/me/passkeys/${encodeURIComponent(credentialId)}`,
    method: "DELETE",
    signal: opts.signal,
    fetchImpl: opts.fetchImpl,
    extraHeaders: bearerHeaders(opts.accessToken),
  });
}
