import { useCallback, useEffect, useState } from "react";
import { useAuthio } from "./hooks";
import {
  enrollPasskey,
  listPasskeys,
  renamePasskey,
  revokePasskey,
  type AuthioPasskey,
} from "./passkeys";
import { AUTHIO_MESSAGES, AuthioError } from "./errors";

function notSignedIn(): AuthioError {
  return new AuthioError({
    code: "not_signed_in",
    message: AUTHIO_MESSAGES.not_signed_in,
    status: 401,
  });
}

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
      setError(err instanceof AuthioError ? err.message : "We couldn't load your passkeys. Please refresh the page and try again.");
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
      if (!token) throw notSignedIn();
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
      if (!token) throw notSignedIn();
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
      if (!token || !email) throw notSignedIn();
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
