/**
 * Browser helpers for Authio Locate client attestation.
 *
 * Capture device geolocation and pass it to sign-in or standalone verify
 * calls as `client_location`. Requires user consent (browser prompt).
 */

export interface ClientLocationCapture {
  latitude: number;
  longitude: number;
  accuracy_m: number;
  captured_at: string;
  source: "browser_geolocation";
}

export interface CaptureClientLocationOptions {
  timeoutMs?: number;
  maximumAgeMs?: number;
  enableHighAccuracy?: boolean;
}

/**
 * Request the browser's current position. Rejects when geolocation is
 * unavailable, denied, or times out.
 */
export function captureClientLocation(
  opts: CaptureClientLocationOptions = {},
): Promise<ClientLocationCapture> {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return Promise.reject(new Error("geolocation_unavailable"));
  }
  const timeoutMs = opts.timeoutMs ?? 10_000;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("geolocation_timeout")), timeoutMs);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(timer);
        resolve({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy_m: Math.round(pos.coords.accuracy),
          captured_at: new Date(pos.timestamp).toISOString(),
          source: "browser_geolocation",
        });
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
      {
        enableHighAccuracy: opts.enableHighAccuracy ?? false,
        maximumAge: opts.maximumAgeMs ?? 60_000,
        timeout: timeoutMs,
      },
    );
  });
}

export type LocateAction = "sign_in" | "wager_placed" | "contest_entry" | string;

export interface VerifyLocateOptions {
  apiUrl: string;
  projectId: string;
  accessToken: string;
  action: LocateAction;
  clientLocation?: ClientLocationCapture;
  idempotencyKey?: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

export interface LocateVerifyResult {
  verification_id: string;
  decision: "allow" | "block";
  confidence: number;
  method: string;
  location: { country: string; region: string; source: string };
  network_signals: {
    vpn: boolean;
    datacenter: boolean;
    tor: boolean;
    anonymous_proxy: boolean;
    satellite: boolean;
  };
  evasion_signals: string[];
}

/**
 * Standalone Locate verify for custom actions (e.g. wager_placed).
 * Requires a user access token with locate plan enabled.
 */
export async function verifyLocate(opts: VerifyLocateOptions): Promise<LocateVerifyResult> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const url = `${opts.apiUrl.replace(/\/$/, "")}/v1/locate/verify`;
  const res = await fetchImpl(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${opts.accessToken}`,
      "X-Authio-Project": opts.projectId,
    },
    body: JSON.stringify({
      action: opts.action,
      client_location: opts.clientLocation,
      idempotency_key: opts.idempotencyKey,
    }),
    signal: opts.signal,
  });
  const body = (await res.json().catch(() => ({}))) as LocateVerifyResult & {
    code?: string;
    message?: string;
  };
  if (!res.ok) {
    throw new Error(body.message ?? body.code ?? `locate_verify_failed_${res.status}`);
  }
  return body;
}
