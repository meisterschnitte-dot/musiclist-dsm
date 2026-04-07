import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchCustomersList } from "../api/customersApi";
import { sendUserInvite } from "../api/sendUserInvite";
import {
  deleteUserRequest,
  fetchUsersList,
  inviteUserRequest,
  updateUserRequest,
} from "../api/usersApi";
import type { AppUserRecord, UserRole } from "../storage/appUsersStorage";
import {
  countActiveAdmins,
  countAdmins,
  findUserByEmail,
  isUserRecordActive,
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
  const [newCompany, setNewCompany] = useState("");
  const [customerNames, setCustomerNames] = useState<string[]>([]);

  const [editingUser, setEditingUser] = useState<AppUserRecord | null>(null);
  const [editFirst, setEditFirst] = useState("");
  const [editLast, setEditLast] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editRole, setEditRole] = useState<UserRole>("user");
  const [editCompany, setEditCompany] = useState("");
  const [editActive, setEditActive] = useState(true);

  useEffect(() => {
    if (!open) return;
    void fetchCustomersList()
      .then((rows) => setCustomerNames(rows.map((c) => c.name).sort((a, b) => a.localeCompare(b, "de"))))
      .catch(() => setCustomerNames([]));
  }, [open]);

  useEffect(() => {
    if (!open) setEditingUser(null);
  }, [open]);

  useEffect(() => {
    if (!editingUser) return;
    setEditFirst(editingUser.firstName);
    setEditLast(editingUser.lastName);
    setEditEmail(editingUser.email);
    setEditRole(editingUser.role);
    setEditCompany(editingUser.companyName ?? "");
    setEditActive(isUserRecordActive(editingUser));
  }, [editingUser]);

  const companyDatalistId = useMemo(() => "user-mgmt-company-datalist", []);

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
    const company = newCompany.trim();
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
        ...(roleForInvite === "customer" && company ? { companyName: company } : {}),
      });
      await reloadList();
      setNewFirst("");
      setNewLast("");
      setNewEmail("");
      setNewRole("user");
      setNewCompany("");

      const roleLabel =
        roleForInvite === "admin"
          ? "Administrator"
          : roleForInvite === "customer"
            ? "Kunde"
            : "Benutzer";
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
        setInfo("Begrüßungs-E-Mail mit Zugangsdaten wurde gesendet.");
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
  }, [users, newFirst, newLast, newEmail, newRole, newCompany, reloadList]);

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

  const saveEditedUser = useCallback(async () => {
    if (!editingUser) return;
    setErr(null);
    setInfo(null);
    const fn = editFirst.trim();
    const ln = editLast.trim();
    const em = normalizeUserEmail(editEmail);
    const company = editCompany.trim();
    if (!fn || !ln) {
      setErr("Vor- und Nachname sind erforderlich.");
      return;
    }
    if (!isPlausibleEmail(editEmail)) {
      setErr("Bitte eine gültige E-Mail-Adresse eingeben.");
      return;
    }
    if (findUserByEmail(
      users.filter((u) => u.id !== editingUser.id),
      em
    )) {
      setErr("Diese E-Mail ist bereits vergeben.");
      return;
    }
    if (!editActive && editingUser.id === currentUserId) {
      setErr("Das eigene Konto kann nicht deaktiviert werden.");
      return;
    }
    if (
      !editActive &&
      editingUser.role === "admin" &&
      isUserRecordActive(editingUser) &&
      countActiveAdmins(users) <= 1
    ) {
      setErr("Der letzte aktive Administrator kann nicht deaktiviert werden.");
      return;
    }
    if (
      editingUser.role === "admin" &&
      editRole !== "admin" &&
      isUserRecordActive(editingUser) &&
      countActiveAdmins(users) <= 1
    ) {
      setErr("Der letzte aktive Administrator kann die Rolle nicht ändern.");
      return;
    }
    setBusy(true);
    try {
      await updateUserRequest(editingUser.id, {
        firstName: fn,
        lastName: ln,
        email: em,
        role: editRole,
        active: editActive,
        ...(editRole === "customer" ? { companyName: company } : {}),
      });
      await reloadList();
      setEditingUser(null);
      setInfo("Änderungen gespeichert.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Speichern fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }, [
    editingUser,
    editFirst,
    editLast,
    editEmail,
    editRole,
    editCompany,
    editActive,
    users,
    reloadList,
    currentUserId,
  ]);

  const flipUserActive = useCallback(
    async (u: AppUserRecord) => {
      const nextActive = !isUserRecordActive(u);
      setErr(null);
      setInfo(null);
      if (!nextActive && u.id === currentUserId) {
        setErr("Das eigene Konto kann nicht deaktiviert werden.");
        return;
      }
      if (!nextActive && u.role === "admin" && isUserRecordActive(u) && countActiveAdmins(users) <= 1) {
        setErr("Der letzte aktive Administrator kann nicht deaktiviert werden.");
        return;
      }
      setBusy(true);
      try {
        await updateUserRequest(u.id, {
          firstName: u.firstName,
          lastName: u.lastName,
          email: u.email,
          role: u.role,
          active: nextActive,
          ...(u.role === "customer" ? { companyName: u.companyName ?? "" } : {}),
        });
        await reloadList();
        setInfo(nextActive ? "Benutzer wurde aktiviert." : "Benutzer wurde deaktiviert.");
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Speichern fehlgeschlagen.");
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
                <th>Firma</th>
                <th>Rolle</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr
                  key={u.id}
                  className={!isUserRecordActive(u) ? "user-mgmt-row-inactive" : undefined}
                >
                  <td>{u.firstName}</td>
                  <td>{u.lastName}</td>
                  <td className="mono-cell user-mgmt-table-email">{u.email}</td>
                  <td>{u.companyName ?? "—"}</td>
                  <td>
                    {u.role === "admin"
                      ? "Administrator"
                      : u.role === "customer"
                        ? "Kunde"
                        : "Benutzer"}
                  </td>
                  <td>
                    <label className="user-mgmt-active-toggle">
                      <input
                        type="checkbox"
                        checked={isUserRecordActive(u)}
                        disabled={
                          busy ||
                          (isUserRecordActive(u) &&
                            (u.id === currentUserId ||
                              (u.role === "admin" && countActiveAdmins(users) <= 1)))
                        }
                        title={
                          u.id === currentUserId && isUserRecordActive(u)
                            ? "Eigenes Konto bleibt aktiv"
                            : u.role === "admin" &&
                                isUserRecordActive(u) &&
                                countActiveAdmins(users) <= 1
                              ? "Letzter aktiver Administrator"
                              : isUserRecordActive(u)
                                ? "Deaktivieren"
                                : "Aktivieren"
                        }
                        onChange={() => void flipUserActive(u)}
                      />
                      <span>{isUserRecordActive(u) ? "Aktiv" : "Inaktiv"}</span>
                    </label>
                  </td>
                  <td>
                    <div className="user-mgmt-row-actions">
                      <button
                        type="button"
                        className="btn-cell btn-cell--soft btn-cell--compact"
                        disabled={busy}
                        onClick={() => {
                          setErr(null);
                          setInfo(null);
                          setEditingUser(u);
                        }}
                      >
                        Bearbeiten
                      </button>
                      <button
                        type="button"
                        className="btn-cell btn-cell--danger btn-cell--compact"
                        disabled={u.id === currentUserId || busy}
                        title={
                          u.id === currentUserId ? "Eigenes Konto nicht hier löschbar" : undefined
                        }
                        onClick={() => void removeUser(u.id)}
                      >
                        Löschen
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {editingUser && (
          <>
            <h3 className="user-mgmt-subtitle">Benutzer bearbeiten</h3>
            <p className="modal-lead" style={{ fontSize: "0.85rem", marginTop: 0 }}>
              {editingUser.email}
            </p>
            <div className="user-mgmt-add-form">
              <label className="tag-field">
                <span>Vorname</span>
                <input
                  type="text"
                  value={editFirst}
                  onChange={(e) => setEditFirst(e.target.value)}
                  autoComplete="off"
                />
              </label>
              <label className="tag-field">
                <span>Nachname</span>
                <input
                  type="text"
                  value={editLast}
                  onChange={(e) => setEditLast(e.target.value)}
                  autoComplete="off"
                />
              </label>
              <label className="tag-field">
                <span>E-Mail</span>
                <input
                  type="email"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  autoComplete="off"
                />
              </label>
              <label className="tag-field">
                <span>Rolle</span>
                <select
                  value={editRole}
                  onChange={(e) => setEditRole(e.target.value as UserRole)}
                  className="user-mgmt-select"
                >
                  <option value="user">Benutzer</option>
                  <option value="customer">Kunde</option>
                  <option value="admin">Administrator</option>
                </select>
              </label>
              {editRole === "customer" && (
                <label className="tag-field">
                  <span>Firmenname (optional)</span>
                  <input
                    type="text"
                    value={editCompany}
                    onChange={(e) => setEditCompany(e.target.value)}
                    list={companyDatalistId}
                    autoComplete="off"
                    placeholder="Aus Kundenverwaltung oder neu …"
                  />
                </label>
              )}
              <label className="tag-field user-mgmt-active-field">
                <span>Konto aktiv</span>
                <input
                  type="checkbox"
                  checked={editActive}
                  disabled={editingUser.id === currentUserId}
                  title={
                    editingUser.id === currentUserId
                      ? "Das eigene Konto kann hier nicht deaktiviert werden."
                      : undefined
                  }
                  onChange={(e) => setEditActive(e.target.checked)}
                />
              </label>
              <div className="user-mgmt-edit-actions">
                <button
                  type="button"
                  className="btn-modal primary"
                  disabled={busy}
                  onClick={() => void saveEditedUser()}
                >
                  Speichern
                </button>
                <button
                  type="button"
                  className="btn-modal"
                  disabled={busy}
                  onClick={() => setEditingUser(null)}
                >
                  Abbrechen
                </button>
              </div>
            </div>
          </>
        )}

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
              <option value="customer">Kunde</option>
              <option value="admin">Administrator</option>
            </select>
          </label>
          {newRole === "customer" && (
            <label className="tag-field">
              <span>Firmenname (optional)</span>
              <input
                type="text"
                value={newCompany}
                onChange={(e) => setNewCompany(e.target.value)}
                list={companyDatalistId}
                autoComplete="off"
                placeholder="Aus Kundenverwaltung oder neu …"
              />
              <datalist id={companyDatalistId}>
                {customerNames.map((n) => (
                  <option key={n} value={n} />
                ))}
              </datalist>
            </label>
          )}
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
