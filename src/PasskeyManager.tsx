import React, { useState } from "react";
import { usePasskeys } from "./usePasskeys";

export interface PasskeyManagerProps {
  className?: string;
  /** Passed to {@link enrollPasskey} as `returnUrl`. */
  enrollReturnUrl?: string;
  enrollNext?: string;
}

/**
 * Drop-in passkey device list for customer apps. Lists, renames, and
 * revokes via `/v1/me/passkeys`; "Add passkey" redirects to the hosted
 * sign-in UI (`mode=add_credential`) so the WebAuthn ceremony runs on
 * the sign-in origin.
 */
export function PasskeyManager({
  className,
  enrollReturnUrl,
  enrollNext,
}: PasskeyManagerProps): React.ReactElement {
  const { passkeys, loading, error, rename, revoke, enroll } = usePasskeys();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [enrolling, setEnrolling] = useState(false);

  async function onRename(id: string, nickname: string) {
    setBusyId(id);
    setActionError(null);
    try {
      await rename(id, nickname);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Rename failed");
    } finally {
      setBusyId(null);
    }
  }

  async function onRevoke(id: string) {
    setBusyId(id);
    setActionError(null);
    try {
      await revoke(id);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Revoke failed");
    } finally {
      setBusyId(null);
    }
  }

  async function onEnroll() {
    setEnrolling(true);
    setActionError(null);
    try {
      await enroll({ returnUrl: enrollReturnUrl, next: enrollNext });
    } catch (err) {
      setEnrolling(false);
      setActionError(err instanceof Error ? err.message : "Could not start enrollment");
    }
  }

  return (
    <section className={className} aria-labelledby="authio-passkey-manager-title">
      <div className="authio-passkey-manager__header">
        <h2 id="authio-passkey-manager-title">Passkeys</h2>
        <button
          type="button"
          onClick={() => void onEnroll()}
          disabled={enrolling || loading}
        >
          {enrolling ? "Redirecting…" : "Add passkey"}
        </button>
      </div>

      {(error || actionError) && (
        <p role="alert" className="authio-passkey-manager__error">
          {error ?? actionError}
        </p>
      )}

      {loading ? (
        <p className="authio-passkey-manager__loading">Loading passkeys…</p>
      ) : passkeys.length === 0 ? (
        <p className="authio-passkey-manager__empty">
          No passkeys yet. Add one to sign in faster on this account.
        </p>
      ) : (
        <ul className="authio-passkey-manager__list">
          {passkeys.map((p) => (
            <li key={p.id} className="authio-passkey-manager__item">
              <PasskeyRow
                passkey={p}
                busy={busyId === p.id}
                onRename={onRename}
                onRevoke={onRevoke}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PasskeyRow({
  passkey,
  busy,
  onRename,
  onRevoke,
}: {
  passkey: {
    id: string;
    nickname: string | null;
    authenticator_name: string;
    created_at: string;
    last_used_at: string | null;
  };
  busy: boolean;
  onRename: (id: string, nickname: string) => Promise<void>;
  onRevoke: (id: string) => Promise<void>;
}) {
  const [nickname, setNickname] = useState(passkey.nickname ?? "");

  return (
    <div className="authio-passkey-manager__row">
      <div>
        <strong>{passkey.authenticator_name}</strong>
        <div className="authio-passkey-manager__meta">
          Added {new Date(passkey.created_at).toLocaleDateString()}
          {passkey.last_used_at
            ? ` · Last used ${new Date(passkey.last_used_at).toLocaleDateString()}`
            : ""}
        </div>
      </div>
      <form
        className="authio-passkey-manager__rename"
        onSubmit={(e) => {
          e.preventDefault();
          void onRename(passkey.id, nickname.trim());
        }}
      >
        <input
          type="text"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          placeholder="Nickname"
          maxLength={64}
          disabled={busy}
        />
        <button type="submit" disabled={busy}>
          Save
        </button>
      </form>
      <button
        type="button"
        disabled={busy}
        onClick={() => void onRevoke(passkey.id)}
        className="authio-passkey-manager__revoke"
      >
        Revoke
      </button>
    </div>
  );
}
