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

  it("handleSignInResult verifies + adopts a handed-off token (pure-SPA token-handoff)", async () => {
    const exp = Math.floor(Date.now() / 1000) + 900;
    const token = makeJwt({ sub: "user_handoff", exp });
    const fetchImpl = makeMockFetch([]);

    let ctxRef: ReturnType<typeof useAuthio> | null = null;
    function Probe() {
      const ctx = useAuthio();
      ctxRef = ctx;
      return <span data-testid="status">{ctx.status}</span>;
    }

    render(
      <AuthioProvider
        apiUrl="https://auth-api.test"
        projectId="proj_test"
        fetch={fetchImpl as unknown as typeof fetch}
        skipInitialRefresh
        verifyToken={alwaysValidVerifier("user_handoff")}
      >
        <Probe />
      </AuthioProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("unauthenticated"),
    );

    await act(async () => {
      await ctxRef!.handleSignInResult({
        accessToken: token,
        refreshToken: "rt_handoff",
        user: { id: "user_handoff", email: "handoff@example.com", emailVerified: true },
      });
    });

    expect(screen.getByTestId("status").textContent).toBe("authenticated");
    expect(ctxRef!.accessToken).toBe(token);
    expect(ctxRef!.user?.email).toBe("handoff@example.com");
    // No network call was needed for the handoff itself.
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("handleSignInResult throws + stays unauthenticated when the token fails verification", async () => {
    const token = makeJwt({ sub: "user_bad", exp: 9999999999 });
    const fetchImpl = makeMockFetch([]);

    let ctxRef: ReturnType<typeof useAuthio> | null = null;
    function Probe() {
      const ctx = useAuthio();
      ctxRef = ctx;
      return <span data-testid="status">{ctx.status}</span>;
    }

    render(
      <AuthioProvider
        apiUrl="https://auth-api.test"
        projectId="proj_test"
        fetch={fetchImpl as unknown as typeof fetch}
        skipInitialRefresh
        verifyToken={alwaysInvalidVerifier}
      >
        <Probe />
      </AuthioProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("unauthenticated"),
    );

    await act(async () => {
      await expect(
        ctxRef!.handleSignInResult({ accessToken: token }),
      ).rejects.toMatchObject({ code: "token_rejected" });
    });

    expect(screen.getByTestId("status").textContent).toBe("unauthenticated");
    expect(ctxRef!.accessToken).toBeNull();
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

function PolicyProbe() {
  const ctx = useAuthio();
  return (
    <div>
      <span data-testid="status">{ctx.status}</span>
      <span data-testid="policy">
        {ctx.sessionPolicy ? JSON.stringify(ctx.sessionPolicy) : "no-policy"}
      </span>
    </div>
  );
}

describe("<AuthioProvider> session policy + idle-aware refresh", () => {
  function refreshMock(sessionPolicy: unknown, ttlSeconds = 300) {
    return makeMockFetch([
      {
        match: (url) => url.endsWith("/v1/auth/refresh"),
        reply: () => ({
          status: 200,
          body: {
            access_token: makeJwt({
              sub: "user_1",
              exp: Math.floor(Date.now() / 1000) + ttlSeconds,
            }),
            user: { id: "user_1", email: "a@b.test", email_verified: true },
            ...(sessionPolicy === undefined ? {} : { session_policy: sessionPolicy }),
          },
        }),
      },
    ]);
  }

  it("exposes sessionPolicy parsed from the envelope, null when absent", async () => {
    const withPolicy = refreshMock({
      idle_timeout_min: 30,
      absolute_max_min: 720,
      access_token_ttl_min: 5,
    });
    const { unmount } = render(
      <AuthioProvider
        apiUrl="https://auth-api.test"
        projectId="proj_test"
        fetch={withPolicy as unknown as typeof fetch}
        verifyToken={alwaysValidVerifier()}
      >
        <PolicyProbe />
      </AuthioProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("authenticated"),
    );
    expect(JSON.parse(screen.getByTestId("policy").textContent!)).toEqual({
      idleTimeoutMin: 30,
      absoluteMaxMin: 720,
      accessTokenTtlMin: 5,
    });
    unmount();

    const without = refreshMock(undefined);
    render(
      <AuthioProvider
        apiUrl="https://auth-api.test"
        projectId="proj_test"
        fetch={without as unknown as typeof fetch}
        verifyToken={alwaysValidVerifier()}
      >
        <PolicyProbe />
      </AuthioProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("authenticated"),
    );
    expect(screen.getByTestId("policy").textContent).toBe("no-policy");
  });

  async function mountAndCountTimerRefreshes(opts: {
    sessionPolicy: unknown;
    idleRefresh?: "defer" | "always";
    interactBeforeTick?: boolean;
  }) {
    const { vi } = await import("vitest");
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const events: string[] = [];
    try {
      const fetchImpl = refreshMock(opts.sessionPolicy, 300);
      render(
        <AuthioProvider
          apiUrl="https://auth-api.test"
          projectId="proj_test"
          fetch={fetchImpl as unknown as typeof fetch}
          verifyToken={alwaysValidVerifier()}
          refreshLeadSeconds={60}
          idleRefresh={opts.idleRefresh}
          onTelemetryEvent={(e) => events.push(e.kind)}
        >
          <PolicyProbe />
        </AuthioProvider>,
      );
      await waitFor(() =>
        expect(screen.getByTestId("status").textContent).toBe("authenticated"),
      );
      const bootstrapCalls = fetchImpl.calls.length;
      if (opts.interactBeforeTick) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(5_000);
          window.dispatchEvent(new Event("pointerdown"));
        });
      }
      // Jump past the scheduled tick (exp - lead = 240s).
      await act(async () => {
        await vi.advanceTimersByTimeAsync(250_000);
      });
      return {
        timerRefreshes: fetchImpl.calls.length - bootstrapCalls,
        events,
        fetchImpl,
      };
    } finally {
      vi.useRealTimers();
    }
  }

  it("keeps refreshing on the timer when there is no inactivity policy", async () => {
    const r = await mountAndCountTimerRefreshes({ sessionPolicy: undefined });
    expect(r.timerRefreshes).toBeGreaterThanOrEqual(1);
    expect(r.events).not.toContain("refresh_deferred");
  });

  it("keeps refreshing when the policy has idle_timeout_min = 0", async () => {
    const r = await mountAndCountTimerRefreshes({
      sessionPolicy: { idle_timeout_min: 0, absolute_max_min: 0, access_token_ttl_min: 15 },
    });
    expect(r.timerRefreshes).toBeGreaterThanOrEqual(1);
    expect(r.events).not.toContain("refresh_deferred");
  });

  it("defers the timer refresh while the user is idle under an inactivity policy", async () => {
    const r = await mountAndCountTimerRefreshes({
      sessionPolicy: { idle_timeout_min: 30, absolute_max_min: 720, access_token_ttl_min: 5 },
    });
    expect(r.timerRefreshes).toBe(0);
    expect(r.events).toContain("refresh_deferred");
  });

  it("refreshes on the timer when the user interacted since the last refresh", async () => {
    const r = await mountAndCountTimerRefreshes({
      sessionPolicy: { idle_timeout_min: 30, absolute_max_min: 720, access_token_ttl_min: 5 },
      interactBeforeTick: true,
    });
    expect(r.timerRefreshes).toBeGreaterThanOrEqual(1);
    expect(r.events).not.toContain("refresh_deferred");
  });

  it("resumes a deferred refresh on the next user interaction", async () => {
    const { vi } = await import("vitest");
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const events: string[] = [];
      const fetchImpl = refreshMock(
        { idle_timeout_min: 30, absolute_max_min: 720, access_token_ttl_min: 5 },
        300,
      );
      render(
        <AuthioProvider
          apiUrl="https://auth-api.test"
          projectId="proj_test"
          fetch={fetchImpl as unknown as typeof fetch}
          verifyToken={alwaysValidVerifier()}
          refreshLeadSeconds={60}
          onTelemetryEvent={(e) => events.push(e.kind)}
        >
          <PolicyProbe />
        </AuthioProvider>,
      );
      await waitFor(() =>
        expect(screen.getByTestId("status").textContent).toBe("authenticated"),
      );
      const bootstrapCalls = fetchImpl.calls.length;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(250_000);
      });
      expect(fetchImpl.calls.length - bootstrapCalls).toBe(0);
      expect(events).toContain("refresh_deferred");
      await act(async () => {
        window.dispatchEvent(new Event("keydown"));
        await vi.advanceTimersByTimeAsync(100);
      });
      await waitFor(() =>
        expect(fetchImpl.calls.length - bootstrapCalls).toBeGreaterThanOrEqual(1),
      );
      expect(events).toContain("refresh_resumed");
    } finally {
      vi.useRealTimers();
    }
  });

  it("idleRefresh=\"always\" never defers for inactivity", async () => {
    const r = await mountAndCountTimerRefreshes({
      sessionPolicy: { idle_timeout_min: 30, absolute_max_min: 720, access_token_ttl_min: 5 },
      idleRefresh: "always",
    });
    expect(r.timerRefreshes).toBeGreaterThanOrEqual(1);
    expect(r.events).not.toContain("refresh_deferred");
  });
});
