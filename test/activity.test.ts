import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActivityTracker } from "../src/activity";

describe("ActivityTracker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts at 0 and records DOM interactions", () => {
    const tracker = new ActivityTracker();
    expect(tracker.lastActivityAt()).toBe(0);
    window.dispatchEvent(new Event("pointerdown"));
    expect(tracker.lastActivityAt()).toBe(Date.now());
    tracker.destroy();
  });

  it("throttles writes to one per second and notifies listeners on writes only", () => {
    const tracker = new ActivityTracker();
    const seen: number[] = [];
    tracker.onActivity((t) => seen.push(t));
    tracker.mark();
    const first = tracker.lastActivityAt();
    vi.advanceTimersByTime(300);
    tracker.mark(); // inside throttle window — ignored
    expect(tracker.lastActivityAt()).toBe(first);
    vi.advanceTimersByTime(800);
    tracker.mark();
    expect(tracker.lastActivityAt()).toBe(first + 1100);
    expect(seen).toEqual([first, first + 1100]);
    tracker.destroy();
  });

  it("unsubscribes listeners and stops recording after destroy()", () => {
    const tracker = new ActivityTracker();
    const listener = vi.fn();
    const off = tracker.onActivity(listener);
    tracker.mark();
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    vi.advanceTimersByTime(2000);
    tracker.mark();
    expect(listener).toHaveBeenCalledTimes(1);
    const before = tracker.lastActivityAt();
    tracker.destroy();
    vi.advanceTimersByTime(2000);
    window.dispatchEvent(new Event("keydown"));
    expect(tracker.lastActivityAt()).toBe(before);
  });

  it("treats the tab becoming visible as activity", () => {
    const tracker = new ActivityTracker();
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      configurable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(tracker.lastActivityAt()).toBe(Date.now());
    tracker.destroy();
  });
});
