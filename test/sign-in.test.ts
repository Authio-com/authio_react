import { describe, expect, it } from "vitest";
import { sendEmailOtp, signInWithMagicLink, verifyEmailOtp } from "../src/sign-in";
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

describe("sendEmailOtp", () => {
  it("POSTs the right endpoint with the right body and headers", async () => {
    const fetchImpl = makeMockFetch([
      {
        match: (url) => url.endsWith("/v1/auth/email-otp/send"),
        reply: () => ({ status: 202, body: { expires_in: 600 } }),
      },
    ]);

    await sendEmailOtp({
      apiUrl: "https://auth-api.test",
      projectId: "proj_abc",
      email: "alice@example.com",
      redirectUri: "https://app.example.com/auth/callback",
      next: "/dashboard",
      organizationId: "org_123",
      fetch: fetchImpl as unknown as typeof fetch,
    });

    expect(fetchImpl).toHaveBeenCalledOnce();
    const call = fetchImpl.calls[0]!;
    expect(call.url).toBe("https://auth-api.test/v1/auth/email-otp/send");
    expect(call.init?.method).toBe("POST");

    const headers = new Headers((call.init?.headers ?? {}) as HeadersInit);
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("X-Authio-Project")).toBe("proj_abc");

    const body = JSON.parse(call.init?.body as string);
    expect(body).toEqual({
      email: "alice@example.com",
      redirect_uri: "https://app.example.com/auth/callback",
      next: "/dashboard",
      organization_id: "org_123",
    });
  });

  it("omits optional fields when they are not provided", async () => {
    const fetchImpl = makeMockFetch([
      {
        match: (url) => url.endsWith("/v1/auth/email-otp/send"),
        reply: () => ({ status: 202, body: { expires_in: 600 } }),
      },
    ]);

    await sendEmailOtp({
      apiUrl: "https://auth-api.test",
      projectId: "proj_abc",
      email: "alice@example.com",
      fetch: fetchImpl as unknown as typeof fetch,
    });

    const body = JSON.parse(fetchImpl.calls[0]!.init?.body as string);
    expect(body).toEqual({ email: "alice@example.com" });
  });

  it("throws a typed AuthioError on a 4xx", async () => {
    const fetchImpl = makeMockFetch([
      {
        match: (url) => url.endsWith("/v1/auth/email-otp/send"),
        reply: () => ({
          status: 429,
          body: { code: "rate_limited", message: "slow down" },
        }),
      },
    ]);

    let caught: unknown;
    try {
      await sendEmailOtp({
        apiUrl: "https://auth-api.test",
        projectId: "proj_abc",
        email: "alice@example.com",
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

describe("verifyEmailOtp", () => {
  const sessionReply = {
    access_token: "at_test",
    refresh_token: "rt_test",
    user: {
      id: "user_1",
      email: "alice@example.com",
      email_verified: true,
      name: "Alice",
      avatar_url: "https://cdn.example.com/a.png",
    },
  };

  it("POSTs the verify body with credentials and maps the envelope", async () => {
    const fetchImpl = makeMockFetch([
      {
        match: (url) => url.endsWith("/v1/auth/email-otp/verify"),
        reply: () => ({ status: 200, body: sessionReply }),
      },
    ]);

    const result = await verifyEmailOtp({
      apiUrl: "https://auth-api.test",
      projectId: "proj_abc",
      email: "alice@example.com",
      code: "123456",
      next: "/dashboard",
      organizationId: "org_123",
      clientLocation: {
        latitude: 40.7,
        longitude: -74.0,
        accuracy_m: 20,
        captured_at: "2026-07-01T00:00:00.000Z",
        source: "browser_geolocation",
      },
      deviceSignals: { timezone: "America/New_York", language: "en-US" },
      fetch: fetchImpl as unknown as typeof fetch,
    });

    const call = fetchImpl.calls[0]!;
    expect(call.url).toBe("https://auth-api.test/v1/auth/email-otp/verify");
    expect(call.init?.method).toBe("POST");
    expect(call.init?.credentials).toBe("include");

    const body = JSON.parse(call.init?.body as string);
    expect(body).toEqual({
      email: "alice@example.com",
      code: "123456",
      next: "/dashboard",
      organization_id: "org_123",
      client_location: {
        latitude: 40.7,
        longitude: -74.0,
        accuracy_m: 20,
        captured_at: "2026-07-01T00:00:00.000Z",
        source: "browser_geolocation",
      },
      device_signals: { timezone: "America/New_York", language: "en-US" },
    });

    expect(result).toEqual({
      accessToken: "at_test",
      refreshToken: "rt_test",
      sessionPolicy: null,
      user: {
        id: "user_1",
        email: "alice@example.com",
        emailVerified: true,
        name: "Alice",
        avatarUrl: "https://cdn.example.com/a.png",
      },
    });
  });

  it("throws invalid_code from auth-core on a wrong code", async () => {
    const fetchImpl = makeMockFetch([
      {
        match: (url) => url.endsWith("/v1/auth/email-otp/verify"),
        reply: () => ({
          status: 401,
          body: { code: "invalid_code", message: "code or email is incorrect" },
        }),
      },
    ]);

    let caught: unknown;
    try {
      await verifyEmailOtp({
        apiUrl: "https://auth-api.test",
        projectId: "proj_abc",
        email: "alice@example.com",
        code: "000000",
        fetch: fetchImpl as unknown as typeof fetch,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AuthioError);
    expect((caught as AuthioError).code).toBe("invalid_code");
    expect((caught as AuthioError).status).toBe(401);
  });

  it("throws step_up_required when the risk engine withholds the session", async () => {
    const fetchImpl = makeMockFetch([
      {
        match: (url) => url.endsWith("/v1/auth/email-otp/verify"),
        reply: () => ({
          status: 200,
          body: {
            decision: "step_up",
            challenge_id: "sup_1",
            required_method: "passkey",
          },
        }),
      },
    ]);

    let caught: unknown;
    try {
      await verifyEmailOtp({
        apiUrl: "https://auth-api.test",
        projectId: "proj_abc",
        email: "alice@example.com",
        code: "123456",
        fetch: fetchImpl as unknown as typeof fetch,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AuthioError);
    expect((caught as AuthioError).code).toBe("step_up_required");
  });
});
