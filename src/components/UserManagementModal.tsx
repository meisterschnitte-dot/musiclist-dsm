import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchCustomersList, type CustomerRecord } from "../api/customersApi";
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
  /** "" | Kunden-ID | "__new__" = neuer Firmenname (Freitext) */
  const [newCustomerPick, setNewCustomerPick] = useState<string>("");
  const [customersList, setCustomersList] = useState<CustomerRecord[]>([]);
  /** Bearbeiten: gleiche Logik wie newCustomerPick */
  const [editCustomerPick, setEditCustomerPick] = useState<string>("");

  const [editingUser, setEditingUser] = useState<AppUserRecord | null>(null);
  const [editFirst, setEditFirst] = useState("");
  const [editLast, setEditLast] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editRole, setEditRole] = useState<UserRole>("user");
  const [editCompany, setEditCompany] = useState("");
  const [editActive, setEditActive] = useState(true);
  const [listFilter, setListFilter] = useState("");

  useEffect(() => {
    if (!open) return;
    void fetchCustomersList()
      .then((rows) =>
        setCustomersList([...rows].sort((a, b) => a.name.localeCompare(b.name, "de")))
      )
      .catch(() => setCustomersList([]));
  }, [open]);

  useEffect(() => {
    if (!open) {
      setEditingUser(null);
      setNewCustomerPick("");
      setListFilter("");
    }
  }, [open]);

  useEffect(() => {
    if (newRole !== "customer") {
      setNewCompany("");
      setNewCustomerPick("");
    }
  }, [newRole]);

  useEffect(() => {
    if (!editingUser) return;
    setEditFirst(editingUser.firstName);
    setEditLast(editingUser.lastName);
    setEditEmail(editingUser.email);
    setEditRole(editingUser.role);
    setEditCompany(editingUser.companyName ?? "");
    setEditActive(isUserRecordActive(editingUser));
  }, [editingUser]);

  /** Kunden-Dropdown an customerId / Firmennamen koppeln (nach Laden der Kundenliste). */
  useEffect(() => {
    if (!editingUser) {
      setEditCustomerPick("");
      return;
    }
    const cm = (editingUser.companyName ?? "").trim();
    if (editingUser.customerId) {
      const byId = customersList.find((c) => c.id === editingUser.customerId);
      if (byId) {
        setEditCustomerPick(byId.id);
        return;
      }
    }
    if (cm) {
      const byName = customersList.find(
        (c) => c.name.trim().toLowerCase() === cm.toLowerCase()
      );
      setEditCustomerPick(byName ? byName.id : "__new__");
    } else {
      setEditCustomerPick("");
    }
  }, [editingUser, customersList]);

  const companyDatalistId = useMemo(() => "user-mgmt-company-datalist", []);
  const filteredUsers = useMemo(() => {
    const q = listFilter.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => {
      const roleLabel =
        u.role === "admin" ? "administrator" : u.role === "customer" ? "kunde" : "benutzer";
      return (
        u.firstName.toLowerCase().includes(q) ||
        u.lastName.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        (u.companyName ?? "").toLowerCase().includes(q) ||
        roleLabel.includes(q)
      );
    });
  }, [users, listFilter]);

  const onNewCustomerPickChange = useCallback(
    (value: string) => {
      setNewCustomerPick(value);
      if (value && value !== "__new__") {
        const c = customersList.find((x) => x.id === value);
        if (c) setNewCompany(c.name);
      } else if (value === "__new__") {
        setNewCompany("");
      }
    },
    [customersList]
  );

  const onEditCustomerPickChange = useCallback(
    (value: string) => {
      setEditCustomerPick(value);
      if (value && value !== "__new__") {
        const c = customersList.find((x) => x.id === value);
        if (c) setEditCompany(c.name);
      } else if (value === "__new__") {
        setEditCompany("");
      }
    },
    [customersList]
  );

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
    if (roleForInvite === "customer" && !company) {
      setErr(
        "Für die Rolle „Kunde“ ist ein Firmenname erforderlich — bestehenden Kunden wählen oder neu eintragen."
      );
      return;
    }
    setBusy(true);
    try {
      await inviteUserRequest({
        firstName: fn,
        lastName: ln,
        email: em,
        role: roleForInvite,
        ...(roleForInvite === "customer" ? { companyName: company } : {}),
      });
      await reloadList();
      setNewFirst("");
      setNewLast("");
      setNewEmail("");
      setNewRole("user");
      setNewCompany("");
      setNewCustomerPick("");

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
    if (editRole === "customer" && !company) {
      setErr(
        "Für die Rolle „Kunde“ ist ein Firmenname erforderlich — bestehenden Kunden wählen oder neu eintragen."
      );
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

        <div className="user-mgmt-filter-row">
          <input
            type="search"
            className="user-mgmt-filter-input"
            placeholder="Benutzer filtern (Name, E-Mail, Firma, Rolle) …"
            value={listFilter}
            onChange={(e) => setListFilter(e.target.value)}
            autoComplete="off"
          />
          {listFilter.trim() ? (
            <button
              type="button"
              className="btn-cell btn-cell--soft btn-cell--compact"
              onClick={() => setListFilter("")}
            >
              Filter löschen
            </button>
          ) : null}
        </div>
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
                <th>Eingeloggt</th>
                <th>Doppellogin</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((u) => (
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
                    <span className={u.loggedIn ? "user-mgmt-presence user-mgmt-presence--online" : "user-mgmt-presence"}>
                      {u.loggedIn ? "Ja" : "Nein"}
                      {u.loggedIn && (u.activeClientCount ?? 0) > 0 ? ` (${u.activeClientCount})` : ""}
                    </span>
                  </td>
                  <td>
                    <span
                      className={
                        u.doubleLogin
                          ? "user-mgmt-presence user-mgmt-presence--double"
                          : "user-mgmt-presence"
                      }
                    >
                      {u.doubleLogin ? "Ja" : "Nein"}
                    </span>
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
              {filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={9} className="user-mgmt-empty">
                    Keine Benutzer für den aktuellen Filter.
                  </td>
                </tr>
              ) : null}
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
                  onChange={(e) => {
                    const r = e.target.value as UserRole;
                    setEditRole(r);
                    if (r !== "customer") {
                      setEditCompany("");
                      setEditCustomerPick("");
                    }
                  }}
                  className="user-mgmt-select"
                >
                  <option value="user">Benutzer</option>
                  <option value="customer">Kunde</option>
                  <option value="admin">Administrator</option>
                </select>
              </label>
              {editRole === "customer" && (
                <>
                  <label className="tag-field">
                    <span>Kunde (Firma)</span>
                    <span className="customers-field-hint">
                      Bestehenden Kunden wählen oder „Neu …“ und Firmennamen eintragen — neue Firmen erscheinen
                      danach in der Kundenverwaltung.
                    </span>
                    <select
                      className="user-mgmt-select"
                      value={editCustomerPick}
                      onChange={(e) => onEditCustomerPickChange(e.target.value)}
                    >
                      <option value="">— Kunde wählen oder neu —</option>
                      {customersList.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                      <option value="__new__">Neuen Kunden anlegen (Firmenname unten) …</option>
                    </select>
                  </label>
                  <label className="tag-field">
                    <span>Firmenname</span>
                    <input
                      type="text"
                      value={editCompany}
                      onChange={(e) => {
                        const v = e.target.value;
                        setEditCompany(v);
                        const t = v.trim();
                        if (!t) {
                          setEditCustomerPick("");
                          return;
                        }
                        const byName = customersList.find(
                          (c) => c.name.trim().toLowerCase() === t.toLowerCase()
                        );
                        setEditCustomerPick(byName ? byName.id : "__new__");
                      }}
                      list={companyDatalistId}
                      autoComplete="off"
                      placeholder="z. B. Produktionsfirma XY"
                    />
                  </label>
                </>
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
              onChange={(e) => {
                const r = e.target.value as UserRole;
                setNewRole(r);
                if (r !== "customer") {
                  setNewCompany("");
                  setNewCustomerPick("");
                }
              }}
              className="user-mgmt-select"
            >
              <option value="user">Benutzer</option>
              <option value="customer">Kunde</option>
              <option value="admin">Administrator</option>
            </select>
          </label>
          {newRole === "customer" && (
            <>
              <label className="tag-field">
                <span>Kunde (Firma)</span>
                <span className="customers-field-hint">
                  Bestehenden Kunden wählen oder „Neu …“ und Firmennamen eintragen — neue Firmen erscheinen
                  danach in der Kundenverwaltung.
                </span>
                <select
                  className="user-mgmt-select"
                  value={newCustomerPick}
                  onChange={(e) => onNewCustomerPickChange(e.target.value)}
                >
                  <option value="">— Kunde wählen oder neu —</option>
                  {customersList.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                  <option value="__new__">Neuen Kunden anlegen (Firmenname unten) …</option>
                </select>
              </label>
              <label className="tag-field">
                <span>Firmenname</span>
                <input
                  type="text"
                  value={newCompany}
                  onChange={(e) => {
                    const v = e.target.value;
                    setNewCompany(v);
                    const t = v.trim();
                    if (!t) {
                      setNewCustomerPick("");
                      return;
                    }
                    const byName = customersList.find(
                      (c) => c.name.trim().toLowerCase() === t.toLowerCase()
                    );
                    setNewCustomerPick(byName ? byName.id : "__new__");
                  }}
                  list={companyDatalistId}
                  autoComplete="off"
                  placeholder="z. B. Produktionsfirma XY"
                />
              </label>
            </>
          )}
          <datalist id={companyDatalistId}>
            {customersList.map((c) => (
              <option key={c.id} value={c.name} />
            ))}
          </datalist>
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
