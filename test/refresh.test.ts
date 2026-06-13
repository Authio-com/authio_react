import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RefreshScheduler } from "../src/refresh";
import { readJwtExp } from "../src/jwt";
import { makeJwt } from "./_helpers";

describe("readJwtExp", () => {
  it("returns the exp claim when present", () => {
    const token = makeJwt({ sub: "user_1", exp: 1_700_000_000 });
    expect(readJwtExp(token)).toBe(1_700_000_000);
  });

  it("returns null for an unparseable token", () => {
    expect(readJwtExp("not-a-jwt")).toBeNull();
    expect(readJwtExp("aaa.bbb.ccc")).toBeNull();
  });
});

describe("RefreshScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires the run callback leadSeconds before exp", async () => {
    const run = vi.fn().mockResolvedValue(true);
    const onGiveUp = vi.fn();
    const scheduler = new RefreshScheduler({
      leadSeconds: 60,
      run,
      onGiveUp,
    });
    const exp = Math.floor(Date.now() / 1000) + 300; // 5 min away
    scheduler.scheduleAt(exp);
    expect(run).not.toHaveBeenCalled();
    // Advance to 60s before exp = 240s from now
    await vi.advanceTimersByTimeAsync(240_000);
    expect(run).toHaveBeenCalledTimes(1);
    scheduler.destroy();
  });

  it("backs off on failure and gives up after MAX_ATTEMPTS", async () => {
    const run = vi.fn().mockResolvedValue(false);
    const onGiveUp = vi.fn();
    const scheduler = new RefreshScheduler({
      leadSeconds: 60,
      run,
      onGiveUp,
    });
    const exp = Math.floor(Date.now() / 1000) + 60; // schedule immediately
    scheduler.scheduleAt(exp);
    // First tick (immediate)
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
    expect(onGiveUp).not.toHaveBeenCalled();
    // Drain all backoff steps. Total upper bound is 1+2+4+8+16+30 = 61s.
    await vi.advanceTimersByTimeAsync(120_000);
    // After 5 failed attempts the scheduler gives up.
    expect(onGiveUp).toHaveBeenCalledTimes(1);
    scheduler.destroy();
  });

  it("clears any pending timer when clear() is called", async () => {
    const run = vi.fn().mockResolvedValue(true);
    const scheduler = new RefreshScheduler({
      leadSeconds: 60,
      run,
      onGiveUp: () => {},
    });
    const exp = Math.floor(Date.now() / 1000) + 300;
    scheduler.scheduleAt(exp);
    scheduler.clear();
    await vi.advanceTimersByTimeAsync(500_000);
    expect(run).not.toHaveBeenCalled();
    scheduler.destroy();
  });
});
