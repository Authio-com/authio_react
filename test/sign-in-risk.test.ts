import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signInWithPasskey, verifyEmailOtp } from "../src/sign-in";
import {
  AUTHIO_MESSAGES,
  AuthioError,
  AuthioSignInDeniedError,
  AuthioStepUpRequiredError,
  isStepUpRequired,
  wrapFetchError,
} from "../src/errors";
import { authioFetch } from "../src/fetch";
import { makeMockFetch } from "./_helpers";

const API = "https://auth-api.test";
const STEP_UP_URL =
  "https://lobby.authio.com/step-up?challenge=sup_bz&method=passkey&redirect_uri=https%3A%2F%2Fapp.example.com%2Fcb";

const stepUpBody = {
  decision: "step_up",
  challenge_id: "sup_bz",
  required_method: "passkey",
  reasons: ["new_country", "new_device"],
  redirect_uri: "https://app.example.com/cb",
  message: "Additional verification required. Re-authenticate with a passkey to continue.",
  step_up_url: STEP_UP_URL,
};

async function caught(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (err) {
    return err;
  }
  throw new Error("expected promise to reject");
}

function otp(reply: { status: number; body: unknown }) {
  const fetchImpl = makeMockFetch([
    { match: (u) => u.endsWith("/v1/auth/email-otp/verify"), reply: () => reply },
  ]);
  return verifyEmailOtp({
    apiUrl: API,
    projectId: "proj_abc",
    email: "alice@example.com",
    code: "123456",
    fetch: fetchImpl as unknown as typeof fetch,
  });
}

function expectReadable(err: AuthioError) {
  expect(err.message.length).toBeGreaterThan(10);
  expect(err.message).not.toMatch(/Cannot read properties|undefined|TypeError|fetch failed|Failed to fetch|status \d{3}/);
}

describe("verifyEmailOtp risk outcomes", () => {
  it("step_up → AuthioStepUpRequiredError with stepUpUrl, challengeId, requiredMethod", async () => {
    const err = await caught(otp({ status: 200, body: stepUpBody }));
    expect(err).toBeInstanceOf(AuthioError);
    expect(err).toBeInstanceOf(AuthioStepUpRequiredError);
    expect(isStepUpRequired(err)).toBe(true);
    const e = err as AuthioStepUpRequiredError;
    expect(e.code).toBe("step_up_required");
    expect(e.status).toBe(200);
    expect(e.stepUpUrl).toBe(STEP_UP_URL);
    expect(e.challengeId).toBe("sup_bz");
    expect(e.requiredMethod).toBe("passkey");
    expect(e.reasons).toEqual(["new_country", "new_device"]);
    expect(e.message).toBe(AUTHIO_MESSAGES.step_up_required);
    expect(e.serverMessage).toContain("passkey");
  });

  it("step_up from an older auth-core (no step_up_url) still throws a typed error", async () => {
    const err = (await caught(
      otp({ status: 200, body: { decision: "step_up", challenge_id: "sup_1", required_method: "totp" } }),
    )) as AuthioStepUpRequiredError;
    expect(err.code).toBe("step_up_required");
    expect(err.stepUpUrl).toBeUndefined();
    expect(err.requiredMethod).toBe("totp");
  });

  it("deny (403 decision:block) → sign_in_denied with the server's message", async () => {
    const err = (await caught(
      otp({
        status: 403,
        body: {
          error: "blocked_by_geo_policy",
          code: "blocked_by_geo_policy",
          decision: "block",
          country: "BZ",
          reasons: ["country_not_allowed"],
          message: "Sign-in blocked by this project's country policy. Contact your administrator if you need a travel grant.",
        },
      }),
    )) as AuthioSignInDeniedError;
    expect(err).toBeInstanceOf(AuthioSignInDeniedError);
    expect(err.code).toBe("sign_in_denied");
    expect(err.status).toBe(403);
    expect(err.denyCode).toBe("blocked_by_geo_policy");
    expect(err.reasons).toEqual(["country_not_allowed"]);
    expect(err.message).toContain("country policy");
  });

  it("deny without a message falls back to readable copy", async () => {
    const err = (await caught(
      otp({ status: 403, body: { decision: "block", error: "blocked_by_risk_policy" } }),
    )) as AuthioError;
    expect(err.code).toBe("sign_in_denied");
    expect(err.message).toBe(AUTHIO_MESSAGES.sign_in_denied);
  });

  it("200 with no tokens → invalid_response", async () => {
    const err = (await caught(otp({ status: 200, body: { ok: true } }))) as AuthioError;
    expect(err).toBeInstanceOf(AuthioError);
    expect(err.code).toBe("invalid_response");
    expectReadable(err);
  });

  it("200 with a token but no user → invalid_response (never a TypeError)", async () => {
    const err = (await caught(otp({ status: 200, body: { access_token: "at" } }))) as AuthioError;
    expect(err.code).toBe("invalid_response");
  });

  it("200 empty body → invalid_response", async () => {
    const err = (await caught(otp({ status: 200, body: undefined }))) as AuthioError;
    expect(err.code).toBe("invalid_response");
  });
});

describe("signInWithPasskey risk outcomes", () => {
  const originalCredentials = Object.getOwnPropertyDescriptor(navigator, "credentials");

  beforeEach(() => {
    Object.defineProperty(navigator, "credentials", {
      configurable: true,
      value: {
        get: vi.fn(async () => ({
          id: "cred",
          type: "public-key",
          rawId: new Uint8Array([1, 2]).buffer,
          response: {
            clientDataJSON: new Uint8Array([1]).buffer,
            authenticatorData: new Uint8Array([2]).buffer,
            signature: new Uint8Array([3]).buffer,
            userHandle: null,
          },
        })),
      },
    });
  });
  afterEach(() => {
    if (originalCredentials) Object.defineProperty(navigator, "credentials", originalCredentials);
    else delete (navigator as unknown as Record<string, unknown>).credentials;
  });

  function passkey(verify: { status: number; body: unknown }) {
    const fetchImpl = makeMockFetch([
      {
        match: (u) => u.endsWith("/v1/auth/passkey/login/options"),
        reply: () => ({ status: 200, body: { challenge: "AAEC", rpId: "authio.test" } }),
      },
      { match: (u) => u.endsWith("/v1/auth/passkey/login/verify"), reply: () => verify },
    ]);
    return signInWithPasskey({
      apiUrl: API,
      projectId: "proj_abc",
      fetch: fetchImpl as unknown as typeof fetch,
    });
  }

  it("step_up 200 without user → AuthioStepUpRequiredError (regression: verifyRes.user.id TypeError)", async () => {
    const err = (await caught(passkey({ status: 200, body: stepUpBody }))) as AuthioStepUpRequiredError;
    expect(err).toBeInstanceOf(AuthioStepUpRequiredError);
    expect(err.code).toBe("step_up_required");
    expect(err.stepUpUrl).toBe(STEP_UP_URL);
    expect(err.challengeId).toBe("sup_bz");
    expect(err.requiredMethod).toBe("passkey");
  });

  it("deny → sign_in_denied", async () => {
    const err = (await caught(
      passkey({ status: 403, body: { decision: "block", code: "blocked_by_risk_policy", message: "Sign-in blocked by risk policy." } }),
    )) as AuthioError;
    expect(err.code).toBe("sign_in_denied");
    expect(err.message).toBe("Sign-in blocked by risk policy.");
  });

  it("200 with no tokens → invalid_response", async () => {
    const err = (await caught(passkey({ status: 200, body: {} }))) as AuthioError;
    expect(err.code).toBe("invalid_response");
    expectReadable(err);
  });

  it("maps a successful envelope", async () => {
    const res = await passkey({
      status: 200,
      body: { access_token: "at", refresh_token: "rt", user: { id: "user_1", email: "a@x.io", email_verified: true } },
    });
    expect(res.accessToken).toBe("at");
    expect(res.user).toMatchObject({ id: "user_1", email: "a@x.io", emailVerified: true });
  });

  it("user cancelling the passkey prompt gives a readable message, raw text on cause", async () => {
    const domErr = new DOMException(
      "The operation either timed out or was not allowed. See: https://www.w3.org/TR/webauthn-2/#sec-assertion-privacy.",
      "NotAllowedError",
    );
    (navigator.credentials.get as ReturnType<typeof vi.fn>).mockRejectedValueOnce(domErr);
    const err = (await caught(passkey({ status: 200, body: {} }))) as AuthioError & { cause?: unknown };
    expect(err.code).toBe("webauthn_cancelled");
    expect(err.message).toBe(AUTHIO_MESSAGES.webauthn_cancelled);
    expect(err.cause).toBe(domErr);
  });

  it("options response without a challenge → invalid_response", async () => {
    const fetchImpl = makeMockFetch([
      { match: (u) => u.endsWith("/v1/auth/passkey/login/options"), reply: () => ({ status: 200, body: {} }) },
    ]);
    const err = (await caught(
      signInWithPasskey({ apiUrl: API, projectId: "proj_abc", fetch: fetchImpl as unknown as typeof fetch }),
    )) as AuthioError;
    expect(err.code).toBe("invalid_response");
  });
});

describe("transport error messages are plain English", () => {
  it("network failure hides the raw TypeError", async () => {
    const raw = new TypeError("Failed to fetch");
    const fetchImpl = vi.fn(async () => {
      throw raw;
    });
    const err = (await caught(
      authioFetch({ apiUrl: API, projectId: "p", path: "/x", fetchImpl: fetchImpl as unknown as typeof fetch }),
    )) as AuthioError & { cause?: unknown };
    expect(err.code).toBe("network_error");
    expect(err.message).toBe(AUTHIO_MESSAGES.network_error);
    expect(err.cause).toBe(raw);
  });

  it("internal timeout → code timeout with readable copy", () => {
    const err = wrapFetchError(new DOMException("Request timed out", "AbortError"));
    expect(err.code).toBe("timeout");
    expect(err.message).toBe(AUTHIO_MESSAGES.timeout);
  });

  it("caller abort → code aborted", () => {
    const err = wrapFetchError(new DOMException("signal is aborted without reason", "AbortError"));
    expect(err.code).toBe("aborted");
    expectReadable(err);
  });

  it("5xx without a message → readable server error", async () => {
    const fetchImpl = makeMockFetch([{ match: () => true, reply: () => ({ status: 502, body: {} }) }]);
    const err = (await caught(
      authioFetch({ apiUrl: API, projectId: "p", path: "/x", fetchImpl: fetchImpl as unknown as typeof fetch }),
    )) as AuthioError;
    expect(err.code).toBe("request_failed");
    expect(err.status).toBe(502);
    expect(err.message).toBe(AUTHIO_MESSAGES.server_error);
  });

  it("429 without a message → readable rate-limit copy", async () => {
    const fetchImpl = makeMockFetch([{ match: () => true, reply: () => ({ status: 429, body: {} }) }]);
    const err = (await caught(
      authioFetch({ apiUrl: API, projectId: "p", path: "/x", fetchImpl: fetchImpl as unknown as typeof fetch }),
    )) as AuthioError;
    expect(err.message).toBe(AUTHIO_MESSAGES.rate_limited);
  });

  it("non-JSON 200 → invalid_response with readable copy", async () => {
    const fetchImpl = vi.fn(async () => new Response("<html>oops</html>", { status: 200 }));
    const err = (await caught(
      authioFetch({ apiUrl: API, projectId: "p", path: "/x", fetchImpl: fetchImpl as unknown as typeof fetch }),
    )) as AuthioError;
    expect(err.code).toBe("invalid_response");
    expect(err.message).toBe(AUTHIO_MESSAGES.invalid_response);
  });

  it("server messages are passed through unchanged", async () => {
    const fetchImpl = makeMockFetch([
      { match: () => true, reply: () => ({ status: 401, body: { code: "invalid_code", message: "That code is incorrect." } }) },
    ]);
    const err = (await caught(
      authioFetch({ apiUrl: API, projectId: "p", path: "/x", fetchImpl: fetchImpl as unknown as typeof fetch }),
    )) as AuthioError;
    expect(err.code).toBe("invalid_code");
    expect(err.message).toBe("That code is incorrect.");
  });
});
