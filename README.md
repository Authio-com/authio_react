<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/logo-dark.png">
    <img alt="Authio" src=".github/logo-light.png" width="220">
  </picture>
</p>

# @useauthio/react

> Part of **[Authio Lobby](https://authio.com/products/lobby)** —
> Authio's drop-in passwordless authentication. Learn more at
> https://authio.com/products/lobby.

React SDK for Authio — hooks, gates, and sign-in helpers for **pure
SPAs** that talk directly to auth-core via CORS. If you have a
Next.js or other BFF, reach for [`@useauthio/nextjs`](https://github.com/authio-com/authio_nextjs)
instead.

## Recent additions

- **`@useauthio/widgets` ships.** Drop-in
  `<AuthioSSOConnectionWidget>` and `<AuthioDirectorySyncWidget>`
  components let your customers' IT admins configure SAML / OIDC and
  SCIM directories from inside your own product. Mint the JWT from
  your BFF; embed the widget anywhere in your `SignedIn` tree. See
  [`authio_widgets`](https://github.com/authio-com/authio_widgets) and
  the docs:
  [`/widgets/overview`](https://docs.authio.com/widgets/overview),
  [`/widgets/tokens`](https://docs.authio.com/widgets/tokens),
  [`/sdks/react`](https://docs.authio.com/sdks/react#embedding-the-authiowidgets-surface).
- **JWT carries `roles` + `permissions` now.** Every customer-session
  access token in a customer-tenant project ships the new claims
  ([`/concepts/roles-and-permissions`](https://docs.authio.com/concepts/roles-and-permissions)).
  The hooks (`useAuthio`, `useUser`, etc.) keep their existing shape;
  the new claims are exposed on `session.claims` for any code that
  wants to gate UI on roles or permissions.
- **`kind: "widget"` JWTs are explicitly refused on every customer
  surface.** Embedding the widget bundle alongside `@useauthio/react`
  composes safely; the widget bearer is never confusable with the
  standard customer session JWT.

- `<AuthioProvider>` + `useAuthio()` for session state.
- `<SignedIn>` / `<SignedOut>` / `<RedirectToSignIn>` declarative gates.
- `signInWithMagicLink()` and `signInWithPasskey()` as top-level
  helpers — call them straight from your form submit handler.
- Silent refresh with visibility-aware scheduling and exponential
  backoff on failure.
- JWT signature verification (EdDSA-pinned) via `@useauthio/node`'s
  `JwtVerifier`. Tokens that fail verification are dropped.
- SSR-safe — every hook handles `typeof window === "undefined"`.
- Dual ESM + CJS build via tsup; zero runtime deps beyond `@useauthio/node`.

---

## 5-minute integration

Install:

```bash
npm install @useauthio/react
# or: pnpm add @useauthio/react
```

Wrap your app once at the root:

```tsx
// src/main.tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { AuthioProvider } from "@useauthio/react";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <AuthioProvider
    apiUrl={import.meta.env.VITE_AUTHIO_API_URL}
    projectId={import.meta.env.VITE_AUTHIO_PROJECT_ID}
  >
    <App />
  </AuthioProvider>,
);
```

Drop gates and a magic-link form:

```tsx
import {
  SignedIn,
  SignedOut,
  signInWithMagicLink,
  useAuthio,
} from "@useauthio/react";

export default function App() {
  const { user, signOut } = useAuthio();
  return (
    <>
      <SignedOut>
        <MagicLinkForm />
      </SignedOut>
      <SignedIn>
        <p>Hello, {user?.email}!</p>
        <button onClick={() => void signOut()}>Sign out</button>
      </SignedIn>
    </>
  );
}

function MagicLinkForm() {
  const [email, setEmail] = React.useState("");
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        await signInWithMagicLink({
          apiUrl: import.meta.env.VITE_AUTHIO_API_URL,
          projectId: import.meta.env.VITE_AUTHIO_PROJECT_ID,
          email,
          redirectUri: `${window.location.origin}/auth/callback`,
        });
      }}
    >
      <input value={email} onChange={(e) => setEmail(e.target.value)} />
      <button>Send magic link</button>
    </form>
  );
}
```

That's it. The provider runs a silent `POST /v1/auth/refresh` against
your BFF cookie at mount, schedules a renewal one minute before the
access JWT expires, and verifies every received token against the
auth-core JWKS before trusting it.

A complete runnable example lives in [`examples/vite-react/`](./examples/vite-react/).

### Custom auth domains

The default `signInUrl` is the platform Lobby (`https://lobby.authio.com/`).
Enterprise customers with a branded auth host point `signInUrl` at that URL
instead — in Vite apps, typically via `VITE_AUTHIO_SIGN_IN_URL`:

```tsx
<AuthioProvider
  apiUrl={import.meta.env.VITE_AUTHIO_API_URL}
  projectId={import.meta.env.VITE_AUTHIO_PROJECT_ID}
  signInUrl={
    import.meta.env.VITE_AUTHIO_SIGN_IN_URL ?? "https://lobby.authio.com/"
  }
/>
```

DNS setup for a vanity hostname (e.g. `auth.acme.com`) is dashboard-side:
CNAME your auth host to **`cname.authiodns.com`**. The SDK does not reference
that CNAME at runtime — it only affects where end users sign in when you override
`signInUrl`. See [Custom domains](https://docs.authio.com/guides/custom-domains).

---

## API reference

### `<AuthioProvider>`

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `apiUrl` | `string` (required) | — | Auth-core base URL, e.g. `"https://auth-api.authio.com"`. |
| `projectId` | `string` (required) | — | Environment ID (`proj_…`; API field `project_id`). Sent as `X-Authio-Project` on every call. |
| `storage` | `"memory" \| "localStorage" \| "sessionStorage" \| "none"` | `"memory"` | Access-token storage backend. **Refresh tokens are never JS-accessible** regardless of this setting. |
| `refreshLeadSeconds` | `number` | `60` | How many seconds before `exp` to schedule the silent refresh. |
| `onTelemetryEvent` | `(event: AuthioTelemetryEvent) => void` | — | Sink for SDK telemetry (refresh outcomes, sign-in starts/completes, token verification). No phone-home by default. |
| `fetch` | `typeof fetch` | `globalThis.fetch` | DI for tests / custom transports. |
| `signInUrl` | `string` | `https://lobby.authio.com/` | Lobby (hosted UI) sign-in URL. Set to your branded auth host (e.g. `https://auth.acme.com/`) when using a custom domain — see [Custom auth domains](#custom-auth-domains) below. |
| `jwtIssuer` | `string` | `apiUrl` | JWT `iss` claim to require during verification. |
| `jwtAudience` | `string` | `"authio"` | JWT `aud` claim to require during verification. |
| `verifyToken` | `AuthioTokenVerifier` | `JwtVerifier`-based | Override the verification step (testing / custom JWKS). |
| `skipInitialRefresh` | `boolean` | `false` | Skip the bootstrap refresh and start in `unauthenticated`. |

### `useAuthio()`

```ts
{
  user: AuthioUser | null;
  status: "loading" | "authenticated" | "unauthenticated";
  accessToken: string | null;
  getAccessToken: () => Promise<string | null>;
  signIn: (opts?: { returnTo?: string }) => void;
  signOut: () => Promise<void>;
  refresh: () => Promise<boolean>;
}
```

- `getAccessToken()` returns the current token if it's more than 10s
  from `exp`, otherwise transparently triggers a refresh and returns
  the new value (or `null` on failure). Use it as your `Authorization`
  source for outbound API calls.
- `signIn()` navigates the tab to Lobby (`signInUrl`). When auth-core
  supports it, the SDK mints a short-lived `ctx` token so
  `project_id` and `redirect_uri` are not exposed in the URL; it falls
  back to legacy `?project_id=…&redirect_uri=…` query params otherwise.
- `signOut()` best-effort POSTs to `/v1/auth/sign-out`, then clears
  local state regardless of the upstream result.
- `refresh()` runs one refresh attempt and resolves `true` on success.

### `useAuthioRequired({ fallback, redirectTo })`

Convenience hook for "this view requires a session". While the
provider is loading or the session is unauthenticated, returns
`fallback` via the `gate` field. When unauthenticated, kicks off a
redirect to `redirectTo` (or `signIn()` if omitted).

```tsx
function Dashboard() {
  const { user, gate } = useAuthioRequired({ fallback: <Spinner /> });
  if (gate) return gate;
  return <h1>Hello {user!.email}</h1>;
}
```

### Gates

- `<SignedIn>` — renders children only when status is `"authenticated"`.
- `<SignedOut>` — renders children only when status is `"unauthenticated"`.
- `<RedirectToSignIn returnTo="/dashboard" />` — declarative; calls
  `signIn({ returnTo })` on mount.

All three render `null` while status is `"loading"` so authenticated-only
UI never flashes during the initial refresh.

### `signInWithMagicLink({ apiUrl, projectId, email, redirectUri, signal?, fetch? })`

Top-level helper, **not hook-bound** — drop it directly into your
form submit handler. POSTs `/v1/auth/magic-link/send`. Throws
`AuthioError` on any failure so you can render `err.code` /
`err.message` directly. Returns `void` on success — the magic link is
now in the user's inbox.

### `signInWithPasskey({ apiUrl, projectId, email?, signal?, fetch? })`

Runs the full WebAuthn assertion ceremony against
`/v1/auth/passkey/login/options` + `/v1/auth/passkey/login/verify`.
Returns `{ accessToken, refreshToken?, user }`. Throws `AuthioError`
with codes `not_in_browser`, `webauthn_unsupported`,
`webauthn_cancelled`, or any auth-core error code on a step failure.

The returned `refreshToken` is included for completeness but the SDK
itself never persists it — auth-core also sets the refresh cookie via
`Set-Cookie` and that's the canonical home for it.

### `AuthioError`

Re-exported from `@useauthio/node`. Thrown by every helper and the
provider on failure. Shape: `{ code, message, status, requestId? }`.

---

## When to use this vs. `@useauthio/nextjs`

| You have… | Use |
|-----------|-----|
| A pure SPA (Vite, CRA, Webpack) talking directly to auth-core via CORS | **`@useauthio/react`** (this package) |
| A Next.js app with a BFF (`/api/auth/*` route handlers) | [`@useauthio/nextjs`](https://github.com/authio-com/authio_nextjs) |
| A Remix / TanStack Start / Astro app | `@useauthio/react` for the client; your framework's loader/action helpers for the server |

The reason for the split: `@useauthio/nextjs` lives in the BFF cookie
world — it owns `authio_session` + `authio_refresh` HttpOnly cookies
on **your origin** and the SPA sees only `useUser()`-style hooks
pointed at `/api/auth/me`. `@useauthio/react` lives in the CORS world —
your SPA fetches `auth-api.authio.com` directly with
`credentials: include`, and the refresh cookie is set on the
auth-core origin. Both end up with the same DX in components, but
the network shape and the threat surface differ.

---

## CSP guidance

The provider issues `fetch` to `apiUrl`. Configure your Content
Security Policy so the browser allows it:

```http
Content-Security-Policy:
  default-src 'self';
  connect-src 'self' https://auth-api.authio.com;
  script-src 'self';
  style-src 'self' 'unsafe-inline';
```

If you've moved auth-core to a custom domain (e.g.
`auth.acme.com`), allowlist that host instead. The hosted sign-in UI
itself is reached via a top-level navigation (`window.location.assign`),
which is not subject to `connect-src`.

---

## Security considerations on token storage

| Mode | Where the access token lives | XSS exposure | Persistence |
|------|------------------------------|--------------|-------------|
| `"memory"` (default) | A closure inside `<AuthioProvider>` | Same as your app code | Cleared on hard reload |
| `"sessionStorage"` | `window.sessionStorage` | **Readable by any script on the same origin** | Cleared when tab closes |
| `"localStorage"` | `window.localStorage` | **Readable by any script on the same origin** | Survives reload |
| `"none"` | Nowhere — refetched on every page load | None | None |

**Default is `"memory"` for a reason**: a single XSS escape gets the
attacker your access token if it's in `localStorage` / `sessionStorage`.
The 15-minute access-token TTL caps the blast radius, but a
sufficiently-clever attacker can chain that into a refresh-rotation.

If you need persistence-across-reloads on a SPA (no BFF cookie),
pick `"sessionStorage"` over `"localStorage"` — the blast radius
is one tab. If you have a BFF, you don't need either; the `memory`
mode plus the refresh cookie is enough.

**The refresh token is NEVER stored in JS-accessible storage**,
regardless of which `storage` mode you choose. It rides only the
HttpOnly cookie that auth-core sets at `/v1/auth/refresh` and
`/v1/auth/passkey/login/verify`. `getAccessToken()` and the silent
refresh path both call those endpoints with `credentials: include`
to pick up the rotated token without ever surfacing the refresh
token to your code.

---

## CSRF guidance

If your SPA is hosted on a different origin than auth-core (e.g.
`app.acme.com` calling `auth-api.authio.com`):

1. Auth-core's CORS allowlist must include your SPA origin.
   The auth-core operator adds it via the project settings.
2. The provider always uses `credentials: include` on
   `/v1/auth/refresh` and `/v1/auth/sign-out`, so the browser sends
   the refresh cookie on those calls.
3. Auth-core enforces a SameSite=None refresh cookie when the SPA
   origin differs from the cookie origin, plus the per-project CORS
   origin check — that's the line of defence against CSRF on the
   refresh endpoint itself.

If your SPA is hosted on the SAME parent domain as auth-core (e.g.
both under `*.acme.com`), the refresh cookie is a SameSite=Lax
first-party cookie and the cross-origin check is implicit.

---

## License

MIT — see [LICENSE](./LICENSE).
