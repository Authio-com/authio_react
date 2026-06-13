import { AuthioError } from "@useauthio/node";
import { wrapFetchError } from "./errors";
import { SDK_USER_AGENT } from "./version";

const DEFAULT_TIMEOUT_MS = 10_000;

export interface AuthioFetchOptions {
  apiUrl: string;
  projectId: string;
  path: string;
  method?: "GET" | "POST" | "DELETE" | "PUT" | "PATCH";
  body?: unknown;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  credentials?: RequestCredentials;
  extraHeaders?: Record<string, string>;
}

/**
 * Typed fetch wrapper used for every call into auth-core. Behaviour:
 *
 *   - Default 10-second timeout via an internal `AbortController` —
 *     stack-safe with a caller-provided `AbortSignal` (we wire both
 *     into the same controller so either trips first).
 *   - Sends `X-Authio-Project` from `projectId` on every request so
 *     auth-core can resolve the project without host-mapping.
 *   - `application/json` content type; body is `JSON.stringify`'d.
 *   - 2xx → parses JSON body (or returns undefined on 204).
 *   - !2xx → reads the auth-core error envelope (`{ code, message }`)
 *     and throws a typed `AuthioError`.
 *   - Network / abort / timeout failures throw `AuthioError` via
 *     `wrapFetchError`. Callers never see a raw `TypeError: fetch failed`.
 */
export async function authioFetch<T = unknown>(
  opts: AuthioFetchOptions,
): Promise<T> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const url = opts.apiUrl.replace(/\/$/, "") + opts.path;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new DOMException("Request timed out", "AbortError"));
  }, timeoutMs);

  const onCallerAbort = () => {
    controller.abort(opts.signal?.reason);
  };
  if (opts.signal) {
    if (opts.signal.aborted) {
      clearTimeout(timer);
      throw wrapFetchError(opts.signal.reason ?? new Error("Aborted"));
    }
    opts.signal.addEventListener("abort", onCallerAbort);
  }

  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: opts.method ?? "GET",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Authio-Project": opts.projectId,
        "X-Authio-SDK": SDK_USER_AGENT,
        ...(opts.extraHeaders ?? {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      credentials: opts.credentials,
      signal: controller.signal,
    });
  } catch (err) {
    throw wrapFetchError(err);
  } finally {
    clearTimeout(timer);
    if (opts.signal) opts.signal.removeEventListener("abort", onCallerAbort);
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      code?: string;
      error?: string;
      message?: string;
      request_id?: string;
    };
    throw new AuthioError({
      code: body.code ?? body.error ?? "request_failed",
      message:
        body.message ??
        `Request to ${opts.path} failed with status ${res.status}`,
      status: res.status,
      requestId: body.request_id,
    });
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new AuthioError({
      code: "invalid_response",
      message: `Response from ${opts.path} was not valid JSON`,
      status: res.status,
    });
  }
}
