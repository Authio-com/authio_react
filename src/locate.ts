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

const VERIFY_LOCATE_BACKEND_ONLY =
  "verifyLocate() is not supported in @useauthio/react: POST /v1/locate/verify requires a project secret key (sk_live_/sk_test_), not a user JWT. " +
  "Capture GPS with captureClientLocation(), POST to your backend, and call authio.locate.verify() via @useauthio/node. " +
  "See authio_locate/docs/JB_MIGRATION_GUIDE.md.";

/**
 * @deprecated Use backend proxy with `@useauthio/node` `authio.locate.verify()` — see JB migration guide.
 * This helper always throws; it must not send a user JWT to the sk_-only verify route.
 */
export async function verifyLocate(_opts: VerifyLocateOptions): Promise<LocateVerifyResult> {
  throw new Error(VERIFY_LOCATE_BACKEND_ONLY);
}
