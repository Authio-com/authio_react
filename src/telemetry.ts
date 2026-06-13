/**
 * Telemetry event union emitted by `@useauthio/react`. Pass
 * `onTelemetryEvent` to `<AuthioProvider>` to capture these — wire
 * them into Sentry / Datadog / your observability stack of choice.
 *
 * The SDK does not phone home by default. If `onTelemetryEvent` is
 * omitted, every event is dropped.
 *
 * All events carry a millisecond `timestamp` taken from `Date.now()`
 * at emit. Additional fields per kind:
 *
 *   - `refresh_succeeded`: a silent refresh against `/v1/auth/refresh`
 *     produced a fresh, verified access token.
 *   - `refresh_failed`: refresh attempt failed — either the network
 *     call rejected, the response was malformed, or token
 *     verification rejected the new token. `reason` is human-readable;
 *     `status` is the HTTP status (or `undefined` on network errors);
 *     `attempt` is the 0-indexed retry count for this scheduled
 *     refresh.
 *   - `refresh_scheduled`: a future silent refresh has been timer-
 *     scheduled. `runAt` is the unix millisecond at which the refresh
 *     will fire (subject to the visibilitychange deferral).
 *   - `sign_in_started` / `sign_in_completed` / `sign_in_failed`: the
 *     three terminal states of a sign-in attempt. `method` says which
 *     surface initiated it.
 *   - `sign_out`: the user clicked sign-out; emitted after the local
 *     cookie + token state has been cleared, regardless of whether
 *     the upstream `POST /v1/auth/sign-out` returned 2xx.
 *   - `token_verified`: a token passed signature verification. The
 *     `subject` is the verified `sub` claim.
 *   - `token_rejected`: a token failed verification; the SDK has
 *     already discarded it. `reason` is the verifier's error
 *     message.
 */
export type AuthioTelemetryEvent =
  | { kind: "refresh_succeeded"; timestamp: number; expiresAt?: number }
  | {
      kind: "refresh_failed";
      timestamp: number;
      reason: string;
      status?: number;
      attempt: number;
    }
  | { kind: "refresh_scheduled"; timestamp: number; runAt: number }
  | {
      kind: "sign_in_started";
      timestamp: number;
      method: "magic_link" | "passkey" | "redirect";
    }
  | {
      kind: "sign_in_completed";
      timestamp: number;
      method: "magic_link" | "passkey" | "redirect";
    }
  | {
      kind: "sign_in_failed";
      timestamp: number;
      method: "magic_link" | "passkey" | "redirect";
      reason: string;
    }
  | { kind: "sign_out"; timestamp: number }
  | { kind: "token_verified"; timestamp: number; subject: string }
  | { kind: "token_rejected"; timestamp: number; reason: string };

export type TelemetryEmitter = (event: AuthioTelemetryEvent) => void;

export const noopEmitter: TelemetryEmitter = () => {};
