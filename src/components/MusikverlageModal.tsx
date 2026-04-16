import { useCallback, useEffect, useState } from "react";
import {
  appendMusikverlageXlsx,
  deleteMusikverlageXlsx,
  fetchMusikverlageState,
  putMusikverlageEntries,
  uploadMusikverlageXlsx,
  type MusikverlageEntryDto,
  type MusikverlageStateResponse,
} from "../api/musikverlageApi";
import type { MusikverlagId } from "../musikverlage/musikverlageCatalog";
import { MusikverlagDatabaseModal } from "./MusikverlagDatabaseModal";
import { APPLE_MUSIC_SEARCH_URL } from "../appleMusicSearch";
import { P7S1_MUSIKPORTAL_TRACK_RESEARCH_URL } from "../p7s1Musikportal";
import { UPM_SEARCH_URL } from "../upmUniversalProductionMusic";
import { BMGPM_SEARCH_URL } from "../bmgProductionMusic";
import { SONOTON_SEARCH_BASE_URL } from "../sonotonSearch";
import { EXTREME_MUSIC_URL } from "../extremeMusicSearch";
import { EARMOTION_ACCOUNT_URL } from "../earmotionSearch";
import { BLANKFRAME_URL } from "../blankframeSearch";

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

const MUSIKVERLAG_DEFAULTS: Partial<
  Record<MusikverlagId, { url?: string; integrationHint?: string }>
> = {
  p7s1: { url: P7S1_MUSIKPORTAL_TRACK_RESEARCH_URL },
  apple: { url: APPLE_MUSIC_SEARCH_URL },
  upm: { url: UPM_SEARCH_URL },
  bmgpm: { url: BMGPM_SEARCH_URL },
  sonoton: { url: SONOTON_SEARCH_BASE_URL },
  extreme: { url: EXTREME_MUSIC_URL },
  earmotion: { url: EARMOTION_ACCOUNT_URL },
  blankframe: {
    url: BLANKFRAME_URL,
    integrationHint: "API bereits hinterlegt (Blankframe-Track-API aktiv).",
  },
};

export function MusikverlageModal({ open, onClose }: Props) {
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [data, setData] = useState<MusikverlageStateResponse | null>(null);
  const [apiDraft, setApiDraft] = useState<Partial<Record<MusikverlagId, string>>>({});
  const [uploadBusyId, setUploadBusyId] = useState<MusikverlagId | null>(null);
  const [dbModalId, setDbModalId] = useState<MusikverlagId | null>(null);

  const reload = useCallback(async () => {
    const s = await fetchMusikverlageState();
    setData(s);
    const draft: Partial<Record<MusikverlagId, string>> = {};
    for (const row of s.catalog) {
      const configured = (s.entries[row.id]?.apiBaseUrl ?? "").trim();
      draft[row.id] = configured || MUSIKVERLAG_DEFAULTS[row.id]?.url || "";
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
    async (id: MusikverlagId, file: File | null, mode: "replace" | "append") => {
      if (!file) return;
      setErr(null);
      setUploadBusyId(id);
      try {
        if (mode === "append") {
          await appendMusikverlageXlsx(id, file);
        } else {
          await uploadMusikverlageXlsx(id, file);
        }
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

  const dbLabel = dbModalId ? data?.catalog.find((c) => c.id === dbModalId)?.label ?? dbModalId : "";

  return (
    <>
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
          API-Basis-URL und/oder eine Tabellen-Datei (.xlsx/.xls/.csv) auf dem Server ablegen. Nach dem
          Upload wird daraus eine eigene SQLite-Datenbank je Musikverlag erzeugt (für spätere Suche bzw.
          Auswertung). Über „Ergänzen …“ können weitere Tabellen hinzugefügt werden, die gemeinsam
          ausgewertet werden. Ohne Eintrag bleibt die manuelle Nutzung im Tag-Editor.
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
                    const fileNames =
                      e?.xlsxFileNames && e.xlsxFileNames.length
                        ? e.xlsxFileNames
                        : e?.xlsxFileName
                          ? [e.xlsxFileName]
                          : [];
                    const hasAnyFiles = !!e?.hasFile;
                    const defaultUrl = MUSIKVERLAG_DEFAULTS[row.id]?.url ?? "";
                    const configuredApiUrl = (e?.apiBaseUrl ?? "").trim();
                    const effectiveApiUrl = apiDraft[row.id] ?? "";
                    const usingDefaultUrl =
                      !configuredApiUrl &&
                      !!defaultUrl &&
                      effectiveApiUrl.trim().toLowerCase() === defaultUrl.trim().toLowerCase();
                    const integrationHint = MUSIKVERLAG_DEFAULTS[row.id]?.integrationHint ?? "";
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
                          <div className="musikverlage-api-notes">
                            {usingDefaultUrl ? (
                              <span className="musikverlage-api-note musikverlage-api-note--default">
                                Standard-URL aus bestehender Integration geladen.
                              </span>
                            ) : configuredApiUrl ? (
                              <span className="musikverlage-api-note musikverlage-api-note--custom">
                                Eigene URL gespeichert.
                              </span>
                            ) : null}
                            {integrationHint ? (
                              <span className="musikverlage-api-note musikverlage-api-note--api">
                                {integrationHint}
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td className="musikverlage-table-file">
                          <div className="musikverlage-file-layout">
                            <div className="musikverlage-import-hub">
                              <div
                                className={`musikverlage-import-hover ${hasAnyFiles ? "" : "is-empty"}`}
                                tabIndex={0}
                                role="button"
                                aria-label="Importierte Daten anzeigen"
                              >
                                <span className="musikverlage-import-trigger-text">IMPORTIERTE DATEN</span>
                                <div className="musikverlage-import-popover" role="menu">
                                  {hasAnyFiles ? (
                                    <ul className="musikverlage-import-list">
                                      {fileNames.map((name, i) => (
                                        <li key={`${row.id}-${i}`} title={name}>
                                          {name}
                                        </li>
                                      ))}
                                    </ul>
                                  ) : (
                                    <p className="musikverlage-import-empty">Keine Datei importiert.</p>
                                  )}
                                </div>
                              </div>
                              <div className="musikverlage-file-meta">
                                {hasAnyFiles
                                  ? `${e?.xlsxFileCount?.toLocaleString("de-DE") ?? fileNames.length} Datei(en) · ${formatTs(e?.xlsxUploadedAtIso ?? null)}`
                                  : "Noch keine importierten Tabellen"}
                                {e?.hasTableDb && e.tableDbRowCount != null ? (
                                  <> · DB: {e.tableDbRowCount.toLocaleString("de-DE")} Zeilen</>
                                ) : null}
                              </div>
                            </div>
                            <div className="musikverlage-action-grid">
                              <button
                                type="button"
                                className="btn-modal musikverlage-file-action-btn"
                                disabled={ub || row.id !== "wcpm" || !hasAnyFiles}
                                onClick={() => setDbModalId(row.id)}
                                title={row.id !== "wcpm" ? "Datenbankansicht aktuell nur für WCPM." : undefined}
                              >
                                Datenbank
                              </button>
                              <button
                                type="button"
                                className="btn-modal musikverlage-file-action-btn"
                                disabled={ub || !hasAnyFiles}
                                onClick={() => void onRemoveFile(row.id)}
                              >
                                Entfernen
                              </button>
                              <label className="musikverlage-upload-label musikverlage-upload-label--grid">
                                <input
                                  type="file"
                                  accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
                                  className="visually-hidden"
                                  disabled={ub}
                                  onChange={(ev) => {
                                    const file = ev.currentTarget.files?.[0] ?? null;
                                    ev.currentTarget.value = "";
                                    void onPickFile(row.id, file, "replace");
                                  }}
                                />
                                <span className="btn-modal musikverlage-file-action-btn">
                                  {ub ? "…" : hasAnyFiles ? "Ersetzen …" : "Hochladen …"}
                                </span>
                              </label>
                              <label className="musikverlage-upload-label musikverlage-upload-label--grid">
                                <input
                                  type="file"
                                  accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
                                  className="visually-hidden"
                                  disabled={ub}
                                  onChange={(ev) => {
                                    const file = ev.currentTarget.files?.[0] ?? null;
                                    ev.currentTarget.value = "";
                                    void onPickFile(row.id, file, "append");
                                  }}
                                />
                                <span className="btn-modal musikverlage-file-action-btn">
                                  {ub ? "…" : "Ergänzen …"}
                                </span>
                              </label>
                            </div>
                          </div>
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
      <MusikverlagDatabaseModal
        open={dbModalId !== null}
        verlagId={dbModalId}
        verlagLabel={dbLabel}
        onClose={() => setDbModalId(null)}
      />
    </>
  );
}
