import { describe, expect, it } from "vitest";
import { signInWithMagicLink } from "../src/sign-in";
import { AuthioError } from "../src/errors";
import { makeMockFetch } from "./_helpers";

describe("signInWithMagicLink", () => {
  it("POSTs the right endpoint with the right body and headers", async () => {
    const fetchImpl = makeMockFetch([
      {
        match: (url) => url.endsWith("/v1/auth/magic-link/send"),
        reply: () => ({ status: 200, body: { ok: true } }),
      },
    ]);

    await signInWithMagicLink({
      apiUrl: "https://auth-api.test",
      projectId: "proj_abc",
      email: "alice@example.com",
      redirectUri: "https://app.example.com/auth/callback",
      fetch: fetchImpl as unknown as typeof fetch,
    });

    expect(fetchImpl).toHaveBeenCalledOnce();
    const call = fetchImpl.calls[0]!;
    expect(call.url).toBe("https://auth-api.test/v1/auth/magic-link/send");
    expect(call.init?.method).toBe("POST");

    const headers = new Headers((call.init?.headers ?? {}) as HeadersInit);
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("X-Authio-Project")).toBe("proj_abc");

    const body = JSON.parse(call.init?.body as string);
    expect(body).toEqual({
      destination: "alice@example.com",
      redirect_uri: "https://app.example.com/auth/callback",
    });
  });

  it("throws a typed AuthioError on a 4xx", async () => {
    const fetchImpl = makeMockFetch([
      {
        match: (url) => url.endsWith("/v1/auth/magic-link/send"),
        reply: () => ({
          status: 429,
          body: { code: "rate_limited", message: "slow down" },
        }),
      },
    ]);

    let caught: unknown;
    try {
      await signInWithMagicLink({
        apiUrl: "https://auth-api.test",
        projectId: "proj_abc",
        email: "alice@example.com",
        redirectUri: "https://app.example.com/auth/callback",
        fetch: fetchImpl as unknown as typeof fetch,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AuthioError);
    const err = caught as AuthioError;
    expect(err.code).toBe("rate_limited");
    expect(err.status).toBe(429);
  });
});
