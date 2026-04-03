import { useCallback, useEffect, useRef, useState } from "react";
import { bootstrapAdminRequest, fetchUserHints, loginRequest } from "../api/usersApi";
import type { AppUserRecord } from "../storage/appUsersStorage";
import { normalizeUserEmail } from "../storage/appUsersStorage";

type Props = {
  onLoggedIn: (user: AppUserRecord, token: string) => void;
};

function isPlausibleEmail(s: string): boolean {
  const t = s.trim();
  return t.includes("@") && t.includes(".") && t.length > 5;
}

export function UserAuthScreen({ onLoggedIn }: Props) {
  const [showSetup, setShowSetup] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [hints, setHints] = useState<{ id: string; email: string; legacyLoginName?: string }[]>([]);
  const [hintsLoading, setHintsLoading] = useState(true);
  const [hintsErr, setHintsErr] = useState<string | null>(null);

  const [setupFirst, setSetupFirst] = useState("");
  const [setupLast, setSetupLast] = useState("");
  const [setupEmail, setSetupEmail] = useState("");
  const [setupPw, setSetupPw] = useState("");
  const [setupPw2, setSetupPw2] = useState("");

  /** Unkontrolliert + Refs: Autofill und erste Eingabe zuverlässig (kein leerer React-State beim 1. Submit). */
  const loginInputRef = useRef<HTMLInputElement>(null);
  const passwordInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const h = await fetchUserHints();
        if (!cancelled) {
          setHints(h);
          setHintsErr(null);
        }
      } catch {
        if (!cancelled) {
          setHintsErr(
            "Benutzer-Server nicht erreichbar. Bitte im Projektordner `npm run dev` ausführen (API auf Port 5274, Vite-Proxy aktiv)."
          );
        }
      } finally {
        if (!cancelled) setHintsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (hints.length > 0) setShowSetup(false);
  }, [hints.length]);

  const bootstrap = useCallback(async () => {
    setErr(null);
    const fn = setupFirst.trim();
    const ln = setupLast.trim();
    const em = normalizeUserEmail(setupEmail);
    if (!fn || !ln) {
      setErr("Bitte Vor- und Nachnamen eingeben.");
      return;
    }
    if (!isPlausibleEmail(setupEmail)) {
      setErr("Bitte eine gültige E-Mail-Adresse eingeben.");
      return;
    }
    if (setupPw.length < 4) {
      setErr("Passwort mindestens 4 Zeichen.");
      return;
    }
    if (setupPw !== setupPw2) {
      setErr("Passwörter stimmen nicht überein.");
      return;
    }
    setBusy(true);
    try {
      const { token, user } = await bootstrapAdminRequest({
        firstName: fn,
        lastName: ln,
        email: em,
        password: setupPw,
      });
      onLoggedIn(user, token);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Anmeldung konnte nicht eingerichtet werden.");
    } finally {
      setBusy(false);
    }
  }, [setupFirst, setupLast, setupEmail, setupPw, setupPw2, onLoggedIn]);

  /**
   * Werte kommen aus FormData (Submit), damit Browser-Autofill beim ersten Klick mitgeht —
   * Chrome aktualisiert Passwort oft im DOM, nicht sofort im React-State.
   */
  const loginWithCredentials = useCallback(
    async (idRaw: string, pwRaw: string) => {
      setErr(null);
      const id = idRaw.trim();
      const pw = pwRaw;
      if (!id || !pw) {
        setErr("E-Mail (oder alter Kurzname) und Passwort eingeben.");
        return;
      }
      setBusy(true);
      try {
        const { token, user } = await loginRequest(id, pw);
        onLoggedIn(user, token);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Anmeldung fehlgeschlagen.";
        setErr(
          hints.length === 0 && !hintsLoading
            ? `${msg} — Falls noch kein Konto existiert, nutzen Sie „Ersten Administrator einlegen“.`
            : msg
        );
      } finally {
        setBusy(false);
      }
    },
    [onLoggedIn, hints.length, hintsLoading]
  );

  if (showSetup && hints.length === 0) {
    return (
      <div
        className="user-auth-screen"
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-setup-title"
      >
        <div className="user-auth-card">
          <h1 id="auth-setup-title" className="user-auth-title">
            Ersten Administrator einlegen
          </h1>
          <p className="user-auth-lead">
            Einmalig für diese Installation: legen Sie einen <strong>Administrator</strong> mit
            Vorname, Nachname und E-Mail an. Die Daten werden auf dem Server gespeichert
            (<span className="mono-cell">data/app-users.json</span>) und sind für alle Browser
            gemeinsam nutzbar.
          </p>
          {hintsErr && <p className="user-auth-err">{hintsErr}</p>}
          {err && <p className="user-auth-err">{err}</p>}
          <form
            className="user-auth-form"
            onSubmit={(e) => {
              e.preventDefault();
              void bootstrap();
            }}
          >
            <label className="tag-field">
              <span>Vorname</span>
              <input
                type="text"
                value={setupFirst}
                onChange={(e) => setSetupFirst(e.target.value)}
                autoComplete="given-name"
                required
              />
            </label>
            <label className="tag-field">
              <span>Nachname</span>
              <input
                type="text"
                value={setupLast}
                onChange={(e) => setSetupLast(e.target.value)}
                autoComplete="family-name"
                required
              />
            </label>
            <label className="tag-field">
              <span>E-Mail</span>
              <input
                type="email"
                value={setupEmail}
                onChange={(e) => setSetupEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </label>
            <label className="tag-field">
              <span>Passwort</span>
              <input
                type="password"
                value={setupPw}
                onChange={(e) => setSetupPw(e.target.value)}
                autoComplete="new-password"
                required
                minLength={4}
              />
            </label>
            <label className="tag-field">
              <span>Passwort wiederholen</span>
              <input
                type="password"
                value={setupPw2}
                onChange={(e) => setSetupPw2(e.target.value)}
                autoComplete="new-password"
                required
                minLength={4}
              />
            </label>
            <button type="submit" className="btn-modal primary user-auth-submit" disabled={busy}>
              {busy ? "Wird angelegt …" : "Administrator anlegen und anmelden"}
            </button>
            <button
              type="button"
              className="btn-modal user-auth-submit"
              disabled={busy}
              onClick={() => {
                setErr(null);
                setShowSetup(false);
              }}
            >
              Zurück zur Anmeldung
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div
      className="user-auth-screen"
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-login-title"
    >
      <div className="user-auth-card">
        <h1 id="auth-login-title" className="user-auth-title">
          Musiclist — Anmelden
        </h1>
        <p className="user-auth-lead">
          Melden Sie sich mit Ihrer <strong>E-Mail-Adresse</strong> an. Bei älteren Konten (vor
          Umstellung) funktioniert ggf. noch der frühere Kurzname. Benutzer werden zentral auf dem
          Server verwaltet.
        </p>
        {hintsLoading ? (
          <p className="user-auth-lead">Verbindung zum Server …</p>
        ) : hints.length === 0 ? (
          <p className="user-auth-lead">
            Es ist noch <strong>kein Benutzer</strong> auf dem Server registriert. Legen Sie den
            ersten Administrator an.
          </p>
        ) : null}
        {hintsErr && !showSetup ? <p className="user-auth-err">{hintsErr}</p> : null}
        {err && <p className="user-auth-err">{err}</p>}
        <form
          className="user-auth-form"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            const idRaw = loginInputRef.current?.value ?? "";
            const pwRaw = passwordInputRef.current?.value ?? "";
            void loginWithCredentials(idRaw, pwRaw);
          }}
        >
          <label className="tag-field">
            <span>E-Mail (oder Kurzname)</span>
            <input
              ref={loginInputRef}
              type="text"
              list="musiclist-login-ids"
              name="username"
              defaultValue=""
              autoComplete="username"
              disabled={!!hintsErr || hintsLoading}
            />
            <datalist id="musiclist-login-ids">
              {hints.map((u) => (
                <option key={u.id} value={u.email} />
              ))}
              {hints.map((u) =>
                u.legacyLoginName ? (
                  <option key={`${u.id}-leg`} value={u.legacyLoginName} />
                ) : null
              )}
            </datalist>
          </label>
          <label className="tag-field">
            <span>Passwort</span>
            <input
              ref={passwordInputRef}
              type="password"
              name="password"
              defaultValue=""
              autoComplete="current-password"
              disabled={!!hintsErr || hintsLoading}
            />
          </label>
          <button
            type="submit"
            className="btn-modal primary user-auth-submit"
            disabled={busy || !!hintsErr || hintsLoading}
          >
            {busy ? "Anmeldung …" : "Anmelden"}
          </button>
        </form>
        {!hintsLoading && hints.length === 0 ? (
          <div className="user-auth-after-login">
            <button
              type="button"
              className="btn-modal primary"
              disabled={busy}
              onClick={() => {
                setErr(null);
                setShowSetup(true);
              }}
            >
              Ersten Administrator einlegen
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
