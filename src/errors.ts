import { AuthioError } from "@useauthio/node";

export { AuthioError };

// ------------------------------------------------------------
// User-facing copy. Every message the SDK produces on its own must be
// plain English and tell the user what to do next. Raw JS / browser
// error text (e.g. "Failed to fetch", "The operation either timed out
// or was not allowed") is kept on `cause` for debugging, never shown.
// ------------------------------------------------------------

export const AUTHIO_MESSAGES = {
  network_error:
    "We couldn't reach the sign-in service. Check your internet connection and try again.",
  timeout:
    "The sign-in service took too long to respond. Please try again.",
  aborted: "The request was cancelled before it finished. Please try again.",
  invalid_response:
    "We couldn't finish signing you in because the sign-in service sent an unexpected response. Please try again.",
  step_up_required:
    "For your security, we need one more check before signing you in.",
  sign_in_denied:
    "We couldn't sign you in. If you think this is a mistake, contact support or your administrator.",
  rate_limited: "Too many attempts. Please wait a moment and try again.",
  server_error:
    "Something went wrong on our side. Please try again in a moment.",
  request_failed: "We couldn't complete that request. Please try again.",
  webauthn_cancelled:
    "Passkey sign-in was cancelled or timed out. Please try again.",
  webauthn_registration_cancelled:
    "Passkey setup was cancelled or timed out. Please try again.",
  webauthn_already_registered:
    "This device already has a passkey for your account.",
  webauthn_unsupported:
    "This browser doesn't support passkeys. Try a different browser, or sign in another way.",
  not_signed_in: "You need to be signed in to do that. Please sign in and try again.",
  token_rejected:
    "We couldn't verify your sign-in. Please sign in again.",
} as const;

/** Attach the underlying error for debugging without exposing its text. */
function withCause<E extends Error>(err: E, cause: unknown): E {
  if (cause !== undefined) {
    Object.defineProperty(err, "cause", {
      value: cause,
      enumerable: false,
      configurable: true,
      writable: true,
    });
  }
  return err;
}

/**
 * Wrap a native fetch rejection (network error, abort, timeout) in
 * an `AuthioError` so consumers always get a typed `code` to switch
 * on and a readable `message`. Already-typed `AuthioError` instances
 * pass through unchanged. The original error is kept on `cause`.
 */
export function wrapFetchError(
  err: unknown,
  fallbackCode = "network_error",
): AuthioError {
  if (err instanceof AuthioError) return err;
  // DOMException is not `instanceof Error` in every runtime, so read
  // name/message structurally.
  const e = (err && typeof err === "object" ? err : {}) as {
    name?: unknown;
    message?: unknown;
  };
  const name = typeof e.name === "string" ? e.name : "";
  const rawMessage = typeof e.message === "string" ? e.message : "";
  const isTimeout = name === "TimeoutError" || /timed? ?out/i.test(rawMessage);
  if (isTimeout) {
    return withCause(
      new AuthioError({
        code: "timeout",
        message: AUTHIO_MESSAGES.timeout,
        status: 0,
      }),
      err,
    );
  }
  if (name === "AbortError") {
    return withCause(
      new AuthioError({
        code: "aborted",
        message: AUTHIO_MESSAGES.aborted,
        status: 0,
      }),
      err,
    );
  }
  const message =
    fallbackCode === "network_error"
      ? AUTHIO_MESSAGES.network_error
      : AUTHIO_MESSAGES.request_failed;
  return withCause(
    new AuthioError({ code: fallbackCode, message, status: 0 }),
    err,
  );
}

/** Readable fallback when auth-core returned an error without a message. */
export function messageForStatus(status: number): string {
  if (status === 429) return AUTHIO_MESSAGES.rate_limited;
  if (status >= 500) return AUTHIO_MESSAGES.server_error;
  return AUTHIO_MESSAGES.request_failed;
}

// ------------------------------------------------------------
// Risk-engine outcomes
// ------------------------------------------------------------

/**
 * Thrown (code `step_up_required`) when auth-core's risk engine wants
 * one more verification step before it will issue a session. No session
 * exists yet. Send the user to `stepUpUrl` (the hosted step-up page) to
 * finish signing in:
 *
 * ```ts
 * catch (err) {
 *   if (err instanceof AuthioStepUpRequiredError && err.stepUpUrl) {
 *     window.location.assign(err.stepUpUrl);
 *   }
 * }
 * ```
 *
 * `stepUpUrl` is `undefined` on auth-core versions that predate the
 * field or when no hosted UI is configured for the project.
 */
export class AuthioStepUpRequiredError extends AuthioError {
  readonly stepUpUrl?: string;
  readonly challengeId?: string;
  readonly requiredMethod?: string;
  readonly reasons: string[];
  readonly enrollmentRequired: boolean;
  /** auth-core's own explanation of the step, when it sent one. */
  readonly serverMessage?: string;

  constructor(opts: {
    status: number;
    stepUpUrl?: string;
    challengeId?: string;
    requiredMethod?: string;
    reasons?: string[];
    enrollmentRequired?: boolean;
    serverMessage?: string;
    requestId?: string;
  }) {
    super({
      code: "step_up_required",
      message: AUTHIO_MESSAGES.step_up_required,
      status: opts.status,
      requestId: opts.requestId,
    });
    this.name = "AuthioStepUpRequiredError";
    this.stepUpUrl = opts.stepUpUrl;
    this.challengeId = opts.challengeId;
    this.requiredMethod = opts.requiredMethod;
    this.reasons = opts.reasons ?? [];
    this.enrollmentRequired = Boolean(opts.enrollmentRequired);
    this.serverMessage = opts.serverMessage;
  }
}

/**
 * Thrown (code `sign_in_denied`) when auth-core's risk engine or a
 * project policy (country, network type, risk score) refuses the
 * sign-in outright. `message` is auth-core's human-readable reason;
 * `denyCode` is its stable machine code (e.g. `blocked_by_geo_policy`).
 */
export class AuthioSignInDeniedError extends AuthioError {
  readonly denyCode?: string;
  readonly reasons: string[];

  constructor(opts: {
    status: number;
    message?: string;
    denyCode?: string;
    reasons?: string[];
    requestId?: string;
  }) {
    super({
      code: "sign_in_denied",
      message: nonEmpty(opts.message) ?? AUTHIO_MESSAGES.sign_in_denied,
      status: opts.status,
      requestId: opts.requestId,
    });
    this.name = "AuthioSignInDeniedError";
    this.denyCode = opts.denyCode;
    this.reasons = opts.reasons ?? [];
  }
}

/** True when `err` is a step-up-required error from any SDK helper. */
export function isStepUpRequired(
  err: unknown,
): err is AuthioStepUpRequiredError {
  return err instanceof AuthioStepUpRequiredError;
}

/** Wire shape of auth-core's risk fields (step_up / block bodies). */
export interface RiskDecisionBody {
  decision?: string;
  challenge_id?: string;
  required_method?: string;
  reasons?: unknown;
  step_up_url?: string;
  enrollment_required?: boolean;
  message?: string;
  code?: string;
  error?: string;
  request_id?: string;
}

/**
 * Turn a risk-engine body into a typed error, or `null` when the body
 * is not a step_up / deny decision. Used for both 2xx (step_up is a
 * 200) and non-2xx (deny is a 403) responses.
 */
export function riskDecisionError(
  body: RiskDecisionBody | null | undefined,
  status: number,
): AuthioError | null {
  if (!body || typeof body !== "object") return null;
  const decision = typeof body.decision === "string" ? body.decision : "";
  const reasons = Array.isArray(body.reasons)
    ? body.reasons.filter((r): r is string => typeof r === "string")
    : [];
  if (decision === "step_up" || body.code === "step_up_required") {
    return new AuthioStepUpRequiredError({
      status,
      stepUpUrl: nonEmpty(body.step_up_url),
      challengeId: nonEmpty(body.challenge_id),
      requiredMethod: nonEmpty(body.required_method),
      reasons,
      enrollmentRequired: body.enrollment_required === true,
      serverMessage: nonEmpty(body.message),
      requestId: body.request_id,
    });
  }
  if (decision === "block" || decision === "deny") {
    return new AuthioSignInDeniedError({
      status,
      message: body.message,
      denyCode: nonEmpty(body.code) ?? nonEmpty(body.error),
      reasons,
      requestId: body.request_id,
    });
  }
  return null;
}

function nonEmpty(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() !== "" ? v : undefined;
}
