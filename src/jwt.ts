import { JwtVerifier } from "@useauthio/node";
import type { AuthioTokenVerification, AuthioTokenVerifier } from "./types";

/**
 * Build the default token verifier. Wraps `JwtVerifier` from
 * `@useauthio/node` so we get EdDSA-pinned verification against the
 * remote JWKS (the verifier itself refuses `alg: none` because we
 * pin `algorithms: ["EdDSA"]`).
 *
 * The verifier instance is cached per `(apiUrl, issuer, audience)`
 * tuple so swapping any of those at runtime rebuilds the JWKS
 * fetcher.
 */
export function createDefaultVerifier(
  apiUrl: string,
  issuer: string,
  audience: string,
): AuthioTokenVerifier {
  const verifier = new JwtVerifier(apiUrl, issuer, audience);
  return async (token: string): Promise<AuthioTokenVerification | null> => {
    try {
      const claims = await verifier.verify(token);
      if (!claims.sub) return null;
      return {
        subject: claims.sub,
        expiresAt: typeof claims.exp === "number" ? claims.exp : undefined,
      };
    } catch {
      return null;
    }
  };
}

/**
 * Decode a JWT body WITHOUT signature verification, exclusively to
 * read the `exp` claim for refresh scheduling. NEVER trust this for
 * authorization — that's what the verifier above is for.
 *
 * Returns `null` on any decode failure so callers fall back to "we
 * don't know when this expires, refresh on demand only".
 */
export function readJwtExp(token: string): number | null {
  const parts = token.split(".");
  const body = parts[1];
  if (!body) return null;
  try {
    const padded = body
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(body.length + ((4 - (body.length % 4)) % 4), "=");
    const json = decodeBase64(padded);
    const obj = JSON.parse(json) as { exp?: unknown };
    return typeof obj.exp === "number" ? obj.exp : null;
  } catch {
    return null;
  }
}

function decodeBase64(b64: string): string {
  if (typeof atob === "function") return atob(b64);
  // Node fallback — `atob` has been a global since Node 16, but
  // some bundler configs may strip the binding.
  const g = globalThis as unknown as {
    Buffer?: { from(b: string, e: string): { toString(e: string): string } };
  };
  if (g.Buffer) return g.Buffer.from(b64, "base64").toString("utf-8");
  throw new Error("No base64 decoder available");
}
