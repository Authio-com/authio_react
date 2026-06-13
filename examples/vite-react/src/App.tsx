import React, { useState } from "react";
import {
  AuthioError,
  RedirectToSignIn,
  SignedIn,
  SignedOut,
  signInWithMagicLink,
  signInWithPasskey,
  useAuthio,
  useAuthioRequired,
} from "@useauthio/react";

const apiUrl =
  import.meta.env.VITE_AUTHIO_API_URL ?? "https://auth-api.authio.com";
const projectId = import.meta.env.VITE_AUTHIO_PROJECT_ID ?? "proj_example";

type View = "home" | "magic-link" | "passkey" | "protected";

export function App(): React.ReactElement {
  const [view, setView] = useState<View>("home");
  return (
    <main
      style={{
        fontFamily: "system-ui, sans-serif",
        maxWidth: 640,
        margin: "2rem auto",
        padding: "0 1rem",
      }}
    >
      <h1>@useauthio/react Vite example</h1>
      <nav style={{ display: "flex", gap: "1rem", marginBottom: "2rem" }}>
        <button onClick={() => setView("home")}>Home</button>
        <button onClick={() => setView("magic-link")}>Magic-link sign-in</button>
        <button onClick={() => setView("passkey")}>Passkey sign-in</button>
        <button onClick={() => setView("protected")}>Protected page</button>
      </nav>

      {view === "home" && <HomeView />}
      {view === "magic-link" && <MagicLinkForm />}
      {view === "passkey" && <PasskeyButton />}
      {view === "protected" && <ProtectedPage />}
    </main>
  );
}

function HomeView(): React.ReactElement {
  const { user, signOut } = useAuthio();
  return (
    <section>
      <SignedOut>
        <p>You are signed out. Try the magic-link or passkey sign-in tab.</p>
      </SignedOut>
      <SignedIn>
        <p>
          Hello <strong>{user?.email ?? "friend"}</strong>!
        </p>
        <button onClick={() => void signOut()}>Sign out</button>
      </SignedIn>
    </section>
  );
}

function MagicLinkForm(): React.ReactElement {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<
    { kind: "idle" } | { kind: "sending" } | { kind: "sent" } | { kind: "error"; message: string }
  >({ kind: "idle" });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setState({ kind: "sending" });
    try {
      await signInWithMagicLink({
        apiUrl,
        projectId,
        email,
        redirectUri: `${window.location.origin}/auth/callback`,
      });
      setState({ kind: "sent" });
    } catch (err) {
      const message =
        err instanceof AuthioError ? err.message : "Could not send magic link";
      setState({ kind: "error", message });
    }
  }

  return (
    <section>
      <h2>Magic-link sign-in</h2>
      <form onSubmit={onSubmit}>
        <input
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          style={{ width: "100%", padding: 8, marginBottom: 8 }}
        />
        <button type="submit" disabled={state.kind === "sending"}>
          {state.kind === "sending" ? "Sending…" : "Send magic link"}
        </button>
      </form>
      {state.kind === "sent" && <p>Check your email!</p>}
      {state.kind === "error" && <p style={{ color: "crimson" }}>{state.message}</p>}
    </section>
  );
}

function PasskeyButton(): React.ReactElement {
  const { refresh } = useAuthio();
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    setError(null);
    try {
      await signInWithPasskey({ apiUrl, projectId });
      // The verify response also sets the refresh cookie server-side;
      // ask the provider to pick up the new session state.
      await refresh();
    } catch (err) {
      setError(err instanceof AuthioError ? err.message : "Passkey failed");
    }
  }

  return (
    <section>
      <h2>Passkey sign-in</h2>
      <button onClick={() => void onClick()}>Sign in with a passkey</button>
      {error && <p style={{ color: "crimson" }}>{error}</p>}
    </section>
  );
}

function ProtectedPage(): React.ReactElement {
  const { user, status, gate } = useAuthioRequired({
    fallback: <p>Loading session…</p>,
  });
  if (gate) {
    return (
      <section>
        {gate}
        <SignedOut>
          <RedirectToSignIn returnTo={window.location.href} />
        </SignedOut>
      </section>
    );
  }
  return (
    <section>
      <h2>Protected page</h2>
      <p>Status: {status}</p>
      <p>You are signed in as {user?.email}.</p>
    </section>
  );
}
