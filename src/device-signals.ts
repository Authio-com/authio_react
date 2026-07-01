/**
 * Optional browser device signals for Authio risk / device fingerprinting.
 *
 * Web browsers do not expose a hardware ID (IMEI, serial, MAC). These
 * coarse, non-PII signals improve device recognition alongside the
 * server-parsed user agent. auth-core hashes them server-side — never
 * send a precomputed fingerprint from the client.
 */

export interface DeviceSignalsCapture {
  timezone?: string;
  screen_resolution?: string;
  language?: string;
  platform?: string;
}

/** Collect coarse device signals available in a browser context. */
export function collectDeviceSignals(): DeviceSignalsCapture {
  if (typeof window === "undefined") {
    return {};
  }
  const out: DeviceSignalsCapture = {};
  try {
    out.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    /* ignore */
  }
  if (typeof screen !== "undefined") {
    out.screen_resolution = `${screen.width}x${screen.height}`;
  }
  if (typeof navigator !== "undefined") {
    if (navigator.language) {
      out.language = navigator.language;
    }
    if (navigator.platform) {
      out.platform = navigator.platform;
    }
  }
  return out;
}

/** Encode signals for the `X-Authio-Device-Signals` request header. */
export function encodeDeviceSignalsHeader(
  signals: DeviceSignalsCapture,
): string {
  const json = JSON.stringify(signals);
  if (typeof btoa === "function") {
    return btoa(json).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  // Node / test fallback. Typed structurally off globalThis so the browser
  // SDK doesn't need @types/node just for this branch.
  const nodeBuffer = (
    globalThis as {
      Buffer?: {
        from(input: string, encoding: string): { toString(encoding: string): string };
      };
    }
  ).Buffer;
  if (!nodeBuffer) {
    throw new Error("No base64 encoder available in this environment.");
  }
  return nodeBuffer
    .from(json, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Header name auth-core reads for optional client device signals. */
export const DEVICE_SIGNALS_HEADER = "X-Authio-Device-Signals";

export function deviceSignalsExtraHeaders(
  signals?: DeviceSignalsCapture,
): Record<string, string> {
  const s = signals ?? collectDeviceSignals();
  if (
    !s.timezone &&
    !s.screen_resolution &&
    !s.language &&
    !s.platform
  ) {
    return {};
  }
  return { [DEVICE_SIGNALS_HEADER]: encodeDeviceSignalsHeader(s) };
}
