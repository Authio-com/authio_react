import { useContext, useEffect, type ReactNode } from "react";
import { AuthioContext } from "./provider";
import { isBrowser } from "./ssr";
import type { AuthioContextValue, AuthioUser } from "./types";

/**
 * Throws if called outside `<AuthioProvider>` — the most common
 * mistake people make is dropping a hook into a page that hasn't
 * been wrapped yet.
 *
 * The return shape is stable per render — `getAccessToken`,
 * `signIn`, `signOut`, `refresh` are referentially identical
 * across renders so they're safe in dependency arrays.
 */
export function useAuthio(): AuthioContextValue {
  const ctx = useContext(AuthioContext);
  if (!ctx) {
    throw new Error(
      "useAuthio() must be used inside an <AuthioProvider>. Wrap your app " +
        "root with `<AuthioProvider apiUrl=… projectId=…>` once.",
    );
  }
  return ctx;
}

export interface UseAuthioRequiredOptions {
  /**
   * Element to render while the provider is still loading the
   * initial session (between mount and the first refresh result).
   * Defaults to `null`.
   */
  fallback?: ReactNode;
  /**
   * Path the SDK should redirect the user to when status resolves
   * to `unauthenticated`. Optional — when omitted we call
   * `signIn()` which targets the auth-core hosted UI.
   */
  redirectTo?: string;
}

export interface UseAuthioRequiredResult {
  user: AuthioUser | null;
  status: "loading" | "authenticated" | "unauthenticated";
  accessToken: string | null;
  /**
   * Renderable React node — return this directly from your
   * component. While loading or unauthenticated this carries the
   * fallback (or null); once authenticated it returns `null` so
   * the caller continues to render its own protected content.
   *
   * Patterns:
   *
   * ```tsx
   * function Dashboard() {
   *   const { user, gate } = useAuthioRequired({ fallback: <Spinner /> });
   *   if (gate) return gate;
   *   return <h1>Hello {user!.email}</h1>;
   * }
   * ```
   */
  gate: ReactNode | null;
}

/**
 * Convenience hook for "this view requires a session". While the
 * provider is loading the initial session it returns `fallback`;
 * when it resolves to unauthenticated it triggers a redirect to
 * `redirectTo` (or the auth-core hosted UI via `signIn()`) and
 * keeps rendering the fallback to bridge the navigation. Once
 * authenticated, `gate` is `null` and the caller renders its
 * protected content.
 *
 * SSR-safe — under SSR `gate` resolves to the fallback so the
 * server render doesn't redirect.
 */
export function useAuthioRequired(
  opts: UseAuthioRequiredOptions = {},
): UseAuthioRequiredResult {
  const { fallback = null, redirectTo } = opts;
  const ctx = useAuthio();

  useEffect(() => {
    if (ctx.status !== "unauthenticated") return;
    if (!isBrowser()) return;
    if (redirectTo) {
      window.location.assign(redirectTo);
      return;
    }
    ctx.signIn();
  }, [ctx, redirectTo]);

  let gate: ReactNode | null = null;
  if (ctx.status === "loading") gate = fallback;
  else if (ctx.status === "unauthenticated") gate = fallback;

  return {
    user: ctx.user,
    status: ctx.status,
    accessToken: ctx.accessToken,
    gate,
  };
}
