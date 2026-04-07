import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { openGvlWebGuessSearch } from "../gvlWebSearch";
import type { GvlLabelDb, GvlLabelEntry } from "../storage/gvlLabelStore";
import { startColumnResizeDrag } from "../tableColResizeDrag";
import { defaultGvlColumnWidths, gvlResizeMinForIndex } from "../tableColumnLayout";

type Props = {
  open: boolean;
  currentDb: GvlLabelDb | null;
  onClose: () => void;
  onImportDone: (nextDb: GvlLabelDb) => void;
  /** Wenn gesetzt (Tag-Editor offen): Zeile ins Tag-Fenster übernehmen. */
  onApplyEntryToTag?: (entry: GvlLabelEntry) => void;
};

const GVL_FILTER_DEBOUNCE_MS = 200;

type GvlFilterFields = {
  qLabelcode: string;
  qLabel: string;
  qKuerzel: string;
  qPlm: string;
  qHersteller: string;
  qRechter: string;
};

function anyGvlFilterTrimmed(f: GvlFilterFields): boolean {
  return (
    f.qLabelcode.trim() !== "" ||
    f.qLabel.trim() !== "" ||
    f.qKuerzel.trim() !== "" ||
    f.qPlm.trim() !== "" ||
    f.qHersteller.trim() !== "" ||
    f.qRechter.trim() !== ""
  );
}

function formatTs(iso: string | null): string {
  if (!iso) return "Noch kein Import";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("de-DE");
}

export function SystemSettingsModal({
  open,
  currentDb,
  onClose,
  onImportDone,
  onApplyEntryToTag,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<null | { file: string; rows: number }>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [qLabelcode, setQLabelcode] = useState("");
  const [qLabel, setQLabel] = useState("");
  const [qKuerzel, setQKuerzel] = useState("");
  const [qPlm, setQPlm] = useState("");
  const [qHersteller, setQHersteller] = useState("");
  const [qRechter, setQRechter] = useState("");
  const [gvlColWidths, setGvlColWidths] = useState(defaultGvlColumnWidths);
  const gvlColWidthsRef = useRef(gvlColWidths);
  gvlColWidthsRef.current = gvlColWidths;
  const gvlColGroupRef = useRef<HTMLTableColElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const d = defaultGvlColumnWidths();
    setGvlColWidths((w) => {
      if (w.length === d.length) return w;
      return d.map((dw, i) => (typeof w[i] === "number" ? w[i] : dw));
    });
  }, [open]);

  const attachGvlResize = useCallback((colIndex: number) => (e: ReactMouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    startColumnResizeDrag({
      colIndex,
      clientX: e.clientX,
      startWidths: [...gvlColWidthsRef.current],
      minForIndex: gvlResizeMinForIndex,
      getColElements: () => gvlColGroupRef.current?.children,
      onCommit: setGvlColWidths,
    });
  }, []);

  const currentInfo = useMemo(() => {
    return {
      rows: currentDb?.entries.length ?? 0,
      importedAt: formatTs(currentDb?.importedAtIso ?? null),
    };
  }, [currentDb]);

  const gvlFiltersImmediate = useMemo<GvlFilterFields>(
    () => ({
      qLabelcode,
      qLabel,
      qKuerzel,
      qPlm,
      qHersteller,
      qRechter,
    }),
    [qLabelcode, qLabel, qKuerzel, qPlm, qHersteller, qRechter]
  );

  const gvlAnyFilterActive = useMemo(() => anyGvlFilterTrimmed(gvlFiltersImmediate), [gvlFiltersImmediate]);

  const gvlFiltersDebounced = useDebouncedValue(gvlFiltersImmediate, GVL_FILTER_DEBOUNCE_MS);
  const gvlFiltersDeferred = useDeferredValue(gvlFiltersDebounced);

  const gvlDebouncedFilterActive = useMemo(
    () => anyGvlFilterTrimmed(gvlFiltersDebounced),
    [gvlFiltersDebounced]
  );

  const gvlDeferredFilterActive = useMemo(
    () => anyGvlFilterTrimmed(gvlFiltersDeferred),
    [gvlFiltersDeferred]
  );

  const filteredGvlEntries = useMemo(() => {
    if (!currentDb?.entries.length) return [];
    if (!gvlDeferredFilterActive) return [];
    const qc = gvlFiltersDeferred.qLabelcode.trim().toLowerCase();
    const ql = gvlFiltersDeferred.qLabel.trim().toLowerCase();
    const qk = gvlFiltersDeferred.qKuerzel.trim().toLowerCase();
    const qp = gvlFiltersDeferred.qPlm.trim().toLowerCase();
    const qh = gvlFiltersDeferred.qHersteller.trim().toLowerCase();
    const qr = gvlFiltersDeferred.qRechter.trim().toLowerCase();
    return currentDb.entries.filter((e) => {
      if (qc && !e.labelcode.toLowerCase().includes(qc)) return false;
      if (ql && !e.label.toLowerCase().includes(ql)) return false;
      if (qk && !e.kuerzel.toLowerCase().includes(qk)) return false;
      if (qp && !e.plm.toLowerCase().includes(qp)) return false;
      if (qh && !e.hersteller.toLowerCase().includes(qh)) return false;
      if (qr && !e.rechterueckrufe.toLowerCase().includes(qr)) return false;
      return true;
    });
  }, [currentDb, gvlFiltersDeferred, gvlDeferredFilterActive]);

  if (!open) return null;

  const onPickPdf = () => {
    if (busy) return;
    fileRef.current?.click();
  };

  const onFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setErr(null);
    setLastResult(null);
    setProgress(null);
    setBusy(true);
    try {
      const { parseGvlLabelPdfFile } = await import("../audio/parseGvlLabelPdf");
      let lastProgressUiTs = 0;
      const rows = await parseGvlLabelPdfFile(file, (done, total) => {
        const now = performance.now();
        // UI-Updates drosseln, damit große Tabellen nicht auf jeder Seite neu gerendert werden.
        if (done === total || now - lastProgressUiTs > 120) {
          lastProgressUiTs = now;
          setProgress({ done, total });
        }
      });
      if (!rows.length) {
        throw new Error(
          "Keine Labelzeilen erkannt. Bitte das PDF aus der GVL Label Recherche (Tabellenexport) verwenden."
        );
      }
      const nextDb: GvlLabelDb = {
        importedAtIso: new Date().toISOString(),
        entries: rows,
      };
      onImportDone(nextDb);
      setLastResult({ file: file.name, rows: rows.length });
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Import fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={`modal-backdrop${onApplyEntryToTag ? " modal-backdrop--stacked" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="sys-settings-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="modal modal--sys-settings" onMouseDown={(e) => e.stopPropagation()}>
        <h2 id="sys-settings-title" className="modal-title">
          GVL-Daten
        </h2>
        <p className="modal-lead">
          GVL-Labeldaten aus PDF importieren (überschreibt den bisherigen Bestand).
        </p>

        <div className="sys-settings-info">
          <div>
            <strong>Aktueller Stand:</strong> {currentInfo.rows} Einträge
          </div>
          <div>
            <strong>Letzter Import:</strong> {currentInfo.importedAt}
          </div>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept=".pdf,application/pdf"
          className="file-input-hidden"
          aria-hidden
          onChange={(e) => {
            void onFileChange(e);
          }}
        />

        <div className="modal-actions">
          <button type="button" className="btn-modal" onClick={onClose} disabled={busy}>
            Schließen
          </button>
          <button type="button" className="btn-modal primary" onClick={onPickPdf} disabled={busy}>
            {busy ? "Import läuft …" : "GVL-PDF einlesen"}
          </button>
        </div>

        {progress && (
          <div className="sys-settings-progress" aria-live="polite">
            <div className="sys-settings-progress-label">
              PDF wird eingelesen: Seite {progress.done} / {progress.total}
            </div>
            <div
              className="import-progress-track"
              role="progressbar"
              aria-valuenow={Math.round((progress.done / Math.max(1, progress.total)) * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className="import-progress-fill"
                style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }}
              />
            </div>
          </div>
        )}

        {lastResult && (
          <p className="sys-settings-ok" aria-live="polite">
            Import erfolgreich: {lastResult.rows} Einträge aus „{lastResult.file}“.
          </p>
        )}
        {err && (
          <p className="err" aria-live="polite">
            {err}
          </p>
        )}

        {busy ? (
          <p className="panel-hint">Tabelle wird während des Imports ausgeblendet, um den Import zu beschleunigen.</p>
        ) : currentDb && currentDb.entries.length > 0 ? (
          <>
            {!gvlAnyFilterActive ? (
              <p className="sys-settings-filter-hint" aria-live="polite">
                Suchbegriff in mindestens einem Feld eingeben — es werden keine Zeilen geladen, bis Sie
                filtern ({currentDb.entries.length.toLocaleString("de-DE")} Einträge im Bestand).
              </p>
            ) : !gvlDebouncedFilterActive ? (
              <div className="sys-settings-filter-meta sys-settings-filter-meta--pending" aria-live="polite">
                Eingabe wird ausgewertet …
              </div>
            ) : (
              <div className="sys-settings-filter-meta" aria-live="polite">
                Anzeige: {filteredGvlEntries.length} / {currentDb.entries.length}
              </div>
            )}
            <div className="sys-settings-table-wrap">
              <table className="table-dense table-resizable sys-settings-table">
                <colgroup ref={gvlColGroupRef}>
                  {gvlColWidths.map((w, i) => (
                    <col key={i} style={{ width: w, minWidth: gvlResizeMinForIndex(i) }} />
                  ))}
                </colgroup>
                <thead>
                  <tr>
                    <th className="table-th-resizable table-th-with-filter" scope="col">
                      <div className="table-th-filter-stack">
                      <div className="table-th-head-row">
                        <span className="table-th-text">Labelcode</span>
                      </div>
                      <input
                        type="search"
                        className="table-col-filter-input"
                        placeholder="Suchen …"
                        value={qLabelcode}
                        onChange={(e) => setQLabelcode(e.target.value)}
                        autoComplete="off"
                        aria-label="Labelcode filtern"
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => e.stopPropagation()}
                      />
                      </div>
                      <span
                        className="table-col-resize-handle"
                        onMouseDown={attachGvlResize(0)}
                        role="separator"
                        aria-orientation="vertical"
                        aria-label="Spaltenbreite Labelcode anpassen"
                      />
                    </th>
                    <th className="table-th-resizable table-th-with-filter" scope="col">
                      <div className="table-th-filter-stack">
                      <div className="table-th-head-row">
                        <span className="table-th-text">Label</span>
                      </div>
                      <input
                        type="search"
                        className="table-col-filter-input"
                        placeholder="Suchen …"
                        value={qLabel}
                        onChange={(e) => setQLabel(e.target.value)}
                        autoComplete="off"
                        aria-label="Label filtern"
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => e.stopPropagation()}
                      />
                      </div>
                      <span
                        className="table-col-resize-handle"
                        onMouseDown={attachGvlResize(1)}
                        role="separator"
                        aria-orientation="vertical"
                        aria-label="Spaltenbreite Label anpassen"
                      />
                    </th>
                    <th className="table-th-resizable table-th-with-filter" scope="col">
                      <div className="table-th-filter-stack">
                      <div className="table-th-head-row">
                        <span className="table-th-text">Kürzel</span>
                      </div>
                      <input
                        type="search"
                        className="table-col-filter-input"
                        placeholder="Suchen …"
                        value={qKuerzel}
                        onChange={(e) => setQKuerzel(e.target.value)}
                        autoComplete="off"
                        aria-label="Kürzel filtern"
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => e.stopPropagation()}
                      />
                      </div>
                      <span
                        className="table-col-resize-handle"
                        onMouseDown={attachGvlResize(2)}
                        role="separator"
                        aria-orientation="vertical"
                        aria-label="Spaltenbreite Kürzel anpassen"
                      />
                    </th>
                    <th className="table-th-resizable table-th-with-filter" scope="col">
                      <div className="table-th-filter-stack">
                      <div className="table-th-head-row">
                        <span className="table-th-text">PLM</span>
                      </div>
                      <input
                        type="search"
                        className="table-col-filter-input"
                        placeholder="Suchen …"
                        value={qPlm}
                        onChange={(e) => setQPlm(e.target.value)}
                        autoComplete="off"
                        aria-label="PLM filtern"
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => e.stopPropagation()}
                      />
                      </div>
                      <span
                        className="table-col-resize-handle"
                        onMouseDown={attachGvlResize(3)}
                        role="separator"
                        aria-orientation="vertical"
                        aria-label="Spaltenbreite PLM anpassen"
                      />
                    </th>
                    <th className="table-th-resizable table-th-with-filter" scope="col">
                      <div className="table-th-filter-stack">
                      <div className="table-th-head-row">
                        <span className="table-th-text">Hersteller</span>
                      </div>
                      <input
                        type="search"
                        className="table-col-filter-input"
                        placeholder="Suchen …"
                        value={qHersteller}
                        onChange={(e) => setQHersteller(e.target.value)}
                        autoComplete="off"
                        aria-label="Hersteller filtern"
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => e.stopPropagation()}
                      />
                      </div>
                      <span
                        className="table-col-resize-handle"
                        onMouseDown={attachGvlResize(4)}
                        role="separator"
                        aria-orientation="vertical"
                        aria-label="Spaltenbreite Hersteller anpassen"
                      />
                    </th>
                    <th className="table-th-resizable table-th-with-filter" scope="col">
                      <div className="table-th-filter-stack">
                      <div className="table-th-head-row">
                        <span className="table-th-text">Rechterückrufe</span>
                      </div>
                      <input
                        type="search"
                        className="table-col-filter-input"
                        placeholder="Suchen …"
                        value={qRechter}
                        onChange={(e) => setQRechter(e.target.value)}
                        autoComplete="off"
                        aria-label="Rechterückrufe filtern"
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => e.stopPropagation()}
                      />
                      </div>
                      <span
                        className="table-col-resize-handle"
                        onMouseDown={attachGvlResize(5)}
                        role="separator"
                        aria-orientation="vertical"
                        aria-label="Spaltenbreite Rechterückrufe anpassen"
                      />
                    </th>
                    <th className="sys-settings-gvl-apply-th" scope="col">
                      <div className="table-th-head-row table-th-head-row--no-resize">
                        <span className="table-th-text">Übernehmen</span>
                      </div>
                      <div className="sys-settings-gvl-web-th-spacer" aria-hidden />
                    </th>
                    <th className="sys-settings-gvl-web-th" scope="col" title="Websuche (Vermutung)">
                      <div className="table-th-head-row table-th-head-row--no-resize">
                        <span className="table-th-text">Web</span>
                      </div>
                      <div className="sys-settings-gvl-web-th-spacer" aria-hidden />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {!gvlAnyFilterActive ? (
                    <tr>
                      <td colSpan={8} className="sys-settings-no-hits sys-settings-no-hits--idle">
                        Keine Anzeige — bitte oben filtern (z. B. Labelcode oder Label).
                      </td>
                    </tr>
                  ) : !gvlDebouncedFilterActive ? (
                    <tr>
                      <td colSpan={8} className="sys-settings-no-hits sys-settings-no-hits--pending">
                        Liste wird gleich aktualisiert …
                      </td>
                    </tr>
                  ) : filteredGvlEntries.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="sys-settings-no-hits">
                        Keine Treffer für die aktuellen Filter.
                      </td>
                    </tr>
                  ) : (
                    filteredGvlEntries.map((e, rowIdx) => (
                      <tr key={`${rowIdx}-${e.labelcode}-${e.label}`}>
                        <td className="mono-cell table-td-resizable">{e.labelcode}</td>
                        <td className="table-td-resizable">{e.label}</td>
                        <td className="table-td-resizable">{e.kuerzel}</td>
                        <td className="table-td-resizable">{e.plm}</td>
                        <td className="table-td-resizable">{e.hersteller}</td>
                        <td className="table-td-resizable">{e.rechterueckrufe}</td>
                        <td className="sys-settings-gvl-apply-td">
                          <button
                            type="button"
                            className="btn-cell sys-settings-gvl-web-btn"
                            disabled={!onApplyEntryToTag}
                            title={
                              onApplyEntryToTag
                                ? "Labelcode, Label, Hersteller und Rechterückruf in das geöffnete Tag-Fenster schreiben (vorhandene Werte ersetzen)."
                                : "Zuerst „Tags bearbeiten“ öffnen, dann hier Daten ins Tag-Fenster übernehmen."
                            }
                            aria-label={`GVL-Zeile ${e.labelcode} in Tags übernehmen`}
                            onClick={() => onApplyEntryToTag?.(e)}
                          >
                            Übernehmen
                          </button>
                        </td>
                        <td className="sys-settings-gvl-web-td">
                          <button
                            type="button"
                            className="btn-cell sys-settings-gvl-web-btn"
                            title="Google-Suche: Labelcode, Label und Hersteller (Vermutung, neuer Tab)"
                            aria-label={`Web-Vermutung zu Label ${e.labelcode} suchen`}
                            onClick={() => openGvlWebGuessSearch(e)}
                          >
                            Suchen
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
