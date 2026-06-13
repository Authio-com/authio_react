import React, { useEffect, type ReactNode } from "react";
import { useAuthio } from "./hooks";
import { isBrowser } from "./ssr";

export interface SignedInProps {
  children: ReactNode;
}

/**
 * Renders `children` only when the provider's status is
 * `"authenticated"`. Renders nothing while loading — this matches
 * Clerk's `<SignedIn>` semantics so authenticated-only UI doesn't
 * flash during the initial refresh.
 */
export function SignedIn({ children }: SignedInProps): React.ReactElement | null {
  const { status } = useAuthio();
  if (status !== "authenticated") return null;
  return <>{children}</>;
}

export interface SignedOutProps {
  children: ReactNode;
}

/**
 * Renders `children` only when the provider's status is
 * `"unauthenticated"`. Renders nothing while loading.
 */
export function SignedOut({ children }: SignedOutProps): React.ReactElement | null {
  const { status } = useAuthio();
  if (status !== "unauthenticated") return null;
  return <>{children}</>;
}

export interface RedirectToSignInProps {
  /**
   * Target URL the user should land on after sign-in completes.
   * Forwarded to Lobby as `?redirect_uri=…`. Defaults to the
   * current `window.location.href`.
   */
  returnTo?: string;
}

/**
 * Declarative redirect. Drop into your routing layer to bounce
 * unauthenticated visitors to the hosted UI:
 *
 * ```tsx
 * <SignedOut>
 *   <RedirectToSignIn returnTo="/dashboard" />
 * </SignedOut>
 * ```
 *
 * SSR-safe — no-op under server render.
 */
export function RedirectToSignIn({
  returnTo,
}: RedirectToSignInProps): React.ReactElement | null {
  const { signIn } = useAuthio();
  useEffect(() => {
    if (!isBrowser()) return;
    signIn(returnTo ? { returnTo } : {});
  }, [signIn, returnTo]);
  return null;
}
