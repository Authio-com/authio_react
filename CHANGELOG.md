# Changelog

All notable changes to `@useauthio/react` are documented here. This
project adheres to [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.5] — 2026-07-01

### Added
- **Email OTP sign-in.** `sendEmailOtp({ email, redirectUri?, next?, organizationId? })`
  and `verifyEmailOtp({ email, code, next?, organizationId?, clientLocation?, deviceSignals? })`
  helpers for auth-core's `/v1/auth/email-otp/send` + `/verify`, mirroring the
  hosted Lobby's body shapes. `verifyEmailOtp` throws a typed
  `step_up_required` `AuthioError` when the risk engine withholds the session.
- **`signInWithPasskey` org/next forwarding.** Optional `next` and
  `organizationId` are now included in the passkey login verify body when
  provided. Older auth-core deployments ignore the fields; client-side token
  handling is unchanged.

### Fixed
- `SDK_VERSION` (and the `X-Authio-SDK` header) had drifted from
  `package.json` — re-synced.

## [0.2.4] — 2026-06-19

### Added
- **Passkey management for customer apps.** `listPasskeys`, `renamePasskey`,
  `revokePasskey`, `mintPasskeyRegisterIntent`, `buildEnrollPasskeyUrl`, and
  `enrollPasskey` helpers for `/v1/me/passkeys` and hosted-UI
  `mode=add_credential` enrollment.
- **`usePasskeys` hook** and **`<PasskeyManager />`** drop-in component for
  in-app device lists (list/rename/revoke on your origin; add via redirect to
  the sign-in host).
- **`addPasskey()`** for embedded WebAuthn enrollment when your SPA shares
  the sign-in origin (`canEnrollPasskeyEmbedded`).

## [0.2.3] — 2026-06-17

### Added
- **Signed lobby context tokens.** `signIn()` now POSTs to
  `/v1/auth/lobby-context` and redirects with a short-lived `?ctx=…`
  param when auth-core supports it, so `project_id` and `redirect_uri`
  are not exposed in the browser URL. Falls back to legacy query params
  when minting fails or auth-core is unavailable.
- **Environment terminology in docs.** README documents `projectId` as
  the dashboard **environment ID** (`proj_…`; API field `project_id`).
  Env var names (`AUTHIO_PROJECT_ID`, `VITE_AUTHIO_PROJECT_ID`) are
  unchanged for backward compatibility.

### Changed
- README adds custom-domain guidance: keep the default Lobby URL at
  runtime, override `signInUrl` / `VITE_AUTHIO_SIGN_IN_URL` for branded
  auth hosts; DNS CNAME target is `cname.authiodns.com` (docs-only).

## [0.2.2] — 2026-06-13

### Fixed
- **Magic-link sign-in now matches auth-core.** `signInWithMagicLink`
  sent the recipient as `email`; auth-core's `POST /v1/auth/magic-link/send`
  reads it as `destination`. Real sends were rejected; they now succeed.
- **Passkey login now completes.** `signInWithPasskey` posted a flat,
  snake-cased assertion body to `/v1/auth/passkey/login/verify`; auth-core
  expects the standard WebAuthn JSON (camelCase) wrapped under a top-level
  `credential` key and rejects unknown fields. The verify body is now
  `{ credential: { id, rawId, type, response: { clientDataJSON,
  authenticatorData, signature, userHandle } } }`.

### Added
- **Client-side token-handoff.** `useAuthio()` now exposes
  `handleSignInResult({ accessToken, refreshToken?, user? })`, which
  verifies the access token against the live JWKS, adopts it into provider
  state (`status: authenticated`), and arms the silent-refresh scheduler.
  A pure SPA can now complete a magic-link sign-in by reading
  `?access_token=…` off the callback redirect and handing it to the SDK —
  no same-origin BFF refresh cookie required (parity with `@useauthio/vue`).

## [0.2.1] — 2026-06-13

### Fixed
- **Package is now installable from npm.** `0.2.0` declared its
  `@useauthio/node` dependency as `file:./vendor/authio-node`, a local
  path that does not resolve when installed from the registry, so
  `npm install @useauthio/react` failed for every external user. The
  dependency now points at the published `@useauthio/node` (`^0.2.0`)
  and the vendored copy has been removed from the package.

## [0.2.0] — 2026-06-12

### Changed
- **Renamed npm package `@authio/react` → `@useauthio/react`.** The
  original `@authio` scope could not be claimed on npm, so every Authio
  SDK now publishes under the organization scope `@useauthio`. Install
  with `npm install @useauthio/react` and update imports accordingly.
  The old `@authio/react` name is retired; releases below this entry were
  published (or prepared) under the old name and are kept for history.

## [0.1.1] — 2026-06-06

### Fixed
- `signIn()` now redirects to Lobby (`https://lobby.authio.com/`) with
  `redirect_uri` instead of auth-core `/v1/auth/sign-in` with `return_to`.
- Warn when `projectId` is missing; never append `project_id=undefined`.

## [0.1.0] — 2026-05-22

### Added
- Initial release of the `@authio/react` SDK for pure-SPA Authio integrations.
- `<AuthioProvider apiUrl projectId />` context provider with silent-refresh scheduling.
- `useAuthio()` hook returning `{ user, status, accessToken, getAccessToken, signIn, signOut, refresh }`.
- `useAuthioRequired({ fallback, redirectTo })` convenience hook.
- `<SignedIn>` / `<SignedOut>` declarative gates and `<RedirectToSignIn returnTo />` helper.
- `signInWithMagicLink` and `signInWithPasskey` top-level helpers (not hook-bound) for form handlers.
- Token storage modes: `memory` (default), `localStorage`, `sessionStorage`, `none`. Refresh tokens are never JS-accessible.
- JWT signature verification via `@authio/node`'s `JwtVerifier` (EdDSA-pinned, refuses `alg: none`).
- Optional `onTelemetryEvent` hook for Sentry/Datadog wiring. No phone-home by default.
- SSR-safe — every hook handles `typeof window === "undefined"`.
- Dual ESM + CJS build via tsup, full TypeScript declarations, zero runtime deps beyond `@authio/node`.

### Notes
- `@authio/node` is pulled in via `file:./vendor/authio-node` so local CI
  resolves without requiring the `@authio` npm scope to be claimed.
  When the scope is registered, the dependency will flip to
  `"@authio/node": "^0.1.0"` and the `vendor/` tree will be removed in
  the same release. (Operator follow-up.)

[0.1.0]: https://github.com/authio-com/authio_react/releases/tag/v0.1.0
