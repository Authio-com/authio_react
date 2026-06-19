import { describe, expect, it, vi } from "vitest";
import {
  addPasskey,
  buildEnrollPasskeyUrl,
  canEnrollPasskeyEmbedded,
  enrollPasskey,
  listPasskeys,
  mintPasskeyRegisterIntent,
  renamePasskey,
  revokePasskey,
  signInOrigin,
} from "../src/passkeys";
import { makeMockFetch } from "./_helpers";

vi.mock("@simplewebauthn/browser", () => ({
  startRegistration: vi.fn(async () => ({
    id: "cred-id",
    rawId: "cred-id",
    type: "public-key",
    response: { clientDataJSON: "e30", attestationObject: "e30" },
  })),
}));

describe("signInOrigin", () => {
  it("normalizes hosted UI base URLs", () => {
    expect(signInOrigin("https://auth.acme.com")).toBe("https://auth.acme.com");
    expect(signInOrigin("https://lobby.authio.com/")).toBe("https://lobby.authio.com");
  });
});

describe("canEnrollPasskeyEmbedded", () => {
  it("is true only when the page origin matches sign-in origin", () => {
    vi.stubGlobal("window", { location: { origin: "https://auth.acme.com" } });
    expect(canEnrollPasskeyEmbedded("https://auth.acme.com")).toBe(true);
    expect(canEnrollPasskeyEmbedded("https://app.acme.com")).toBe(false);
    vi.unstubAllGlobals();
  });
});

describe("buildEnrollPasskeyUrl", () => {
  it("threads add_credential params for hosted UI", () => {
    const url = buildEnrollPasskeyUrl({
      signInUrl: "https://auth.acme.com",
      projectId: "proj_abc",
      email: "user@acme.com",
      registerToken: "intent.jwt",
      redirectUri: "https://app.acme.com/settings/security",
      next: "/settings/security",
    });
    const target = new URL(url);
    expect(target.origin).toBe("https://auth.acme.com");
    expect(target.searchParams.get("mode")).toBe("add_credential");
    expect(target.searchParams.get("project_id")).toBe("proj_abc");
    expect(target.searchParams.get("email")).toBe("user@acme.com");
    expect(target.searchParams.get("token")).toBe("intent.jwt");
    expect(target.searchParams.get("redirect_uri")).toBe(
      "https://app.acme.com/settings/security",
    );
    expect(target.searchParams.get("next")).toBe("/settings/security");
  });
});

describe("passkey API helpers", () => {
  it("lists passkeys with bearer auth", async () => {
    const fetchImpl = makeMockFetch([
      {
        match: (url) => url.endsWith("/v1/me/passkeys"),
        reply: () => ({
          status: 200,
          body: {
            data: [
              {
                id: "cred_1",
                nickname: "MacBook",
                aaguid: null,
                authenticator_name: "Touch ID",
                transports: ["internal"],
                sign_count: 1,
                last_used_at: null,
                created_at: "2026-01-01T00:00:00Z",
              },
            ],
          },
        }),
      },
    ]);

    const rows = await listPasskeys({
      apiUrl: "https://auth-api.test",
      projectId: "proj_test",
      accessToken: "sess_tok",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.nickname).toBe("MacBook");
  });

  it("mints register intent then redirects for enrollment", async () => {
    const assign = vi.fn();
    vi.stubGlobal("window", {
      location: {
        origin: "https://app.acme.com",
        href: "https://app.acme.com/settings",
        assign,
      },
    });

    const fetchImpl = makeMockFetch([
      {
        match: (url) => url.endsWith("/v1/me/passkeys/register-intent"),
        reply: () => ({
          status: 200,
          body: { token: "intent.jwt", expires_in: 600 },
        }),
      },
    ]);

    await enrollPasskey({
      apiUrl: "https://auth-api.test",
      projectId: "proj_test",
      accessToken: "sess_tok",
      email: "user@acme.com",
      signInUrl: "https://auth.acme.com",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(assign).toHaveBeenCalledOnce();
    const target = new URL(assign.mock.calls[0]![0] as string);
    expect(target.searchParams.get("mode")).toBe("add_credential");
    expect(target.searchParams.get("token")).toBe("intent.jwt");
    expect(target.searchParams.get("redirect_uri")).toBe(
      "https://app.acme.com/settings",
    );

    vi.unstubAllGlobals();
  });

  it("mintPasskeyRegisterIntent returns token envelope", async () => {
    const fetchImpl = makeMockFetch([
      {
        match: (url) => url.endsWith("/v1/me/passkeys/register-intent"),
        reply: () => ({
          status: 200,
          body: { token: "intent.jwt", expires_in: 600 },
        }),
      },
    ]);

    const intent = await mintPasskeyRegisterIntent({
      apiUrl: "https://auth-api.test",
      projectId: "proj_test",
      accessToken: "sess_tok",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(intent).toEqual({ token: "intent.jwt", expiresIn: 600 });
  });

  it("addPasskey runs register-intent, options, and verify", async () => {
    vi.stubGlobal("window", { location: { origin: "https://auth.acme.com" } });

    const fetchImpl = makeMockFetch([
      {
        match: (url) => url.endsWith("/v1/me/passkeys/register-intent"),
        reply: () => ({
          status: 200,
          body: { token: "intent.jwt", expires_in: 600 },
        }),
      },
      {
        match: (url) => url.endsWith("/v1/auth/passkey/register/options"),
        reply: () => ({
          status: 200,
          body: { challenge: "abc", rp: { name: "Acme", id: "auth.acme.com" } },
        }),
      },
      {
        match: (url) => url.endsWith("/v1/auth/passkey/register/verify"),
        reply: () => ({ status: 200, body: { ok: true } }),
      },
    ]);

    await addPasskey({
      apiUrl: "https://auth-api.test",
      projectId: "proj_test",
      accessToken: "sess_tok",
      email: "user@acme.com",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(fetchImpl.calls).toHaveLength(3);
    const verifyCall = fetchImpl.calls[2]!;
    const headers = new Headers((verifyCall.init?.headers ?? {}) as HeadersInit);
    expect(headers.get("Authorization")).toBe("Bearer intent.jwt");
    expect(headers.get("X-Authio-Origin")).toBe("https://auth.acme.com");

    vi.unstubAllGlobals();
  });

  it("renamePasskey PATCHes nickname", async () => {
    const fetchImpl = makeMockFetch([
      {
        match: (url, init) =>
          url.includes("/v1/me/passkeys/cred_1") && init?.method === "PATCH",
        reply: () => ({ status: 200, body: { ok: true } }),
      },
    ]);

    await renamePasskey(
      {
        apiUrl: "https://auth-api.test",
        projectId: "proj_test",
        accessToken: "sess_tok",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      },
      "cred_1",
      "Work laptop",
    );

    const body = JSON.parse(fetchImpl.calls[0]!.init?.body as string);
    expect(body).toEqual({ nickname: "Work laptop" });
  });

  it("revokePasskey DELETEs credential", async () => {
    const fetchImpl = makeMockFetch([
      {
        match: (url, init) =>
          url.endsWith("/v1/me/passkeys/cred_1") && init?.method === "DELETE",
        reply: () => ({ status: 200, body: { ok: true } }),
      },
    ]);

    await revokePasskey(
      {
        apiUrl: "https://auth-api.test",
        projectId: "proj_test",
        accessToken: "sess_tok",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      },
      "cred_1",
    );

    expect(fetchImpl.calls[0]!.init?.method).toBe("DELETE");
  });
});
