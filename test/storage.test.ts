import { beforeEach, describe, expect, it } from "vitest";
import { ACCESS_TOKEN_STORAGE_KEY, createTokenStorage } from "../src/storage";

describe("createTokenStorage", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it("round-trips a value via the in-memory backend", () => {
    const store = createTokenStorage("memory");
    expect(store.get()).toBeNull();
    store.set("eyJ.abc.def");
    expect(store.get()).toBe("eyJ.abc.def");
    store.clear();
    expect(store.get()).toBeNull();
  });

  it("round-trips a value via the localStorage backend", () => {
    const store = createTokenStorage("localStorage");
    store.set("eyJ.tok.123");
    expect(store.get()).toBe("eyJ.tok.123");
    expect(window.localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY)).toBe(
      "eyJ.tok.123",
    );
    store.clear();
    expect(window.localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY)).toBeNull();
  });

  it("round-trips a value via the sessionStorage backend", () => {
    const store = createTokenStorage("sessionStorage");
    store.set("eyJ.sess.789");
    expect(store.get()).toBe("eyJ.sess.789");
    expect(window.sessionStorage.getItem(ACCESS_TOKEN_STORAGE_KEY)).toBe(
      "eyJ.sess.789",
    );
  });

  it("'none' mode persists nothing", () => {
    const store = createTokenStorage("none");
    store.set("eyJ.never.kept");
    expect(store.get()).toBeNull();
  });
});
