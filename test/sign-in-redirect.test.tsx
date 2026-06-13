import React from "react";
import { act, render } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { AuthioProvider } from "../src/provider";
import { useAuthio } from "../src/hooks";
import { alwaysValidVerifier, makeMockFetch } from "./_helpers";

function SignInButton() {
  const { signIn } = useAuthio();
  return (
    <button type="button" onClick={() => signIn({ returnTo: "https://app.test/cb" })}>
      Sign in
    </button>
  );
}

describe("signIn() redirect", () => {
  const assign = vi.fn();

  beforeEach(() => {
    assign.mockReset();
    vi.stubGlobal("location", {
      ...window.location,
      href: "https://app.test/page",
      assign,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("redirects to Lobby with project_id and redirect_uri (not identity /v1/auth/sign-in)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchImpl = makeMockFetch([
      {
        match: (url) => url.endsWith("/v1/auth/refresh"),
        reply: () => ({ status: 401, body: {} }),
      },
    ]);

    const { getByRole } = render(
      <AuthioProvider
        apiUrl="https://auth-api.test"
        projectId="proj_abc"
        fetch={fetchImpl as unknown as typeof fetch}
        verifyToken={alwaysValidVerifier()}
        skipInitialRefresh
      >
        <SignInButton />
      </AuthioProvider>,
    );

    await act(async () => {
      getByRole("button").click();
    });

    expect(assign).toHaveBeenCalledOnce();
    const target = new URL(assign.mock.calls[0]![0] as string);
    expect(target.origin).toBe("https://lobby.authio.com");
    expect(target.searchParams.get("project_id")).toBe("proj_abc");
    expect(target.searchParams.get("redirect_uri")).toBe("https://app.test/cb");
    expect(target.searchParams.get("return_to")).toBeNull();
    expect(target.pathname).not.toContain("/v1/auth/sign-in");
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("warns and omits project_id when projectId is falsy", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchImpl = makeMockFetch([]);

    const { getByRole } = render(
      <AuthioProvider
        apiUrl="https://auth-api.test"
        projectId=""
        fetch={fetchImpl as unknown as typeof fetch}
        verifyToken={alwaysValidVerifier()}
        skipInitialRefresh
      >
        <SignInButton />
      </AuthioProvider>,
    );

    await act(async () => {
      getByRole("button").click();
    });

    const target = new URL(assign.mock.calls[0]![0] as string);
    expect(target.searchParams.has("project_id")).toBe(false);
    expect(target.searchParams.get("redirect_uri")).toBe("https://app.test/cb");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
