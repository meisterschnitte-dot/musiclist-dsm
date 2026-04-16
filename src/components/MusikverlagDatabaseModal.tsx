import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  fetchMusikverlagDatabaseRows,
  updateMusikverlagDatabaseRow,
  type WcpmDbFilters,
  type WcpmDbRowDto,
} from "../api/musikverlageApi";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import type { MusikverlagId } from "../musikverlage/musikverlageCatalog";
import { startColumnResizeDrag } from "../tableColResizeDrag";
import {
  findGvlEntryByLabelcode,
  loadGvlLabelDb,
  loadGvlLabelDbFromIdb,
  type GvlLabelDb,
} from "../storage/gvlLabelStore";

type Props = {
  open: boolean;
  verlagId: MusikverlagId | null;
  verlagLabel: string;
  onClose: () => void;
};

const EMPTY_FILTERS: WcpmDbFilters = {
  filenameStem: "",
  songTitle: "",
  artist: "",
  album: "",
  composer: "",
  isrc: "",
  labelcode: "",
  warnung: "",
};

function anyFilterActive(f: WcpmDbFilters): boolean {
  return Object.values(f).some((v) => String(v).trim() !== "");
}

const COL_DEFAULT_WIDTHS = [220, 180, 170, 170, 160, 130, 120, 170, 190, 95, 110] as const;
const COL_MIN_WIDTHS = [120, 120, 120, 120, 120, 90, 90, 120, 130, 80, 90] as const;

function minForCol(colIndex: number): number {
  return COL_MIN_WIDTHS[colIndex] ?? 80;
}

type RowView = WcpmDbRowDto & { gvlLabel: string; gvlHersteller: string };

export function MusikverlagDatabaseModal({ open, verlagId, verlagLabel, onClose }: Props) {
  const [filters, setFilters] = useState<WcpmDbFilters>(EMPTY_FILTERS);
  const [rows, setRows] = useState<WcpmDbRowDto[]>([]);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saveBusyKey, setSaveBusyKey] = useState<string | null>(null);
  const [gvlDb, setGvlDb] = useState<GvlLabelDb | null>(() => loadGvlLabelDb());
  const [colWidths, setColWidths] = useState<number[]>(() => [...COL_DEFAULT_WIDTHS]);
  const filterActive = useMemo(() => anyFilterActive(filters), [filters]);
  const debouncedFilters = useDebouncedValue(filters, 220);
  const searchSeqRef = useRef(0);
  const colWidthsRef = useRef(colWidths);
  const colGroupRef = useRef<HTMLTableColElement | null>(null);
  colWidthsRef.current = colWidths;

  const attachResize = useCallback(
    (colIndex: number) => (e: ReactMouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      startColumnResizeDrag({
        colIndex,
        clientX: e.clientX,
        startWidths: [...colWidthsRef.current],
        minForIndex: minForCol,
        getColElements: () => colGroupRef.current?.children,
        onCommit: setColWidths,
      });
    },
    []
  );

  useEffect(() => {
    if (!open) return;
    setGvlDb(loadGvlLabelDb());
    void loadGvlLabelDbFromIdb().then((db) => {
      if (db?.entries?.length) setGvlDb(db);
    });
  }, [open]);

  const onSearch = useCallback(async (nextFilters: WcpmDbFilters = filters) => {
    if (!verlagId) return;
    const seq = ++searchSeqRef.current;
    setErr(null);
    if (!anyFilterActive(nextFilters)) {
      setRows([]);
      setTotal(0);
      setBusy(false);
      return;
    }
    setBusy(true);
    try {
      const data = await fetchMusikverlagDatabaseRows(verlagId, nextFilters);
      if (seq !== searchSeqRef.current) return;
      setRows(data.rows ?? []);
      setTotal(data.total ?? 0);
    } catch (e) {
      if (seq !== searchSeqRef.current) return;
      setRows([]);
      setTotal(0);
      setErr(e instanceof Error ? e.message : "Datenbankabfrage fehlgeschlagen.");
    } finally {
      if (seq !== searchSeqRef.current) return;
      setBusy(false);
    }
  }, [verlagId, filters]);

  useEffect(() => {
    if (!open || !verlagId) return;
    void onSearch(debouncedFilters);
  }, [open, verlagId, debouncedFilters, onSearch]);

  const rowsView = useMemo<RowView[]>(() => {
    return rows.map((r) => {
      const code = (r.payload.labelcode ?? "").trim();
      const hit = code ? findGvlEntryByLabelcode(gvlDb, code) : undefined;
      return {
        ...r,
        gvlLabel: hit?.label ?? "",
        gvlHersteller: hit?.hersteller ?? "",
      };
    });
  }, [rows, gvlDb]);

  useEffect(() => {
    if (!rows.length) return;
    setRows((prev) => {
      let changed = false;
      const next = prev.map((r) => {
        const code = (r.payload.labelcode ?? "").trim();
        if (!code) return r;
        const hit = findGvlEntryByLabelcode(gvlDb, code);
        if (hit || r.payload.warnung === true) return r;
        changed = true;
        return { ...r, payload: { ...r.payload, warnung: true } };
      });
      return changed ? next : prev;
    });
  }, [rows, gvlDb]);

  const onRowChange = useCallback(
    (rowKey: string, field: keyof WcpmDbRowDto["payload"], value: string | boolean) => {
      setRows((prev) =>
        prev.map((r) =>
          r.filenameStem === rowKey
            ? {
                ...r,
                payload:
                  field === "warnung"
                    ? { ...r.payload, warnung: value === true }
                    : (() => {
                        const nextPayload = { ...r.payload, [field]: String(value) };
                        if (field === "labelcode") {
                          const code = String(value).trim();
                          if (code) {
                            const hit = findGvlEntryByLabelcode(gvlDb, code);
                            if (!hit) nextPayload.warnung = true;
                          }
                        }
                        return nextPayload;
                      })(),
              }
            : r
        )
      );
    },
    [gvlDb]
  );

  const onSaveRow = useCallback(
    async (row: RowView) => {
      if (!verlagId) return;
      setErr(null);
      setSaveBusyKey(row.filenameStem);
      try {
        const code = (row.payload.labelcode ?? "").trim();
        const hit = code ? findGvlEntryByLabelcode(gvlDb, code) : undefined;
        const payload = {
          ...row.payload,
          warnung: hit ? row.payload.warnung === true : code ? true : row.payload.warnung === true,
        };
        const next = await updateMusikverlagDatabaseRow(verlagId, row.filenameStem, payload);
        setRows((prev) =>
          prev.map((r) => (r.filenameStem === row.filenameStem ? { ...r, payload: next } : r))
        );
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Speichern fehlgeschlagen.");
      } finally {
        setSaveBusyKey(null);
      }
    },
    [verlagId, gvlDb]
  );

  if (!open || !verlagId) return null;

  return (
    <div className="modal-backdrop modal-backdrop--stacked" role="presentation" onMouseDown={onClose}>
      <div
        className="modal modal--sys-settings modal--musikverlag-db"
        role="dialog"
        aria-modal="true"
        aria-labelledby="musikverlag-db-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="musikverlag-db-title" className="modal-title">
          Musikverlag-Datenbank: {verlagLabel}
        </h2>
        <p className="modal-lead modal-lead--muted">
          Wie bei GVL: erst Filter setzen, dann Treffer laden. Feldwerte sind editierbar.{" "}
          <strong>Warnung</strong> wirkt wie manuell gesetzte Warnung im Tag-Editor.
        </p>
        {err ? (
          <p className="modal-error" role="alert">
            {err}
          </p>
        ) : null}
        <div className="sys-settings-table-wrap">
          <table className="table-dense table-resizable sys-settings-table">
            <colgroup ref={colGroupRef}>
              {colWidths.map((w, i) => (
                <col key={i} style={{ width: w, minWidth: minForCol(i) }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th className="table-th-resizable table-th-with-filter" scope="col">
                  Dateiname (Stamm)
                  <span className="table-col-resize-handle" onMouseDown={attachResize(0)} />
                </th>
                <th className="table-th-resizable table-th-with-filter" scope="col">
                  Songtitel
                  <span className="table-col-resize-handle" onMouseDown={attachResize(1)} />
                </th>
                <th className="table-th-resizable table-th-with-filter" scope="col">
                  Interpret
                  <span className="table-col-resize-handle" onMouseDown={attachResize(2)} />
                </th>
                <th className="table-th-resizable table-th-with-filter" scope="col">
                  Album
                  <span className="table-col-resize-handle" onMouseDown={attachResize(3)} />
                </th>
                <th className="table-th-resizable table-th-with-filter" scope="col">
                  Komponist
                  <span className="table-col-resize-handle" onMouseDown={attachResize(4)} />
                </th>
                <th className="table-th-resizable table-th-with-filter" scope="col">
                  ISRC
                  <span className="table-col-resize-handle" onMouseDown={attachResize(5)} />
                </th>
                <th className="table-th-resizable table-th-with-filter" scope="col">
                  Labelcode
                  <span className="table-col-resize-handle" onMouseDown={attachResize(6)} />
                </th>
                <th className="table-th-resizable table-th-with-filter" scope="col">
                  Label (GVL)
                  <span className="table-col-resize-handle" onMouseDown={attachResize(7)} />
                </th>
                <th className="table-th-resizable table-th-with-filter" scope="col">
                  Hersteller (GVL)
                  <span className="table-col-resize-handle" onMouseDown={attachResize(8)} />
                </th>
                <th className="table-th-resizable table-th-with-filter" scope="col">
                  Warnung
                  <span className="table-col-resize-handle" onMouseDown={attachResize(9)} />
                </th>
                <th scope="col">Aktion</th>
              </tr>
              <tr>
                <th>
                  <input
                    type="search"
                    className="table-col-filter-input"
                    value={filters.filenameStem}
                    onChange={(e) => setFilters((p) => ({ ...p, filenameStem: e.target.value }))}
                    placeholder="Suchen …"
                  />
                </th>
                <th>
                  <input
                    type="search"
                    className="table-col-filter-input"
                    value={filters.songTitle}
                    onChange={(e) => setFilters((p) => ({ ...p, songTitle: e.target.value }))}
                    placeholder="Suchen …"
                  />
                </th>
                <th>
                  <input
                    type="search"
                    className="table-col-filter-input"
                    value={filters.artist}
                    onChange={(e) => setFilters((p) => ({ ...p, artist: e.target.value }))}
                    placeholder="Suchen …"
                  />
                </th>
                <th>
                  <input
                    type="search"
                    className="table-col-filter-input"
                    value={filters.album}
                    onChange={(e) => setFilters((p) => ({ ...p, album: e.target.value }))}
                    placeholder="Suchen …"
                  />
                </th>
                <th>
                  <input
                    type="search"
                    className="table-col-filter-input"
                    value={filters.composer}
                    onChange={(e) => setFilters((p) => ({ ...p, composer: e.target.value }))}
                    placeholder="Suchen …"
                  />
                </th>
                <th>
                  <input
                    type="search"
                    className="table-col-filter-input"
                    value={filters.isrc}
                    onChange={(e) => setFilters((p) => ({ ...p, isrc: e.target.value }))}
                    placeholder="Suchen …"
                  />
                </th>
                <th>
                  <input
                    type="search"
                    className="table-col-filter-input"
                    value={filters.labelcode}
                    onChange={(e) => setFilters((p) => ({ ...p, labelcode: e.target.value }))}
                    placeholder="Suchen …"
                  />
                </th>
                <th>
                  <div className="table-col-filter-input" aria-hidden />
                </th>
                <th>
                  <div className="table-col-filter-input" aria-hidden />
                </th>
                <th>
                  <select
                    className="table-col-filter-input"
                    value={filters.warnung}
                    onChange={(e) =>
                      setFilters((p) => ({ ...p, warnung: e.target.value as WcpmDbFilters["warnung"] }))
                    }
                  >
                    <option value="">Alle</option>
                    <option value="1">Nur Warnung</option>
                    <option value="0">Ohne Warnung</option>
                  </select>
                </th>
                <th>
                  <button
                    type="button"
                    className="btn-cell"
                    onClick={() => void onSearch(filters)}
                    disabled={busy}
                  >
                    {busy ? "…" : "Filtern"}
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {!filterActive ? (
                <tr>
                  <td colSpan={11} className="sys-settings-no-hits sys-settings-no-hits--idle">
                    Bitte zuerst Filter setzen.
                  </td>
                </tr>
              ) : rowsView.length === 0 ? (
                <tr>
                  <td colSpan={11} className="sys-settings-no-hits">
                    Keine Treffer.
                  </td>
                </tr>
              ) : (
                rowsView.map((r) => {
                  const saving = saveBusyKey === r.filenameStem;
                  return (
                    <tr key={r.filenameStem}>
                      <td className="mono-cell">{r.filenameStem}</td>
                      <td>
                        <input
                          type="text"
                          className="table-col-filter-input"
                          value={r.payload.songTitle ?? ""}
                          onChange={(e) => onRowChange(r.filenameStem, "songTitle", e.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          className="table-col-filter-input"
                          value={r.payload.artist ?? ""}
                          onChange={(e) => onRowChange(r.filenameStem, "artist", e.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          className="table-col-filter-input"
                          value={r.payload.album ?? ""}
                          onChange={(e) => onRowChange(r.filenameStem, "album", e.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          className="table-col-filter-input"
                          value={r.payload.composer ?? ""}
                          onChange={(e) => onRowChange(r.filenameStem, "composer", e.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          className="table-col-filter-input"
                          value={r.payload.isrc ?? ""}
                          onChange={(e) => onRowChange(r.filenameStem, "isrc", e.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          className="table-col-filter-input"
                          value={r.payload.labelcode ?? ""}
                          onChange={(e) => onRowChange(r.filenameStem, "labelcode", e.target.value)}
                        />
                      </td>
                      <td>{r.gvlLabel}</td>
                      <td>{r.gvlHersteller}</td>
                      <td>
                        <label className="tag-field tag-field--warnung-inline">
                          <input
                            type="checkbox"
                            checked={r.payload.warnung === true}
                            onChange={(e) => onRowChange(r.filenameStem, "warnung", e.target.checked)}
                          />
                        </label>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn-cell"
                          disabled={saving}
                          onClick={() => void onSaveRow(r)}
                        >
                          {saving ? "Speichern …" : "Speichern"}
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        {filterActive && rows.length > 0 ? (
          <p className="modal-lead modal-lead--muted">Treffer: {rows.length} / {total}</p>
        ) : null}
        {filterActive ? (
          <p className="modal-lead modal-lead--muted">
            Label/Hersteller werden aus der lokalen GVL-Datenbank anhand des Labelcodes ermittelt.
            Kein Treffer: Warnung wird beim Speichern automatisch aktiviert.
          </p>
        ) : null}
        <div className="modal-actions">
          <button type="button" className="btn-modal" onClick={onClose}>
            Schließen
          </button>
        </div>
      </div>
    </div>
  );
}
