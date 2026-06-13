/**
 * SSR helpers. Every hook in this SDK is wrapped to be safe under
 * Vite SSR / Remix / Next.js (where the provider is rendered server-
 * side as a stub that hydrates client-side). The functions here are
 * the single chokepoint for that — anywhere we touch `window`,
 * `document`, `localStorage`, `navigator`, etc., gate on `isBrowser()`.
 */

export function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

export function isTabHidden(): boolean {
  if (!isBrowser()) return false;
  return document.visibilityState === "hidden";
}

/**
 * Get the current URL (browser only). Falls back to `"/"` under SSR
 * so callers can pass a non-empty default for redirect intentions.
 */
export function currentUrl(fallback = "/"): string {
  if (!isBrowser()) return fallback;
  return window.location.href;
}
