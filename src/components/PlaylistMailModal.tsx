import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchCustomersList, type CustomerRecord } from "../api/customersApi";
import { sendPlaylistMailRequest } from "../api/sendPlaylistMailApi";

function htmlMailToPlainText(html: string): string {
  if (typeof document === "undefined") {
    return html.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "");
  }
  const d = document.createElement("div");
  d.innerHTML = html;
  return (d.innerText || d.textContent || "").trim();
}

type Props = {
  open: boolean;
  onClose: () => void;
  /** Base64 der XLSX-Datei (gleicher Inhalt wie XLS-Export). */
  attachmentBase64: string;
  attachmentFileName: string;
  defaultSubject: string;
  /** HTML (z. B. &lt;strong&gt;, &lt;br&gt;) — wird mit Plaintext-Alternative versendet. */
  defaultBody: string;
  /** Geöffnete Bibliotheksdatei — wird dem Kunden nach Mail-Versand für den Browser zugewiesen. */
  mailAssignment: {
    libraryOwnerUserId: string;
    parentSegments: string[];
    playlistFileName: string;
  } | null;
  /** Aus Transfer-Vormerkung (/api/playlist-pending) — sonst leer. */
  initialCustomerId?: string;
  /** true wenn .list im Browser liegt, aber kein Kunde aus Transfer gemeldet wurde. */
  customerMissingHint?: boolean;
};

export function PlaylistMailModal({
  open,
  onClose,
  attachmentBase64,
  attachmentFileName,
  defaultSubject,
  defaultBody,
  mailAssignment,
  initialCustomerId = "",
  customerMissingHint = false,
}: Props) {
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [customerId, setCustomerId] = useState<string>("");
  const [subject, setSubject] = useState(defaultSubject);
  const [body, setBody] = useState(defaultBody);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (!open) return;
    setSubject(defaultSubject);
    setBody(defaultBody);
    setErr(null);
    const cid = initialCustomerId.trim();
    setCustomerId(cid);
    setBusy(true);
    void fetchCustomersList()
      .then((rows) => {
        setCustomers(rows);
        if (cid) {
          const c = rows.find((x) => x.id === cid);
          if (c) {
            const all = new Set<string>();
            for (const e of c.emails) all.add(e);
            for (const g of c.groups) for (const em of g.emails) all.add(em);
            setSelected(all);
          } else {
            setSelected(new Set());
          }
        } else {
          setSelected(new Set());
        }
      })
      .catch((e) => setErr(e instanceof Error ? e.message : "Kunden konnten nicht geladen werden."))
      .finally(() => setBusy(false));
  }, [open, defaultSubject, defaultBody, initialCustomerId]);

  const selectedCustomer = useMemo(
    () => customers.find((c) => c.id === customerId) ?? null,
    [customers, customerId]
  );

  const toggleEmail = useCallback((email: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email);
      else next.add(email);
      return next;
    });
  }, []);

  const setGroupEmails = useCallback((emails: string[], checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const e of emails) {
        if (checked) next.add(e);
        else next.delete(e);
      }
      return next;
    });
  }, []);

  const groupFullySelected = useCallback(
    (emails: string[]) => emails.length > 0 && emails.every((e) => selected.has(e)),
    [selected]
  );

  const canSend = Boolean(
    customerId.trim() && selected.size > 0 && subject.trim()
  );

  const send = useCallback(async () => {
    setErr(null);
    if (!customerId.trim()) {
      setErr("Bitte einen Kunden auswählen — die Zuordnung im System ist damit eindeutig.");
      return;
    }
    const to = [...selected];
    if (to.length === 0) {
      setErr("Bitte mindestens eine E-Mail-Adresse als Empfänger auswählen.");
      return;
    }
    if (!subject.trim()) {
      setErr("Bitte einen Betreff eingeben.");
      return;
    }
    setBusy(true);
    try {
      const hadHtml = /<[^>]+>/.test(body);
      let text: string;
      let html: string | undefined;
      text = hadHtml ? htmlMailToPlainText(body) : body;
      if (hadHtml) html = body;
      await sendPlaylistMailRequest({
        to,
        subject: subject.trim(),
        text,
        ...(html ? { html } : {}),
        attachmentBase64,
        attachmentFileName,
        ...(mailAssignment && customerId.trim()
          ? {
              customerId: customerId.trim(),
              libraryOwnerUserId: mailAssignment.libraryOwnerUserId,
              parentSegments: mailAssignment.parentSegments,
              playlistFileName: mailAssignment.playlistFileName,
            }
          : {}),
      });
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "E-Mail konnte nicht gesendet werden.");
    } finally {
      setBusy(false);
    }
  }, [selected, subject, body, attachmentBase64, attachmentFileName, onClose, mailAssignment, customerId]);

  if (!open) return null;

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="playlist-mail-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal modal--playlist-mail" onMouseDown={(e) => e.stopPropagation()}>
        <header className="playlist-mail-header">
          <h2 id="playlist-mail-title" className="playlist-mail-title">
            Playlist per E-Mail senden
          </h2>
          <p className="playlist-mail-intro">
            Die Excel-Datei wird nur als Anhang versendet (kein separater Download).{" "}
            <strong>Kunde</strong> und <strong>E-Mail-Empfänger</strong> müssen gewählt sein. Nach dem
            Transfer zu MP3 ist der Kunde in der Regel bereits vorgemerkt — die .list im Kundenkonto erscheint
            erst nach erfolgreichem Mail-Versand.
          </p>
          {customerMissingHint && mailAssignment ? (
            <p className="playlist-mail-err" role="alert">
              Kein Kunde aus dem Transfer übernommen — bitte hier einen Kunden wählen (oder erneut „Transfer to
              mp3“ mit Kundenauswahl ausführen).
            </p>
          ) : null}
          <p className="playlist-mail-attachment">
            Anhang: <span className="mono-cell">{attachmentFileName}</span>
          </p>
        </header>
        {err && <p className="user-auth-err playlist-mail-err">{err}</p>}

        <div className="playlist-mail-grid">
          <div className="playlist-mail-panel playlist-mail-panel--recipients">
            <h3 className="playlist-mail-panel-title">Kunde &amp; Empfänger</h3>
            <label className="tag-field playlist-mail-field">
              <span>Kunde (Pflichtfeld)</span>
              <select
                className="playlist-mail-select"
                value={customerId}
                onChange={(e) => {
                  setCustomerId(e.target.value);
                  setSelected(new Set());
                }}
                disabled={busy}
                required
                aria-required="true"
              >
                <option value="">— Kunde wählen —</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>

            {!customerId && (
              <p className="playlist-mail-customer-hint">
                Ohne gewählten Kunden können keine Empfänger ausgewählt und die Mail nicht versendet werden.
              </p>
            )}
            {selectedCustomer && (
              <>
                <h4 className="playlist-mail-recipients-title">Empfänger (mindestens eine Adresse)</h4>
                {selectedCustomer.emails.length === 0 &&
                  !selectedCustomer.groups.some((g) => g.emails.length > 0) && (
                    <p className="playlist-mail-no-emails-hint">
                      Für diesen Kunden sind noch keine E-Mail-Adressen hinterlegt. Bitte in der
                      Benutzerverwaltung Benutzer mit Rolle „Kunde“ und passendem Firmennamen einladen oder
                      Adressen in der Kundenverwaltung eintragen.
                    </p>
                  )}
                <div className="playlist-mail-recipients" role="group" aria-label="E-Mail-Adressen">
                  <p className="playlist-mail-recipients-label">Einzeladressen</p>
                  {selectedCustomer.emails.map((em) => (
                    <label key={em} className="customers-email-check">
                      <input type="checkbox" checked={selected.has(em)} onChange={() => toggleEmail(em)} />
                      <span className="mono-cell">{em}</span>
                    </label>
                  ))}
                </div>
                {selectedCustomer.groups.length > 0 && (
                  <div className="playlist-mail-recipients playlist-mail-recipients--groups">
                    <p className="playlist-mail-recipients-label">Gruppen</p>
                    {selectedCustomer.groups.map((g) => {
                      const full = groupFullySelected(g.emails);
                      const disabled = g.emails.length === 0;
                      return (
                        <label key={g.id} className="customers-email-check customers-email-check--group">
                          <input
                            type="checkbox"
                            checked={full}
                            disabled={disabled}
                            onChange={(e) => setGroupEmails(g.emails, e.target.checked)}
                          />
                          <span>
                            {g.name || "(ohne Namen)"}
                            {g.emails.length ? ` (${g.emails.length})` : ""}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>

          <div className="playlist-mail-panel playlist-mail-panel--compose">
            <h3 className="playlist-mail-panel-title">Nachricht</h3>
            <label className="tag-field playlist-mail-field">
              <span>Betreff</span>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="playlist-mail-input"
              />
            </label>
            <label className="tag-field playlist-mail-field">
              <span>Text</span>
              <span className="playlist-mail-html-hint">
                HTML möglich (&lt;br&gt;, &lt;strong&gt;…&lt;/strong&gt;); der Playlistname ist in der Vorlage fett.
              </span>
              <textarea
                className="playlist-mail-body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={12}
              />
            </label>
          </div>
        </div>

        <div className="modal-actions playlist-mail-actions">
          <button
            type="button"
            className="btn-modal primary"
            disabled={busy || !canSend}
            title={
              !customerId.trim()
                ? "Zuerst einen Kunden auswählen"
                : selected.size === 0
                  ? "Mindestens eine Empfängeradresse auswählen"
                  : !subject.trim()
                    ? "Betreff ausfüllen"
                    : undefined
            }
            onClick={() => void send()}
          >
            Mail senden
          </button>
          <button type="button" className="btn-modal" disabled={busy} onClick={onClose}>
            Abbrechen
          </button>
        </div>
      </div>
    </div>
  );
}
