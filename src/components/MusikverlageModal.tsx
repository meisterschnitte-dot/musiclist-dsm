import { useCallback, useEffect, useState } from "react";
import {
  deleteMusikverlageXlsx,
  fetchMusikverlageState,
  putMusikverlageEntries,
  uploadMusikverlageXlsx,
  type MusikverlageEntryDto,
  type MusikverlageStateResponse,
} from "../api/musikverlageApi";
import type { MusikverlagId } from "../musikverlage/musikverlageCatalog";

type Props = {
  open: boolean;
  onClose: () => void;
};

function formatTs(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("de-DE");
}

export function MusikverlageModal({ open, onClose }: Props) {
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [data, setData] = useState<MusikverlageStateResponse | null>(null);
  const [apiDraft, setApiDraft] = useState<Partial<Record<MusikverlagId, string>>>({});
  const [uploadBusyId, setUploadBusyId] = useState<MusikverlagId | null>(null);

  const reload = useCallback(async () => {
    const s = await fetchMusikverlageState();
    setData(s);
    const draft: Partial<Record<MusikverlagId, string>> = {};
    for (const row of s.catalog) {
      draft[row.id] = s.entries[row.id]?.apiBaseUrl ?? "";
    }
    setApiDraft(draft);
  }, []);

  useEffect(() => {
    if (!open) return;
    setErr(null);
    setBusy(true);
    void reload()
      .catch((e) => setErr(e instanceof Error ? e.message : "Laden fehlgeschlagen."))
      .finally(() => setBusy(false));
  }, [open, reload]);

  const onSaveApis = useCallback(async () => {
    if (!data) return;
    setErr(null);
    setSaveBusy(true);
    try {
      const entries: Partial<Record<MusikverlagId, { apiBaseUrl: string }>> = {};
      for (const row of data.catalog) {
        entries[row.id] = { apiBaseUrl: apiDraft[row.id] ?? "" };
      }
      await putMusikverlageEntries(entries);
      await reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Speichern fehlgeschlagen.");
    } finally {
      setSaveBusy(false);
    }
  }, [data, apiDraft, reload]);

  const onPickFile = useCallback(
    async (id: MusikverlagId, file: File | null) => {
      if (!file) return;
      setErr(null);
      setUploadBusyId(id);
      try {
        await uploadMusikverlageXlsx(id, file);
        await reload();
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Upload fehlgeschlagen.");
      } finally {
        setUploadBusyId(null);
      }
    },
    [reload]
  );

  const onRemoveFile = useCallback(
    async (id: MusikverlagId) => {
      setErr(null);
      setUploadBusyId(id);
      try {
        await deleteMusikverlageXlsx(id);
        await reload();
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Löschen fehlgeschlagen.");
      } finally {
        setUploadBusyId(null);
      }
    },
    [reload]
  );

  if (!open) return null;

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="modal modal--musikverlage"
        role="dialog"
        aria-modal="true"
        aria-labelledby="musikverlage-modal-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 className="modal-title" id="musikverlage-modal-title">
          Musikverlage
        </h2>
        <p className="modal-lead modal-lead--muted">
          Dieselben Anbieter wie die Portal-Buttons unter „Tags bearbeiten“. Pro Verlag optional eine
          API-Basis-URL und/oder eine Excel-Datei (.xlsx/.xls) auf dem Server ablegen. Nach dem Upload
          wird daraus eine eigene SQLite-Datenbank je Musikverlag erzeugt (für spätere Suche bzw.
          Auswertung). Ohne Eintrag bleibt die manuelle Nutzung im Tag-Editor.
        </p>
        {err ? (
          <p className="modal-error" role="alert">
            {err}
          </p>
        ) : null}
        {busy || !data ? (
          <p className="modal-lead">Laden …</p>
        ) : (
          <>
            <div className="musikverlage-table-wrap">
              <table className="musikverlage-table">
                <thead>
                  <tr>
                    <th scope="col">Musikverlag</th>
                    <th scope="col">API-Basis-URL (optional)</th>
                    <th scope="col">Tabelle</th>
                  </tr>
                </thead>
                <tbody>
                  {data.catalog.map((row) => {
                    const e = data.entries[row.id] as MusikverlageEntryDto | undefined;
                    const ub = uploadBusyId === row.id;
                    return (
                      <tr key={row.id}>
                        <td>
                          <div className="musikverlage-table-label">{row.label}</div>
                          <div className="musikverlage-table-hint">{row.hint}</div>
                        </td>
                        <td>
                          <input
                            type="url"
                            className="musikverlage-api-input"
                            placeholder="https://…"
                            autoComplete="off"
                            value={apiDraft[row.id] ?? ""}
                            onChange={(ev) =>
                              setApiDraft((prev) => ({ ...prev, [row.id]: ev.target.value }))
                            }
                            aria-label={`API-Basis-URL für ${row.label}`}
                          />
                        </td>
                        <td className="musikverlage-table-file">
                          {e?.hasFile ? (
                            <>
                              <div className="musikverlage-file-line">
                                <span className="musikverlage-file-name" title={e.xlsxFileName ?? ""}>
                                  {e.xlsxFileName ?? "Datei"}
                                </span>
                                <span className="musikverlage-file-meta">
                                  {formatTs(e.xlsxUploadedAtIso)}
                                  {e.hasTableDb && e.tableDbRowCount != null ? (
                                    <>
                                      {" "}
                                      · DB: {e.tableDbRowCount.toLocaleString("de-DE")} Zeilen
                                    </>
                                  ) : null}
                                </span>
                              </div>
                              <div className="musikverlage-file-actions">
                                <button
                                  type="button"
                                  className="btn-modal musikverlage-file-action-btn"
                                  disabled={ub}
                                  onClick={() => void onRemoveFile(row.id)}
                                >
                                  Entfernen
                                </button>
                                <label className="musikverlage-upload-label musikverlage-upload-label--inline">
                                  <input
                                    type="file"
                                    accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                                    className="visually-hidden"
                                    disabled={ub}
                                    onChange={(ev) => {
                                      const file = ev.currentTarget.files?.[0] ?? null;
                                      // Reset input so selecting the same file again still triggers change.
                                      ev.currentTarget.value = "";
                                      void onPickFile(row.id, file);
                                    }}
                                  />
                                  <span className="btn-modal musikverlage-file-action-btn">
                                    {ub ? "…" : "Ersetzen …"}
                                  </span>
                                </label>
                              </div>
                            </>
                          ) : (
                            <>
                              <span className="musikverlage-file-none">Keine Datei</span>
                              <label className="musikverlage-upload-label musikverlage-upload-label--after-none">
                                <input
                                  type="file"
                                  accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                                  className="visually-hidden"
                                  disabled={ub}
                                  onChange={(ev) => {
                                    const file = ev.currentTarget.files?.[0] ?? null;
                                    // Reset input so selecting the same file again still triggers change.
                                    ev.currentTarget.value = "";
                                    void onPickFile(row.id, file);
                                  }}
                                />
                                <span className="btn-modal musikverlage-file-action-btn">
                                  {ub ? "…" : "Hochladen …"}
                                </span>
                              </label>
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn-modal" onClick={onClose}>
                Schließen
              </button>
              <button
                type="button"
                className="btn-modal primary"
                disabled={saveBusy}
                onClick={() => void onSaveApis()}
              >
                {saveBusy ? "Speichern …" : "API-URLs speichern"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
