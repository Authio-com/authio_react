import React, { useEffect } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AuthioProvider } from "../src/provider";
import { useAuthio } from "../src/hooks";
import { alwaysValidVerifier, makeJwt, makeMockFetch } from "./_helpers";

function SignOutHarness({ signOutOnReady }: { signOutOnReady: boolean }) {
  const { status, user, accessToken, signOut } = useAuthio();
  useEffect(() => {
    if (signOutOnReady && status === "authenticated") {
      void signOut();
    }
  }, [signOutOnReady, status, signOut]);
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="user">{user?.email ?? "no-user"}</span>
      <span data-testid="token">{accessToken ?? "no-token"}</span>
    </div>
  );
}

describe("signOut()", () => {
  it("clears local state and posts to /v1/auth/sign-out", async () => {
    const exp = Math.floor(Date.now() / 1000) + 900;
    const token = makeJwt({ sub: "user_42", exp });
    const fetchImpl = makeMockFetch([
      {
        match: (url) => url.endsWith("/v1/auth/refresh"),
        reply: () => ({
          status: 200,
          body: {
            access_token: token,
            user: { id: "user_42", email: "alice@example.com" },
          },
        }),
      },
      {
        match: (url) => url.endsWith("/v1/auth/sign-out"),
        reply: () => ({ status: 204, body: undefined }),
      },
    ]);

    render(
      <AuthioProvider
        apiUrl="https://auth-api.test"
        projectId="proj_test"
        fetch={fetchImpl as unknown as typeof fetch}
        verifyToken={alwaysValidVerifier("user_42")}
      >
        <SignOutHarness signOutOnReady />
      </AuthioProvider>,
    );

    // First: become authenticated
    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("authenticated"),
    );
    // Then: signOut triggers (via the effect) and we transition out
    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("unauthenticated"),
    );
    expect(screen.getByTestId("user").textContent).toBe("no-user");
    expect(screen.getByTestId("token").textContent).toBe("no-token");

    // Verify the sign-out endpoint was hit at least once.
    const calledSignOut = fetchImpl.calls.some((c) =>
      c.url.endsWith("/v1/auth/sign-out"),
    );
    expect(calledSignOut).toBe(true);
  });
});
