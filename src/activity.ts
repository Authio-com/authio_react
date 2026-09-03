import { isBrowser, isTabHidden } from "./ssr";

/**
 * DOM events that count as "the user is here". All are registered
 * passive + capture so we never delay the page's own handlers, and
 * `scroll` is the only high-frequency one — the throttle below keeps
 * it from churning.
 */
const ACTIVITY_EVENTS = [
  "pointerdown",
  "keydown",
  "touchstart",
  "scroll",
  "focus",
] as const;

/** Minimum gap between two recorded activity timestamps. */
const THROTTLE_MS = 1000;

export type ActivityListener = (at: number) => void;

/**
 * Tracks the last moment the user interacted with the page. Used by the
 * provider to decide whether a scheduled silent refresh should run or
 * be deferred: when the project/org has an inactivity (idle) timeout,
 * refreshing on a timer while nobody is at the keyboard would bump the
 * server's `last_active_at` and defeat that policy. See `RefreshScheduler`.
 *
 * SSR-safe — under SSR `lastActivityAt()` is `0` and listeners are never
 * attached.
 */
export class ActivityTracker {
  private last = 0;
  private listeners = new Set<ActivityListener>();
  private handler: (() => void) | null = null;
  private visibilityHandler: (() => void) | null = null;
  private destroyed = false;

  constructor(now: () => number = Date.now) {
    this.now = now;
    if (!isBrowser()) return;
    this.handler = () => this.mark();
    for (const ev of ACTIVITY_EVENTS) {
      window.addEventListener(ev, this.handler, { passive: true, capture: true });
    }
    this.visibilityHandler = () => {
      if (!isTabHidden()) this.mark();
    };
    document.addEventListener("visibilitychange", this.visibilityHandler);
  }

  private readonly now: () => number;

  /** Unix ms of the most recent recorded interaction, `0` if none yet. */
  lastActivityAt(): number {
    return this.last;
  }

  /**
   * Record activity now. Throttled to one write per second; listeners
   * fire only when a write actually happens. Exposed so tests (and
   * embedders with their own activity signal) can poke it directly.
   */
  mark(): void {
    if (this.destroyed) return;
    const t = this.now();
    if (t - this.last < THROTTLE_MS) return;
    this.last = t;
    for (const l of this.listeners) l(t);
  }

  /** Subscribe to recorded activity. Returns an unsubscribe function. */
  onActivity(listener: ActivityListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  destroy(): void {
    this.destroyed = true;
    this.listeners.clear();
    if (!isBrowser()) return;
    if (this.handler) {
      for (const ev of ACTIVITY_EVENTS) {
        window.removeEventListener(ev, this.handler, { capture: true });
      }
    }
    if (this.visibilityHandler) {
      document.removeEventListener("visibilitychange", this.visibilityHandler);
    }
    this.handler = null;
    this.visibilityHandler = null;
  }
}
