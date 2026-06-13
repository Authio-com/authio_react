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
