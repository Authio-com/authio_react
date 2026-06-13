<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/logo-dark.png">
    <img alt="Authio" src=".github/logo-light.png" width="220">
  </picture>
</p>

# @useauthio/node

Server-side TypeScript SDK for Authio. Use it from any Node.js / Bun / Deno backend (Express, Fastify, Hono, NestJS, Next.js Route Handlers, ...) to verify sessions, manage users, organizations, memberships, invitations, and connections.

## Install

```bash
pnpm add @useauthio/node
# or: npm i @useauthio/node / yarn add @useauthio/node
```

## Quick start

```ts
import { Authio } from "@useauthio/node";

const authio = new Authio({ apiKey: process.env.AUTHIO_SECRET_KEY! });

export async function handler(req: Request) {
  const session = await authio.sessions.verify(
    req.headers.get("cookie") ?? "",
  );
  if (!session) return new Response("Unauthorized", { status: 401 });

  // session.userId is always set; session.orgId is set only after the
  // user has selected an organization (multi-org users may have many).
  const memberships = await authio.users.listMemberships(session.userId);
  return Response.json({ user: session.userId, memberships });
}
```

## Multi-org-aware

`session.orgId` represents the currently-active organization for the request. A session is *user-scoped* — `session.userId` is the same regardless of which org the user is in. To switch:

```ts
await authio.sessions.switchOrg(sessionId, { organizationId: "org_..." });
```

This mints a new session bound to a different org without re-authenticating the user.

## Refresh tokens (BFF cookie auto-renewal)

Authio mints two tokens at sign-in:

- A **short-lived access JWT** (`access_token`, ~15 min) — what your `verify()` call checks.
- A **long-lived refresh token** (`refresh_token`, default 30 days, capped per org-policy `refresh_window_min`) — used to mint a new access JWT silently.

A typical BFF (Next.js / Express / Hono) stashes the access token in a short-lived cookie and the refresh token in a long-lived cookie, then rotates the access cookie before it expires using `Authio.sessions.refresh`:

```ts
import { Authio, AuthioError } from "@useauthio/node";

const authio = new Authio({ apiKey: process.env.AUTHIO_SECRET_KEY! });

// Inside your /api/auth/refresh handler (or middleware):
async function silentRenew(req: Request, res: Response) {
  try {
    const env = await authio.sessions.refresh({
      refreshToken: req.cookies["authio_refresh"],
    });
    res.cookie("authio_session", env.access_token, {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      maxAge: 15 * 60 * 1000,
    });
    res.cookie("authio_refresh", env.refresh_token, {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });
  } catch (err) {
    if (err instanceof AuthioError) {
      // Auth-core enforces three lifecycle knobs from the org-policy
      // engine. Surface stable codes back to your caller so
      // they can render the right "your admin requires re-auth" copy:
      //   policy_violation_session_idle      — idle gap > policy
      //   policy_violation_session_absolute  — session past absolute max
      //   policy_violation_session_refresh_window — past refresh window
      //   invalid_refresh_token              — revoked / unknown / raced
      res.clearCookie("authio_session");
      res.clearCookie("authio_refresh");
      res.redirect(`/sign-in?err=${encodeURIComponent(err.code)}`);
      return;
    }
    throw err;
  }
}
```

The OLD refresh token is single-use — auth-core's rotation is atomic, so a stolen refresh can be replayed at most once. The session row's `expires_at` is also clamped to `issued_at + refresh_window_min` when an org-policy is configured, so refresh chains can never outlive the policy.

## Session lifecycle policy

Customers can configure three knobs per organization on the dashboard `/orgs/<id>/security` page:

| Knob | Meaning | Typical value |
|---|---|---|
| `session_idle_timeout_min` | Max gap from last activity before forcing re-auth | 30 (high-security) / 480 (consumer) |
| `session_absolute_max_min` | Absolute max session lifetime since sign-in | 1440 (24h) / 14400 (10d) |
| `refresh_window_min` | Cap on the rolling refresh-token chain | 720 (12h) / 10080 (7d) |

A zero value on any knob means "inherit the project default". The strictest non-zero gate wins on every refresh.

## License

MIT
