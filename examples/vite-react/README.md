# @useauthio/react · Vite example

Minimal Vite + React 18 + TypeScript app that shows how to wire `@useauthio/react`
into a pure SPA:

- `<AuthioProvider apiUrl projectId>` at the root.
- `<SignedIn>` / `<SignedOut>` gates on the home view.
- `signInWithMagicLink` driven by a `<form>`.
- `signInWithPasskey` driven by a button.
- `useAuthioRequired` on a "protected" route, falling back to
  `<RedirectToSignIn />` when the visitor is unauthenticated.

## Run

```bash
cp .env.example .env
# fill in VITE_AUTHIO_API_URL and VITE_AUTHIO_PROJECT_ID

npm install
npm run dev          # http://localhost:5173
```

The example resolves `@useauthio/react` via a local `file:../..` link, so
edits to the SDK rebuild on the next `npm run build`.

## Production build

```bash
npm run build
```
