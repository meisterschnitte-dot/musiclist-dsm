import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createCustomerRequest,
  deleteCustomerRequest,
  fetchCustomersList,
  updateCustomerRequest,
  type CustomerEmailGroup,
  type CustomerRecord,
} from "../api/customersApi";

type Props = {
  open: boolean;
  onClose: () => void;
};

function parseEmailsBlock(raw: string): string[] {
  const parts = raw.split(/[\n,;]+/);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of parts) {
    const t = p.trim().toLowerCase();
    if (!t || !t.includes("@")) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

function emptyDraft(): CustomerRecord {
  return { id: "", name: "", emails: [], groups: [] };
}

export function CustomersModal({ open, onClose }: Props) {
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [list, setList] = useState<CustomerRecord[]>([]);
  const [draft, setDraft] = useState<CustomerRecord>(() => emptyDraft());
  const [emailsText, setEmailsText] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  /** Im Bearbeitungsformular: welche Gruppe im Dropdown aktiv ist. */
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const rows = await fetchCustomersList();
    setList(rows);
  }, []);

  useEffect(() => {
    if (!open) return;
    setErr(null);
    setBusy(true);
    void fetchCustomersList()
      .then((rows) => {
        setList(rows);
        setDraft(emptyDraft());
        setEmailsText("");
        setEditingId(null);
        setSelectedGroupId(null);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : "Kunden konnten nicht geladen werden."))
      .finally(() => setBusy(false));
  }, [open]);

  const startNew = useCallback(() => {
    setErr(null);
    setDraft(emptyDraft());
    setEmailsText("");
    setEditingId("new");
    setSelectedGroupId(null);
  }, []);

  const startEdit = useCallback((c: CustomerRecord) => {
    setErr(null);
    const groups = c.groups.map((g) => ({ ...g, emails: [...g.emails] }));
    setDraft({ ...c, groups });
    setEmailsText(c.emails.join("\n"));
    setEditingId(c.id);
    setSelectedGroupId(groups[0]?.id ?? null);
  }, []);

  const cancelEdit = useCallback(() => {
    setDraft(emptyDraft());
    setEmailsText("");
    setEditingId(null);
    setSelectedGroupId(null);
    setErr(null);
  }, []);

  const syncEmailsFromText = useCallback((): string[] => {
    return parseEmailsBlock(emailsText);
  }, [emailsText]);

  const setGroupName = useCallback((gid: string, name: string) => {
    setDraft((d) => ({
      ...d,
      groups: d.groups.map((g) => (g.id === gid ? { ...g, name } : g)),
    }));
  }, []);

  const toggleGroupEmail = useCallback((gid: string, email: string) => {
    const emails = parseEmailsBlock(emailsText);
    setDraft((d) => ({
      ...d,
      emails,
      groups: d.groups.map((g) => {
        if (g.id !== gid) return g;
        const has = g.emails.includes(email);
        const next = has ? g.emails.filter((e) => e !== email) : [...g.emails, email];
        return { ...g, emails: [...new Set(next)].sort() };
      }),
    }));
  }, [emailsText]);

  const addGroup = useCallback(() => {
    const emails = parseEmailsBlock(emailsText);
    const newId = `g-${Date.now()}`;
    setDraft((d) => ({
      ...d,
      emails,
      groups: [
        ...d.groups,
        {
          id: newId,
          name: "",
          emails: [],
        },
      ],
    }));
    setSelectedGroupId(newId);
  }, [emailsText]);

  const removeGroup = useCallback((gid: string) => {
    setDraft((d) => ({ ...d, groups: d.groups.filter((g) => g.id !== gid) }));
  }, []);

  /** Auswahl halten oder auf erste Gruppe setzen, wenn leer/ungültig (z. B. nach Löschen). */
  useEffect(() => {
    if (!editingId) return;
    const ids = draft.groups.map((g) => g.id);
    if (ids.length === 0) {
      setSelectedGroupId(null);
      return;
    }
    setSelectedGroupId((prev) => (prev && ids.includes(prev) ? prev : ids[0]!));
  }, [draft.groups, editingId]);

  const save = useCallback(async () => {
    setErr(null);
    const name = draft.name.trim();
    const emails = syncEmailsFromText();
    if (!name) {
      setErr("Bitte einen Kundennamen (Firmennamen) eingeben.");
      return;
    }
    const groups: CustomerEmailGroup[] = draft.groups
      .map((g) => ({
        ...g,
        name: g.name.trim(),
        emails: g.emails.filter((e) => emails.includes(e)),
      }))
      .filter((g) => g.name.length > 0);

    setBusy(true);
    try {
      if (editingId === "new") {
        await createCustomerRequest({ name, emails, groups });
        await reload();
        cancelEdit();
      } else if (editingId) {
        await updateCustomerRequest({
          id: editingId,
          name,
          emails,
          groups,
        });
        await reload();
        cancelEdit();
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Speichern fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }, [draft.groups, draft.name, editingId, cancelEdit, reload, syncEmailsFromText]);

  const remove = useCallback(
    async (c: CustomerRecord) => {
      setErr(null);
      if (!window.confirm(`Kunde „${c.name}“ wirklich löschen?`)) return;
      setBusy(true);
      try {
        await deleteCustomerRequest(c.id);
        await reload();
        if (editingId === c.id) cancelEdit();
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Löschen fehlgeschlagen.");
      } finally {
        setBusy(false);
      }
    },
    [reload, editingId, cancelEdit]
  );

  if (!open) return null;

  const emailPool = editingId ? syncEmailsFromText() : [];

  const selectedGroup = useMemo(
    () => draft.groups.find((g) => g.id === selectedGroupId) ?? null,
    [draft.groups, selectedGroupId]
  );

  const editorTitle =
    editingId === "new" ? "Kunden anlegen" : editingId ? "Kunde bearbeiten" : "Kunden anlegen";

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="customers-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal modal--customers" onMouseDown={(e) => e.stopPropagation()}>
        <header className="customers-modal-header">
          <h2 id="customers-title" className="customers-modal-title">
            Kunden verwalten
          </h2>
          <p className="customers-modal-intro">
            Kunden anlegen mit Firmennamen — E-Mail-Adressen kommen über die Benutzerverwaltung (Kunden
            einladen) dazu oder können hier optional ergänzt werden.
          </p>
        </header>
        {err && <p className="user-auth-err customers-modal-err">{err}</p>}

        <div className="customers-modal-grid">
          <section
            className="customers-modal-panel customers-modal-panel--list"
            aria-labelledby="customers-panel-list"
          >
            <div className="customers-panel-head">
              <h3 id="customers-panel-list" className="customers-panel-title">
                Kunden verwalten
              </h3>
              <p className="customers-panel-lead">Übersicht aller angelegten Kunden.</p>
            </div>
            <div className="customers-list-wrap">
              <table className="table-dense customers-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>E-Mails</th>
                    <th className="customers-table-th-actions" />
                  </tr>
                </thead>
                <tbody>
                  {list.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="customers-table-empty">
                        Noch keine Kunden — rechts einen neuen Kunden anlegen.
                      </td>
                    </tr>
                  ) : (
                    list.map((c) => (
                      <tr key={c.id}>
                        <td className="customers-table-name">{c.name}</td>
                        <td className="customers-table-emails">
                          {c.emails.length === 0 ? (
                            <span className="customers-table-no-emails">
                              — noch keine (Benutzerverwaltung)
                            </span>
                          ) : (
                            <ul className="customers-email-bullets">
                              {c.emails.map((em) => (
                                <li key={em} className="mono-cell">
                                  {em}
                                </li>
                              ))}
                            </ul>
                          )}
                        </td>
                        <td className="customers-table-actions">
                          <button
                            type="button"
                            className="btn-cell btn-cell--soft"
                            disabled={busy}
                            onClick={() => startEdit(c)}
                          >
                            Bearbeiten
                          </button>
                          <button
                            type="button"
                            className="btn-cell btn-cell--danger"
                            disabled={busy}
                            onClick={() => void remove(c)}
                          >
                            Löschen
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section
            className="customers-modal-panel customers-modal-panel--editor"
            aria-labelledby="customers-panel-editor"
          >
            <div className="customers-panel-head">
              <h3 id="customers-panel-editor" className="customers-panel-title">
                {editorTitle}
              </h3>
              <p className="customers-panel-lead">
                {editingId
                  ? "Firmenname genügt zum Anlegen. E-Mails optional oder über Benutzer (Rolle Kunde)."
                  : "Neuen Kunden nur mit Firmennamen anlegen oder einen Eintrag links bearbeiten."}
              </p>
            </div>

            <div className="customers-editor-inner">
              {!editingId ? (
                <div className="customers-editor-placeholder">
                  <p className="customers-editor-placeholder-text">
                    Lege einen Kunden mit Firmennamen an — Kontakt-E-Mails folgen über die
                    Benutzerverwaltung oder optional hier.
                  </p>
                  <button
                    type="button"
                    className="btn-modal primary customers-editor-cta"
                    disabled={busy}
                    onClick={startNew}
                  >
                    Neuen Kunden anlegen
                  </button>
                </div>
              ) : (
                <>
                  <label className="tag-field customers-field">
                    <span>Kundenname</span>
                    <input
                      type="text"
                      value={draft.name}
                      onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                      autoComplete="organization"
                      placeholder="z. B. Produktionsfirma XY"
                    />
                  </label>
                  <label className="tag-field customers-field">
                    <span>E-Mail-Adressen (optional)</span>
                    <span className="customers-field-hint">
                      Leer lassen, wenn Kontakte nur über „Benutzer einladen“ (Rolle Kunde) kommen — eine
                      pro Zeile oder durch Komma getrennt
                    </span>
                    <textarea
                      className="customers-emails-textarea"
                      value={emailsText}
                      onChange={(e) => setEmailsText(e.target.value)}
                      rows={6}
                      autoComplete="off"
                      placeholder={"optional:\nkontakt@beispiel.de\ninfo@beispiel.de"}
                    />
                  </label>

                  <div className="customers-groups-section">
                    <h4 className="customers-groups-title">Gruppen</h4>
                    <p className="customers-groups-lead">
                      Gruppe wählen oder neu anlegen — E-Mails sind eine Teilmenge der obigen Adressen (falls
                      vorhanden).
                    </p>
                    <div className="customers-groups-toolbar">
                      <label className="tag-field customers-field customers-group-select-wrap">
                        <span>Gruppe auswählen</span>
                        {draft.groups.length === 0 ? (
                          <select className="customers-group-select" disabled value="">
                            <option value="">Keine Gruppe angelegt</option>
                          </select>
                        ) : (
                          <select
                            className="customers-group-select"
                            value={selectedGroupId ?? ""}
                            onChange={(e) => setSelectedGroupId(e.target.value)}
                            disabled={busy}
                            aria-label="Gruppe zum Bearbeiten wählen"
                          >
                            {draft.groups.map((g) => (
                              <option key={g.id} value={g.id}>
                                {g.name.trim() || "Ohne Namen"} ({g.emails.length} Adressen)
                              </option>
                            ))}
                          </select>
                        )}
                      </label>
                      <button
                        type="button"
                        className="btn-modal btn-modal--ghost customers-group-add-btn"
                        disabled={busy}
                        onClick={addGroup}
                      >
                        + Neue Gruppe
                      </button>
                    </div>

                    {draft.groups.length === 0 ? (
                      <p className="customers-groups-empty">
                        Noch keine Gruppe — mit „+ Neue Gruppe“ anlegen.
                      </p>
                    ) : selectedGroup ? (
                      <div className="customers-group-block customers-group-block--single">
                        <div className="customers-group-head">
                          <input
                            type="text"
                            placeholder="Gruppenname"
                            value={selectedGroup.name}
                            onChange={(e) => setGroupName(selectedGroup.id, e.target.value)}
                            aria-label="Name der gewählten Gruppe"
                          />
                          <button
                            type="button"
                            className="btn-cell btn-cell--danger btn-cell--compact"
                            onClick={() => removeGroup(selectedGroup.id)}
                          >
                            Gruppe löschen
                          </button>
                        </div>
                        {emailPool.length === 0 ? (
                          <p className="customers-groups-empty">
                            Keine Adressen in der Liste — zuerst E-Mails hier eintragen oder über die
                            Benutzerverwaltung Kunden einladen.
                          </p>
                        ) : (
                          <div className="customers-group-checks" role="group" aria-label="E-Mails der Gruppe">
                            {emailPool.map((em) => (
                              <label key={em} className="customers-email-check">
                                <input
                                  type="checkbox"
                                  checked={selectedGroup.emails.includes(em)}
                                  onChange={() => toggleGroupEmail(selectedGroup.id, em)}
                                />
                                <span className="mono-cell">{em}</span>
                              </label>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : null}
                  </div>

                  <div className="customers-editor-actions">
                    <button type="button" className="btn-modal primary" disabled={busy} onClick={() => void save()}>
                      Speichern
                    </button>
                    <button type="button" className="btn-modal" disabled={busy} onClick={cancelEdit}>
                      Abbrechen
                    </button>
                  </div>
                </>
              )}
            </div>
          </section>
        </div>

        <div className="modal-actions customers-modal-footer">
          <button type="button" className="btn-modal" onClick={onClose}>
            Schließen
          </button>
        </div>
      </div>
    </div>
  );
}
