import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AuthioProvider } from "../src/provider";
import { SignedIn, SignedOut } from "../src/gates";
import { alwaysValidVerifier, makeJwt, makeMockFetch } from "./_helpers";

describe("<SignedIn> / <SignedOut>", () => {
  it("renders nothing while loading", async () => {
    // Refresh hangs forever (never resolves) — provider stays in loading.
    const fetchImpl = (() => Promise.race([])) as unknown as typeof fetch;
    render(
      <AuthioProvider
        apiUrl="https://auth-api.test"
        projectId="proj_test"
        fetch={fetchImpl}
        verifyToken={alwaysValidVerifier()}
      >
        <SignedIn>
          <span data-testid="in-content">IN</span>
        </SignedIn>
        <SignedOut>
          <span data-testid="out-content">OUT</span>
        </SignedOut>
      </AuthioProvider>,
    );
    expect(screen.queryByTestId("in-content")).toBeNull();
    expect(screen.queryByTestId("out-content")).toBeNull();
  });

  it("renders <SignedOut> children when unauthenticated", async () => {
    const fetchImpl = makeMockFetch([
      {
        match: (url) => url.endsWith("/v1/auth/refresh"),
        reply: () => ({ status: 401, body: {} }),
      },
    ]);
    render(
      <AuthioProvider
        apiUrl="https://auth-api.test"
        projectId="proj_test"
        fetch={fetchImpl as unknown as typeof fetch}
        verifyToken={alwaysValidVerifier()}
      >
        <SignedIn>
          <span data-testid="in-content">IN</span>
        </SignedIn>
        <SignedOut>
          <span data-testid="out-content">OUT</span>
        </SignedOut>
      </AuthioProvider>,
    );
    await waitFor(() =>
      expect(screen.queryByTestId("out-content")).not.toBeNull(),
    );
    expect(screen.queryByTestId("in-content")).toBeNull();
  });

  it("renders <SignedIn> children when authenticated", async () => {
    const exp = Math.floor(Date.now() / 1000) + 900;
    const token = makeJwt({ sub: "user_42", exp });
    const fetchImpl = makeMockFetch([
      {
        match: (url) => url.endsWith("/v1/auth/refresh"),
        reply: () => ({
          status: 200,
          body: {
            access_token: token,
            user: { id: "user_42", email: "a@b.c" },
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
        <SignedIn>
          <span data-testid="in-content">IN</span>
        </SignedIn>
        <SignedOut>
          <span data-testid="out-content">OUT</span>
        </SignedOut>
      </AuthioProvider>,
    );
    await waitFor(() =>
      expect(screen.queryByTestId("in-content")).not.toBeNull(),
    );
    expect(screen.queryByTestId("out-content")).toBeNull();
  });
});
