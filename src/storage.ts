import { isBrowser } from "./ssr";
import type { AuthioStorageMode } from "./types";

/**
 * Tiny abstraction over the four supported access-token storage
 * backends. Refresh tokens are NEVER stored here — they live only
 * in the BFF's HttpOnly cookie.
 */
export interface TokenStorage {
  get(): string | null;
  set(value: string | null): void;
  clear(): void;
}

class MemoryStorage implements TokenStorage {
  private value: string | null = null;
  get(): string | null {
    return this.value;
  }
  set(value: string | null): void {
    this.value = value;
  }
  clear(): void {
    this.value = null;
  }
}

class NoneStorage implements TokenStorage {
  get(): string | null {
    return null;
  }
  set(): void {
    /* no-op */
  }
  clear(): void {
    /* no-op */
  }
}

class WebStorageBacking implements TokenStorage {
  constructor(
    private readonly storage: Storage,
    private readonly key: string,
  ) {}

  get(): string | null {
    try {
      return this.storage.getItem(this.key);
    } catch {
      return null;
    }
  }

  set(value: string | null): void {
    try {
      if (value === null) this.storage.removeItem(this.key);
      else this.storage.setItem(this.key, value);
    } catch {
      // Quota / private-mode failure — swallow so the SDK keeps
      // working without persistence rather than crashing the app.
    }
  }

  clear(): void {
    try {
      this.storage.removeItem(this.key);
    } catch {
      /* see set() */
    }
  }
}

export const ACCESS_TOKEN_STORAGE_KEY = "authio.access_token";

/**
 * Build the storage adapter the provider will use for the access
 * token. Under SSR the `localStorage` / `sessionStorage` modes
 * silently fall back to in-memory so the provider doesn't throw
 * during a server render — the real storage kicks in after
 * hydration.
 */
export function createTokenStorage(
  mode: AuthioStorageMode = "memory",
): TokenStorage {
  if (mode === "none") return new NoneStorage();
  if (mode === "memory") return new MemoryStorage();
  if (!isBrowser()) return new MemoryStorage();
  if (mode === "localStorage") {
    return new WebStorageBacking(window.localStorage, ACCESS_TOKEN_STORAGE_KEY);
  }
  if (mode === "sessionStorage") {
    return new WebStorageBacking(
      window.sessionStorage,
      ACCESS_TOKEN_STORAGE_KEY,
    );
  }
  return new MemoryStorage();
}
