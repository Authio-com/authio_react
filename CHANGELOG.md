# Changelog

All notable changes to `@useauthio/react` are documented here. This
project adheres to [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
