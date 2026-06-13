import { vi } from "vitest";
import type { AuthioTokenVerifier } from "../src/types";

/** Build a verifier that resolves authenticated for every token. */
export function alwaysValidVerifier(subject = "user_test"): AuthioTokenVerifier {
  return async (token: string) => {
    const exp = extractExp(token);
    return { subject, expiresAt: exp ?? Math.floor(Date.now() / 1000) + 900 };
  };
}

/** Build a verifier that rejects everything. */
export const alwaysInvalidVerifier: AuthioTokenVerifier = async () => null;

/** Encode a minimal JWT (header.payload.signature) with the given exp. */
export function makeJwt(payload: Record<string, unknown>): string {
  const header = base64url(JSON.stringify({ alg: "EdDSA", typ: "JWT" }));
  const body = base64url(JSON.stringify(payload));
  return `${header}.${body}.signature`;
}

function base64url(s: string): string {
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function extractExp(token: string): number | undefined {
  const parts = token.split(".");
  const body = parts[1];
  if (!body) return undefined;
  try {
    const padded = body
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(body.length + ((4 - (body.length % 4)) % 4), "=");
    const obj = JSON.parse(atob(padded)) as { exp?: number };
    return typeof obj.exp === "number" ? obj.exp : undefined;
  } catch {
    return undefined;
  }
}

export interface MockFetchEntry {
  match: (url: string, init?: RequestInit) => boolean;
  reply: () => { status: number; body: unknown };
}

/**
 * Tiny fetch-style stub. Matches each call against the given entries
 * in order; first match wins. Records every call for assertions.
 */
export function makeMockFetch(entries: MockFetchEntry[]) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    calls.push({ url, init });
    for (const entry of entries) {
      if (entry.match(url, init)) {
        const { status, body } = entry.reply();
        return new Response(
          body === undefined ? null : JSON.stringify(body),
          {
            status,
            headers: { "content-type": "application/json" },
          },
        );
      }
    }
    return new Response(JSON.stringify({ code: "not_mocked" }), {
      status: 599,
      headers: { "content-type": "application/json" },
    });
  });
  return Object.assign(fn, { calls });
}
