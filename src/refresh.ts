import { isBrowser, isTabHidden } from "./ssr";

/**
 * Backoff steps when a scheduled refresh fails. The 30s cap matches
 * Authio's published recommendation for client-side rate limits —
 * an SPA spinning at 30s on a single endpoint is well under the
 * default project quota.
 */
const BACKOFF_DELAYS_MS = [1000, 2000, 4000, 8000, 16000, 30000];
/** After five consecutive failures we surrender and transition to unauthenticated. */
const MAX_ATTEMPTS = 5;

export interface RefreshSchedulerOptions {
  /** Schedule the silent refresh this many seconds before `exp`. */
  leadSeconds: number;
  /** Returns `true` on success, `false` on failure. Failures trigger backoff. */
  run: () => Promise<boolean>;
  /** Called after `MAX_ATTEMPTS` consecutive failures. */
  onGiveUp: () => void;
  /** Optional sink for "next refresh scheduled at" telemetry. */
  onScheduled?: (runAt: number) => void;
}

/**
 * Silent-refresh scheduler. Wraps a single `setTimeout` and a
 * `visibilitychange` listener:
 *
 *   - `scheduleAt(exp)` queues a refresh `leadSeconds` before `exp`.
 *     The clock resets `attempts` to zero.
 *   - When the timer fires, if the tab is hidden, we DEFER — the
 *     visibilitychange listener picks up where we left off when the
 *     tab returns. Saves battery on a sleeping background tab.
 *   - On failure we walk the `BACKOFF_DELAYS_MS` step list. After
 *     `MAX_ATTEMPTS` failures the scheduler calls `onGiveUp` and
 *     stops — the provider then transitions to `unauthenticated`.
 *   - `clear()` and `destroy()` cancel pending work; the latter
 *     also unhooks the visibility listener.
 */
export class RefreshScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private attempts = 0;
  private lastExp: number | null = null;
  private destroyed = false;
  private visibilityHandler: (() => void) | null = null;

  constructor(private readonly opts: RefreshSchedulerOptions) {
    if (isBrowser()) {
      this.visibilityHandler = () => {
        if (this.destroyed) return;
        if (!isTabHidden() && this.timer === null && this.lastExp !== null) {
          this.scheduleAt(this.lastExp);
        }
      };
      document.addEventListener("visibilitychange", this.visibilityHandler);
    }
  }

  scheduleAt(exp: number): void {
    if (this.destroyed) return;
    this.lastExp = exp;
    this.attempts = 0;
    this.clear();
    const now = Math.floor(Date.now() / 1000);
    const delayMs = Math.max(0, (exp - now - this.opts.leadSeconds) * 1000);
    this.opts.onScheduled?.(Date.now() + delayMs);
    this.timer = setTimeout(() => void this.tick(), delayMs);
  }

  private async tick(): Promise<void> {
    this.timer = null;
    if (this.destroyed) return;
    if (isTabHidden()) {
      // Defer until the tab is visible again; the visibility handler
      // will call scheduleAt when the user returns.
      return;
    }
    let ok = false;
    try {
      ok = await this.opts.run();
    } catch {
      ok = false;
    }
    if (this.destroyed) return;
    if (ok) {
      // The provider's `run` callback is responsible for calling
      // `scheduleAt(newExp)` on success. We do nothing further here.
      return;
    }
    this.scheduleBackoff();
  }

  private scheduleBackoff(): void {
    if (this.destroyed) return;
    if (this.attempts >= MAX_ATTEMPTS) {
      this.opts.onGiveUp();
      this.lastExp = null;
      return;
    }
    const delay =
      BACKOFF_DELAYS_MS[Math.min(this.attempts, BACKOFF_DELAYS_MS.length - 1)] ??
      30_000;
    this.attempts++;
    this.opts.onScheduled?.(Date.now() + delay);
    this.timer = setTimeout(() => void this.tick(), delay);
  }

  /** Cancel any pending timer but keep the scheduler alive for re-scheduling. */
  clear(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** Permanently stop and unhook listeners. */
  destroy(): void {
    this.destroyed = true;
    this.clear();
    if (this.visibilityHandler && isBrowser()) {
      document.removeEventListener("visibilitychange", this.visibilityHandler);
    }
    this.visibilityHandler = null;
  }
}
