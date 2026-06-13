import { AuthioError } from "@useauthio/node";

export { AuthioError };

/**
 * Wrap a native fetch rejection (network error, abort, timeout) in
 * an `AuthioError` so consumers always get a typed `code` to switch
 * on. Already-typed `AuthioError` instances pass through unchanged.
 */
export function wrapFetchError(
  err: unknown,
  fallbackCode = "network_error",
): AuthioError {
  if (err instanceof AuthioError) return err;
  if (err instanceof Error && err.name === "AbortError") {
    return new AuthioError({
      code: "aborted",
      message: err.message || "Request aborted",
      status: 0,
    });
  }
  if (err instanceof Error && /timeout/i.test(err.message)) {
    return new AuthioError({
      code: "timeout",
      message: err.message,
      status: 0,
    });
  }
  const message = err instanceof Error ? err.message : "Unknown network error";
  return new AuthioError({
    code: fallbackCode,
    message,
    status: 0,
  });
}
