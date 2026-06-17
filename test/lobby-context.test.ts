import { describe, expect, it, vi } from "vitest";
import { mintLobbySignInUrl } from "../src/lobby-context";

describe("mintLobbySignInUrl", () => {
  it("uses ?ctx= when auth-core mint succeeds", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ ctx: "signed.ctx.token" }),
    );

    const url = await mintLobbySignInUrl({
      apiUrl: "https://auth-api.test",
      projectId: "proj_abc",
      hostedUiUrl: "https://lobby.authio.com/",
      redirectUri: "https://app.test/cb",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const target = new URL(url);
    expect(target.origin).toBe("https://lobby.authio.com");
    expect(target.searchParams.get("ctx")).toBe("signed.ctx.token");
    expect(target.searchParams.has("project_id")).toBe(false);
    expect(target.searchParams.has("redirect_uri")).toBe(false);
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [, init] = fetchImpl.mock.calls[0]!;
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual({
      project_id: "proj_abc",
      redirect_uri: "https://app.test/cb",
    });
  });

  it("falls back to legacy query params when mint fails", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 503 }));

    const url = await mintLobbySignInUrl({
      apiUrl: "https://auth-api.test",
      projectId: "proj_abc",
      hostedUiUrl: "https://lobby.authio.com/",
      redirectUri: "https://app.test/cb",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const target = new URL(url);
    expect(target.searchParams.get("project_id")).toBe("proj_abc");
    expect(target.searchParams.get("redirect_uri")).toBe("https://app.test/cb");
    expect(target.searchParams.has("ctx")).toBe(false);
  });

  it("omits project_id when projectId is empty", async () => {
    const fetchImpl = vi.fn();

    const url = await mintLobbySignInUrl({
      apiUrl: "https://auth-api.test",
      projectId: "",
      hostedUiUrl: "https://lobby.authio.com/",
      redirectUri: "https://app.test/cb",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const target = new URL(url);
    expect(target.searchParams.has("project_id")).toBe(false);
    expect(target.searchParams.get("redirect_uri")).toBe("https://app.test/cb");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
