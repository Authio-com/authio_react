import { SDK_USER_AGENT } from "./version";

export interface MintLobbySignInUrlOptions {
  apiUrl: string;
  projectId: string;
  hostedUiUrl: string;
  redirectUri: string;
  /** Post-login path threaded separately from redirect_uri (BFF ?next=). */
  next?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Build a Lobby sign-in URL. Prefers a short-lived signed `?ctx=` token
 * minted by auth-core; falls back to legacy `project_id` / `redirect_uri`
 * query params when minting is unavailable.
 */
export async function mintLobbySignInUrl(
  opts: MintLobbySignInUrlOptions,
): Promise<string> {
  const target = new URL(opts.hostedUiUrl.replace(/\/$/, "") + "/");

  if (opts.projectId) {
    try {
      const fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
      const res = await fetchImpl(
        `${opts.apiUrl.replace(/\/$/, "")}/v1/auth/lobby-context`,
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "X-Authio-Project": opts.projectId,
            "X-Authio-SDK": SDK_USER_AGENT,
          },
          body: JSON.stringify({
            project_id: opts.projectId,
            redirect_uri: opts.redirectUri,
            ...(opts.next ? { next: opts.next } : {}),
          }),
        },
      );
      if (res.ok) {
        const body = (await res.json()) as { ctx?: unknown };
        if (typeof body.ctx === "string" && body.ctx.trim()) {
          target.searchParams.set("ctx", body.ctx.trim());
          return target.toString();
        }
      }
    } catch {
      // Fall through to legacy query params.
    }
  }

  if (opts.projectId) {
    target.searchParams.set("project_id", opts.projectId);
  }
  target.searchParams.set("redirect_uri", opts.redirectUri);
  if (opts.next) {
    target.searchParams.set("next", opts.next);
  }
  return target.toString();
}
