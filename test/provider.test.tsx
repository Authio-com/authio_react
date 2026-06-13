import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AuthioProvider } from "../src/provider";
import { useAuthio } from "../src/hooks";
import {
  alwaysInvalidVerifier,
  alwaysValidVerifier,
  makeJwt,
  makeMockFetch,
} from "./_helpers";

function StateProbe() {
  const ctx = useAuthio();
  return (
    <div>
      <span data-testid="status">{ctx.status}</span>
      <span data-testid="user">{ctx.user?.email ?? "no-user"}</span>
      <span data-testid="token">{ctx.accessToken ?? "no-token"}</span>
    </div>
  );
}

describe("<AuthioProvider>", () => {
  it("starts in loading, then transitions to unauthenticated on 401 refresh", async () => {
    const fetchImpl = makeMockFetch([
      {
        match: (url) => url.endsWith("/v1/auth/refresh"),
        reply: () => ({
          status: 401,
          body: { code: "no_session", message: "no session cookie" },
        }),
      },
    ]);

    render(
      <AuthioProvider
        apiUrl="https://auth-api.test"
        projectId="proj_test"
        fetch={fetchImpl as unknown as typeof fetch}
        verifyToken={alwaysValidVerifier()}
      >
        <StateProbe />
      </AuthioProvider>,
    );

    expect(screen.getByTestId("status").textContent).toBe("loading");
    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("unauthenticated"),
    );
    expect(screen.getByTestId("token").textContent).toBe("no-token");
  });

  it("transitions to authenticated when refresh returns a verifiable token", async () => {
    const exp = Math.floor(Date.now() / 1000) + 900;
    const token = makeJwt({ sub: "user_42", exp });
    const fetchImpl = makeMockFetch([
      {
        match: (url) => url.endsWith("/v1/auth/refresh"),
        reply: () => ({
          status: 200,
          body: {
            access_token: token,
            expires_at: new Date(exp * 1000).toISOString(),
            user: {
              id: "user_42",
              email: "alice@example.com",
              email_verified: true,
            },
          },
        }),
      },
    ]);

    render(
      <AuthioProvider
        apiUrl="https://auth-api.test"
        projectId="proj_test"
        fetch={fetchImpl as unknown as typeof fetch}
        verifyToken={alwaysValidVerifier("user_42")}
      >
        <StateProbe />
      </AuthioProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("authenticated"),
    );
    expect(screen.getByTestId("user").textContent).toBe("alice@example.com");
    expect(screen.getByTestId("token").textContent).toBe(token);
  });

  it("discards the token and transitions to unauthenticated when verification fails", async () => {
    const token = makeJwt({ sub: "user_42", exp: 9999999999 });
    const fetchImpl = makeMockFetch([
      {
        match: (url) => url.endsWith("/v1/auth/refresh"),
        reply: () => ({
          status: 200,
          body: { access_token: token },
        }),
      },
    ]);

    render(
      <AuthioProvider
        apiUrl="https://auth-api.test"
        projectId="proj_test"
        fetch={fetchImpl as unknown as typeof fetch}
        verifyToken={alwaysInvalidVerifier}
      >
        <StateProbe />
      </AuthioProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("unauthenticated"),
    );
    expect(screen.getByTestId("token").textContent).toBe("no-token");
  });

  it("starts unauthenticated when skipInitialRefresh is true", async () => {
    const fetchImpl = makeMockFetch([]);
    render(
      <AuthioProvider
        apiUrl="https://auth-api.test"
        projectId="proj_test"
        fetch={fetchImpl as unknown as typeof fetch}
        skipInitialRefresh
        verifyToken={alwaysValidVerifier()}
      >
        <StateProbe />
      </AuthioProvider>,
    );
    // No microtasks needed — initial render is unauthenticated.
    await act(async () => {});
    expect(screen.getByTestId("status").textContent).toBe("unauthenticated");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sends X-Authio-Project header on the refresh call", async () => {
    const fetchImpl = makeMockFetch([
      {
        match: (url) => url.endsWith("/v1/auth/refresh"),
        reply: () => ({ status: 401, body: {} }),
      },
    ]);

    render(
      <AuthioProvider
        apiUrl="https://auth-api.test"
        projectId="proj_xyz"
        fetch={fetchImpl as unknown as typeof fetch}
        verifyToken={alwaysValidVerifier()}
      >
        <StateProbe />
      </AuthioProvider>,
    );

    await waitFor(() => {
      expect(fetchImpl).toHaveBeenCalled();
    });
    const call = fetchImpl.calls[0];
    expect(call).toBeDefined();
    const headers = new Headers((call!.init?.headers ?? {}) as HeadersInit);
    expect(headers.get("X-Authio-Project")).toBe("proj_xyz");
  });
});
