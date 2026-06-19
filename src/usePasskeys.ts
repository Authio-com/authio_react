import { useCallback, useEffect, useState } from "react";
import { useAuthio } from "./hooks";
import {
  enrollPasskey,
  listPasskeys,
  renamePasskey,
  revokePasskey,
  type AuthioPasskey,
} from "./passkeys";

export interface UsePasskeysResult {
  passkeys: AuthioPasskey[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  rename: (credentialId: string, nickname: string) => Promise<void>;
  revoke: (credentialId: string) => Promise<void>;
  enroll: (opts?: { returnUrl?: string; next?: string }) => Promise<void>;
}

/**
 * Load and mutate the signed-in user's passkeys via `/v1/me/passkeys`.
 * Requires `<AuthioProvider>` with a live session.
 */
export function usePasskeys(): UsePasskeysResult {
  const ctx = useAuthio();
  const [passkeys, setPasskeys] = useState<AuthioPasskey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (ctx.status !== "authenticated") {
      setPasskeys([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const token = await ctx.getAccessToken();
      if (!token) {
        setPasskeys([]);
        return;
      }
      const rows = await listPasskeys({
        apiUrl: ctx.apiUrl,
        projectId: ctx.projectId,
        accessToken: token,
        fetchImpl: ctx.fetchImpl,
      });
      setPasskeys(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load passkeys");
      setPasskeys([]);
    } finally {
      setLoading(false);
    }
  }, [
    ctx.status,
    ctx.getAccessToken,
    ctx.apiUrl,
    ctx.projectId,
    ctx.fetchImpl,
  ]);

  useEffect(() => {
    void refresh();
  }, [refresh, ctx.status]);

  const rename = useCallback(
    async (credentialId: string, nickname: string) => {
      const token = await ctx.getAccessToken();
      if (!token) throw new Error("Not signed in");
      await renamePasskey(
        {
          apiUrl: ctx.apiUrl,
          projectId: ctx.projectId,
          accessToken: token,
          fetchImpl: ctx.fetchImpl,
        },
        credentialId,
        nickname,
      );
      await refresh();
    },
    [ctx.getAccessToken, ctx.apiUrl, ctx.projectId, ctx.fetchImpl, refresh],
  );

  const revoke = useCallback(
    async (credentialId: string) => {
      const token = await ctx.getAccessToken();
      if (!token) throw new Error("Not signed in");
      await revokePasskey(
        {
          apiUrl: ctx.apiUrl,
          projectId: ctx.projectId,
          accessToken: token,
          fetchImpl: ctx.fetchImpl,
        },
        credentialId,
      );
      await refresh();
    },
    [ctx.getAccessToken, ctx.apiUrl, ctx.projectId, ctx.fetchImpl, refresh],
  );

  const enroll = useCallback(
    async (opts?: { returnUrl?: string; next?: string }) => {
      const token = await ctx.getAccessToken();
      const email = ctx.user?.email;
      if (!token || !email) throw new Error("Not signed in");
      await enrollPasskey({
        apiUrl: ctx.apiUrl,
        projectId: ctx.projectId,
        accessToken: token,
        fetchImpl: ctx.fetchImpl,
        email,
        signInUrl: ctx.signInUrl,
        returnUrl: opts?.returnUrl,
        next: opts?.next,
      });
    },
    [
      ctx.getAccessToken,
      ctx.user?.email,
      ctx.apiUrl,
      ctx.projectId,
      ctx.fetchImpl,
      ctx.signInUrl,
    ],
  );

  return { passkeys, loading, error, refresh, rename, revoke, enroll };
}
