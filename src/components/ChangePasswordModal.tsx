import { useCallback, useState } from "react";
import { changePasswordRequest } from "../api/usersApi";
import type { AppUserRecord } from "../storage/appUsersStorage";

type Props = {
  user: AppUserRecord;
  users: AppUserRecord[];
  onUsersUpdated: (users: AppUserRecord[]) => void;
};

export function ChangePasswordModal({ user, users, onUsersUpdated }: Props) {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = useCallback(async () => {
    setErr(null);
    if (pw.length < 6) {
      setErr("Neues Passwort mindestens 6 Zeichen.");
      return;
    }
    if (pw !== pw2) {
      setErr("Passwörter stimmen nicht überein.");
      return;
    }
    setBusy(true);
    try {
      const updated = await changePasswordRequest(user.id, pw);
      const next = users.map((u) => (u.id === updated.id ? updated : u));
      onUsersUpdated(next);
      setPw("");
      setPw2("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Passwort konnte nicht gespeichert werden.");
    } finally {
      setBusy(false);
    }
  }, [pw, pw2, users, user.id, onUsersUpdated]);

  return (
    <div
      className="user-auth-screen user-auth-screen--blocking"
      role="dialog"
      aria-modal="true"
      aria-labelledby="chg-pw-title"
    >
      <div className="user-auth-card">
        <h1 id="chg-pw-title" className="user-auth-title">
          Neues Passwort setzen
        </h1>
        <p className="user-auth-lead">
          Sie melden sich mit einem <strong>Initialpasswort</strong> an. Bitte legen Sie jetzt ein
          eigenes Passwort fest, das Sie künftig verwenden.
        </p>
        {err && <p className="user-auth-err">{err}</p>}
        <form
          className="user-auth-form"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label className="tag-field">
            <span>Neues Passwort</span>
            <input
              type="password"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              autoComplete="new-password"
              required
              minLength={6}
            />
          </label>
          <label className="tag-field">
            <span>Passwort wiederholen</span>
            <input
              type="password"
              value={pw2}
              onChange={(e) => setPw2(e.target.value)}
              autoComplete="new-password"
              required
              minLength={6}
            />
          </label>
          <button type="submit" className="btn-modal primary user-auth-submit" disabled={busy}>
            {busy ? "Wird gespeichert …" : "Passwort speichern"}
          </button>
        </form>
      </div>
    </div>
  );
}
