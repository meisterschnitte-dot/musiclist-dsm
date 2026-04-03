import { useCallback, useState } from "react";
import { sendUserInvite } from "../api/sendUserInvite";
import {
  deleteUserRequest,
  fetchUsersList,
  inviteUserRequest,
} from "../api/usersApi";
import type { AppUserRecord, UserRole } from "../storage/appUsersStorage";
import {
  countAdmins,
  findUserByEmail,
  normalizeUserEmail,
} from "../storage/appUsersStorage";

type Props = {
  open: boolean;
  onClose: () => void;
  users: AppUserRecord[];
  onUsersUpdated: (users: AppUserRecord[]) => void;
  currentUserId: string;
};

function isPlausibleEmail(s: string): boolean {
  const t = s.trim();
  return t.includes("@") && t.includes(".") && t.length > 5;
}

export function UserManagementModal({
  open,
  onClose,
  users,
  onUsersUpdated,
  currentUserId,
}: Props) {
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newFirst, setNewFirst] = useState("");
  const [newLast, setNewLast] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newRole, setNewRole] = useState<UserRole>("user");

  const reloadList = useCallback(async () => {
    const list = await fetchUsersList();
    onUsersUpdated(list);
  }, [onUsersUpdated]);

  const inviteUser = useCallback(async () => {
    setErr(null);
    setInfo(null);
    const fn = newFirst.trim();
    const ln = newLast.trim();
    const em = normalizeUserEmail(newEmail);
    const roleForInvite = newRole;
    if (!fn || !ln) {
      setErr("Vor- und Nachname sind erforderlich.");
      return;
    }
    if (!isPlausibleEmail(newEmail)) {
      setErr("Bitte eine gültige E-Mail-Adresse eingeben.");
      return;
    }
    if (findUserByEmail(users, em)) {
      setErr("Diese E-Mail ist bereits registriert.");
      return;
    }
    setBusy(true);
    try {
      await inviteUserRequest({
        firstName: fn,
        lastName: ln,
        email: em,
        role: roleForInvite,
      });
      await reloadList();
      setNewFirst("");
      setNewLast("");
      setNewEmail("");
      setNewRole("user");

      const roleLabel = roleForInvite === "admin" ? "Administrator" : "Benutzer";
      const appUrl =
        typeof window !== "undefined" ? `${window.location.origin}${window.location.pathname}` : "";
      try {
        await sendUserInvite({
          email: em,
          firstName: fn,
          lastName: ln,
          roleLabel,
          appUrl: appUrl.replace(/\/$/, "") || window.location.origin,
        });
        setInfo("Einladungs-E-Mail wurde gesendet.");
      } catch (e) {
        setInfo(
          `Benutzer wurde angelegt. E-Mail-Versand fehlgeschlagen: ${e instanceof Error ? e.message : String(e)} — bitte SMTP prüfen und ggf. Mail-Server starten (\`npm run dev\`). Das Initialpasswort wurde dem Benutzer nicht mitgeteilt.`
        );
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Benutzer konnte nicht angelegt werden.");
    } finally {
      setBusy(false);
    }
  }, [users, newFirst, newLast, newEmail, newRole, reloadList]);

  const removeUser = useCallback(
    async (id: string) => {
      setErr(null);
      setInfo(null);
      const target = users.find((u) => u.id === id);
      if (!target) return;
      if (id === currentUserId) {
        setErr(
          "Das eigene Konto kann hier nicht gelöscht werden — bitte von einem anderen Administrator aus löschen oder abmelden."
        );
        return;
      }
      if (target.role === "admin" && countAdmins(users) <= 1) {
        setErr("Der letzte Administrator kann nicht gelöscht werden.");
        return;
      }
      const delLabel = `${target.firstName} ${target.lastName}`.trim() || target.email;
      if (!window.confirm(`Benutzer „${delLabel}“ wirklich löschen?`)) return;
      setBusy(true);
      try {
        await deleteUserRequest(id);
        await reloadList();
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Löschen fehlgeschlagen.");
      } finally {
        setBusy(false);
      }
    },
    [users, reloadList, currentUserId]
  );

  if (!open) return null;

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="user-mgmt-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal modal--user-mgmt" onMouseDown={(e) => e.stopPropagation()}>
        <h2 id="user-mgmt-title" className="modal-title">
          Benutzer verwalten
        </h2>
        <p className="modal-lead">
          Administratoren haben Zugriff auf „Verwaltung” und dürfen MP3-Dateien aus der
          Musikdatenbank löschen. Eingeladene Benutzer erhalten ihre Zugangsdaten per E-Mail und werden beim
          ersten Login zum Passwortwechsel aufgefordert. Alle Konten liegen zentral auf dem Server.
        </p>
        {err && <p className="user-auth-err modal-lead">{err}</p>}
        {info && <p className="modal-lead" style={{ color: "var(--muted, #666)" }}>{info}</p>}

        <div className="user-mgmt-list-wrap">
          <table className="table-dense user-mgmt-table">
            <thead>
              <tr>
                <th>Vorname</th>
                <th>Nachname</th>
                <th>E-Mail</th>
                <th>Rolle</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>{u.firstName}</td>
                  <td>{u.lastName}</td>
                  <td className="mono-cell user-mgmt-table-email">{u.email}</td>
                  <td>{u.role === "admin" ? "Administrator" : "Benutzer"}</td>
                  <td>
                    <button
                      type="button"
                      className="btn-cell btn-cell--danger"
                      disabled={u.id === currentUserId || busy}
                      title={
                        u.id === currentUserId ? "Eigenes Konto nicht hier löschbar" : undefined
                      }
                      onClick={() => void removeUser(u.id)}
                    >
                      Löschen
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h3 className="user-mgmt-subtitle">Benutzer einladen</h3>
        <div className="user-mgmt-add-form">
          <label className="tag-field">
            <span>Vorname</span>
            <input
              type="text"
              value={newFirst}
              onChange={(e) => setNewFirst(e.target.value)}
              autoComplete="off"
            />
          </label>
          <label className="tag-field">
            <span>Nachname</span>
            <input
              type="text"
              value={newLast}
              onChange={(e) => setNewLast(e.target.value)}
              autoComplete="off"
            />
          </label>
          <label className="tag-field">
            <span>E-Mail</span>
            <input
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              autoComplete="off"
            />
          </label>
          <label className="tag-field">
            <span>Rolle</span>
            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as UserRole)}
              className="user-mgmt-select"
            >
              <option value="user">Benutzer</option>
              <option value="admin">Administrator</option>
            </select>
          </label>
          <button
            type="button"
            className="btn-modal primary"
            disabled={busy}
            onClick={() => void inviteUser()}
          >
            Einladen &amp; E-Mail senden
          </button>
        </div>

        <div className="modal-actions">
          <button type="button" className="btn-modal" onClick={onClose}>
            Schließen
          </button>
        </div>
      </div>
    </div>
  );
}
