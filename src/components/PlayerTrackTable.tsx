import { useCallback, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import type { PlayerTrack } from "../api/playerCatalogApi";
import { AUDIO_TAG_FIELD_LABELS, AUDIO_TAG_TABLE_COLUMN_KEYS } from "../audio/audioTags";
import {
  PLAYER_CATALOG_COL_DRAG_MIME,
  getPlayerCatalogColumnLabel,
  playerCatalogResizeMin,
  type PlayerCatalogColumnId,
} from "../player/playerCatalogTableLayout";
import { TABLE_COL_WIDTH_MAX, TAG_COLUMN_MIN_WIDTHS } from "../tableColumnLayout";
import { startColumnResizeDrag } from "../tableColResizeDrag";
import { formatMusicDbTimestamp } from "../tableFilters";
import { ColumnFilterTh } from "./ColumnFilterTh";

type PlayerFixedCol = "index" | "file" | "ingestAt" | "duration" | "add" | "remove";
export type PlayerTableCol = PlayerFixedCol | (typeof AUDIO_TAG_TABLE_COLUMN_KEYS)[number];

const TAG_COL_SET = new Set<string>(AUDIO_TAG_TABLE_COLUMN_KEYS);

export function playerTrackRowKey(track: PlayerTrack, index: number): string {
  return `${track.id}:${index}`;
}

function isTagCol(col: PlayerTableCol): col is (typeof AUDIO_TAG_TABLE_COLUMN_KEYS)[number] {
  return TAG_COL_SET.has(col);
}

const FIXED_DEFAULT_W: Record<PlayerFixedCol, number> = {
  index: 40,
  file: 180,
  ingestAt: 132,
  duration: 58,
  add: 92,
  remove: 40,
};

const FIXED_MIN_W: Record<PlayerFixedCol, number> = {
  index: 28,
  file: 72,
  ingestAt: 88,
  duration: 44,
  add: 72,
  remove: 36,
};

function colLabel(col: PlayerTableCol): string {
  if (col === "index") return "#";
  if (col === "file") return "Datei";
  if (col === "ingestAt") return "Ingest Datum";
  if (col === "duration") return "Dauer";
  if (col === "add" || col === "remove") return "";
  return AUDIO_TAG_FIELD_LABELS[col];
}

function colMin(col: PlayerTableCol): number {
  if (isTagCol(col)) return TAG_COLUMN_MIN_WIDTHS[col] ?? 28;
  return FIXED_MIN_W[col];
}

function colDefault(col: PlayerTableCol): number {
  if (isTagCol(col)) return Math.round((TAG_COLUMN_MIN_WIDTHS[col] ?? 72) * 1.28 + 16);
  return FIXED_DEFAULT_W[col];
}

export const PLAYER_PLAYLIST_COLS: PlayerTableCol[] = [
  "index",
  ...AUDIO_TAG_TABLE_COLUMN_KEYS,
  "remove",
];

function loadWidths(storageKey: string, columns: PlayerTableCol[]): number[] {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return columns.map(colDefault);
    const o = JSON.parse(raw) as Record<string, unknown>;
    return columns.map((c) => {
      const n = o[c];
      return typeof n === "number" && Number.isFinite(n)
        ? Math.max(colMin(c), Math.min(TABLE_COL_WIDTH_MAX, n))
        : colDefault(c);
    });
  } catch {
    return columns.map(colDefault);
  }
}

function saveWidths(storageKey: string, columns: PlayerTableCol[], widths: number[]): void {
  const o: Record<string, number> = {};
  columns.forEach((c, i) => {
    o[c] = widths[i] ?? colDefault(c);
  });
  localStorage.setItem(storageKey, JSON.stringify(o));
}

function tagText(t: PlayerTrack, col: PlayerTableCol): string {
  switch (col) {
    case "songTitle":
      return t.title.trim() || t.fileName;
    case "artist":
      return t.artist.trim();
    case "album":
      return t.album.trim();
    case "year":
      return (t.year ?? "").trim();
    case "composer":
      return (t.writer ?? "").trim();
    case "comment":
      return (t.comment ?? "").trim();
    case "isrc":
      return (t.isrc ?? "").trim();
    case "labelcode":
      return (t.labelcode ?? "").trim();
    case "label":
      return (t.label ?? "").trim();
    case "hersteller":
      return (t.publisher ?? "").trim();
    case "gvlRechte":
      return (t.gvlRights ?? "").trim();
    case "file":
      return t.relPath.trim() || t.fileName;
    case "ingestAt":
      return formatMusicDbTimestamp(t.ingestAt);
    default:
      return "";
  }
}

export type PlayerCatalogChrome = {
  filters: Record<string, string>;
  onFilterChange: (id: PlayerCatalogColumnId, value: string) => void;
  sort: { columnId: PlayerCatalogColumnId; direction: "asc" | "desc" } | null;
  onSort: (id: PlayerCatalogColumnId, direction: "asc" | "desc") => void;
  onHide: (id: PlayerCatalogColumnId) => void;
  hideDisabled: boolean;
  onReorder: (from: PlayerCatalogColumnId, to: PlayerCatalogColumnId) => void;
};

type Props = {
  columns: PlayerTableCol[];
  tracks: PlayerTrack[];
  storageKey?: string;
  controlledWidths?: number[];
  onWidthsCommit?: (next: number[]) => void;
  catalogChrome?: PlayerCatalogChrome;
  nowPlayingId?: number | null;
  formatDuration: (sec: number | null) => string;
  onPlay: (track: PlayerTrack, index: number) => void;
  onAdd?: (track: PlayerTrack) => void;
  onRemove?: (index: number) => void;
  addLabel?: string;
  removeControl?: (track: PlayerTrack, index: number) => ReactNode;
  deleteControl?: (track: PlayerTrack) => ReactNode;
  selectedKey?: string | null;
  onSelect?: (track: PlayerTrack, index: number) => void;
};

export function PlayerTrackTable({
  columns,
  tracks,
  storageKey = "musiclist-player-playlist-cols-v2",
  controlledWidths,
  onWidthsCommit,
  catalogChrome,
  nowPlayingId,
  formatDuration,
  onPlay,
  onAdd,
  onRemove,
  addLabel = "+PL",
  removeControl,
  deleteControl,
  selectedKey: selectedKeyProp,
  onSelect,
}: Props) {
  const colGroupRef = useRef<HTMLTableColElement | null>(null);
  const [localWidths, setLocalWidths] = useState(() => loadWidths(storageKey, columns));
  const widths = controlledWidths ?? localWidths;
  const widthsRef = useRef(widths);
  widthsRef.current = widths;
  const tableMin = useMemo(() => widths.reduce((a, b) => a + b, 0), [widths]);
  const [localSelectedKey, setLocalSelectedKey] = useState<string | null>(null);
  const selectedKey = selectedKeyProp !== undefined ? selectedKeyProp : localSelectedKey;

  const rowKey = playerTrackRowKey;

  const selectRow = (track: PlayerTrack, index: number) => {
    const key = rowKey(track, index);
    if (selectedKeyProp === undefined) setLocalSelectedKey(key);
    onSelect?.(track, index);
  };

  const isInteractiveTarget = (target: EventTarget | null) =>
    target instanceof Element && Boolean(target.closest("button, input, a, textarea"));

  const attachResize = useCallback(
    (colIndex: number) => (e: ReactMouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      startColumnResizeDrag({
        colIndex,
        clientX: e.clientX,
        startWidths: [...widthsRef.current],
        minForIndex: (i) =>
          catalogChrome
            ? playerCatalogResizeMin(columns[i] as PlayerCatalogColumnId)
            : colMin(columns[i]!),
        getColElements: () => colGroupRef.current?.children,
        onCommit: (next) => {
          if (onWidthsCommit) onWidthsCommit(next);
          else {
            setLocalWidths(next);
            saveWidths(storageKey, columns, next);
          }
        },
      });
    },
    [catalogChrome, columns, onWidthsCommit, storageKey]
  );

  return (
    <table className="player-workspace__table table-resizable" style={{ width: tableMin, minWidth: tableMin }}>
      <colgroup ref={colGroupRef}>
        {columns.map((c, i) => (
          <col key={c} style={{ width: widths[i], minWidth: widths[i] }} />
        ))}
      </colgroup>
      <thead>
        <tr>
          {columns.map((c, i) => {
            const label = catalogChrome ? getPlayerCatalogColumnLabel(c as PlayerCatalogColumnId) : colLabel(c);
            if (catalogChrome && c !== "add") {
              const colId = c as PlayerCatalogColumnId;
              return (
                <ColumnFilterTh
                  key={c}
                  colIndex={i}
                  attachResize={attachResize}
                  className={c !== "file" && c !== "duration" && c !== "ingestAt" ? "th-tag-field" : undefined}
                  title={label || undefined}
                  label={label}
                  filterValue={catalogChrome.filters[colId] ?? ""}
                  onFilterChange={(v) => catalogChrome.onFilterChange(colId, v)}
                  onClearFilter={() => catalogChrome.onFilterChange(colId, "")}
                  ariaLabelFilter={`Filter ${label}`}
                  columnSort={{
                    activeDirection: catalogChrome.sort?.columnId === colId ? catalogChrome.sort.direction : null,
                    onSortAsc: () => catalogChrome.onSort(colId, "asc"),
                    onSortDesc: () => catalogChrome.onSort(colId, "desc"),
                  }}
                  columnDrag={{
                    columnId: colId,
                    onDragStart: (e) => {
                      e.dataTransfer.setData(PLAYER_CATALOG_COL_DRAG_MIME, colId);
                      e.dataTransfer.setData("text/plain", colId);
                      e.dataTransfer.effectAllowed = "move";
                    },
                    onDragOver: () => {},
                    onDrop: (e) => {
                      e.preventDefault();
                      const from = (e.dataTransfer.getData(PLAYER_CATALOG_COL_DRAG_MIME) ||
                        e.dataTransfer.getData("text/plain")) as PlayerCatalogColumnId;
                      if (!from || from === colId) return;
                      catalogChrome.onReorder(from, colId);
                    },
                    onDragEnd: () => {},
                  }}
                  onHideColumn={() => catalogChrome.onHide(colId)}
                  hideColumnDisabled={catalogChrome.hideDisabled}
                />
              );
            }
            return (
              <th key={c} className="table-th-resizable" title={label || undefined}>
                {label}
                <span
                  className="table-col-resize-handle"
                  onMouseDown={attachResize(i)}
                  role="separator"
                  aria-orientation="vertical"
                  aria-label={`${label || "Spalte"} Breite anpassen`}
                />
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {tracks.map((t, i) => {
          const key = rowKey(t, i);
          const selected = selectedKey === key;
          const playing = nowPlayingId === t.id;
          return (
            <tr
              key={`${t.id}-${i}`}
              className={[
                playing ? "player-workspace__row--playing" : "",
                selected ? "player-workspace__row--selected" : "",
              ]
                .filter(Boolean)
                .join(" ") || undefined}
              aria-selected={selected}
              onClick={(e) => {
                if (isInteractiveTarget(e.target)) return;
                selectRow(t, i);
              }}
              onDoubleClick={(e) => {
                if (isInteractiveTarget(e.target)) return;
                e.preventDefault();
                selectRow(t, i);
                onPlay(t, i);
              }}
            >
              {columns.map((c) => {
                if (c === "index") return <td key={c}>{i + 1}</td>;
                if (c === "duration") return <td key={c}>{formatDuration(t.durationSec)}</td>;
                if (c === "add") {
                  return (
                    <td key={c} className="player-workspace__col-icon">
                      <div className="player-workspace__row-actions">
                        <button
                          type="button"
                          className="btn-cell"
                          title="Zur Playlist hinzufügen"
                          onClick={() => onAdd?.(t)}
                        >
                          {addLabel}
                        </button>
                        {deleteControl?.(t)}
                      </div>
                    </td>
                  );
                }
                if (c === "remove") {
                  return (
                    <td key={c} className="player-workspace__col-icon">
                      {removeControl ? (
                        removeControl(t, i)
                      ) : (
                        <button
                          type="button"
                          className="btn-cell btn-cell--danger"
                          onClick={() => onRemove?.(i)}
                          aria-label={`${tagText(t, "songTitle")} entfernen`}
                        >
                          Entfernen
                        </button>
                      )}
                    </td>
                  );
                }
                const text = tagText(t, c);
                return (
                  <td key={c} title={text || undefined}>
                    {text || "—"}
                  </td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
