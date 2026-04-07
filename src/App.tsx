import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import {
  applyMultiEditTagPatch,
  AUDIO_TAG_FIELD_LABELS,
  AUDIO_TAG_TABLE_COLUMN_KEYS,
  defaultTagsFromPlaylistTitle,
  DUPLICATE_MODAL_DISPLAY_KEYS,
  hasAnyAudioTagValue,
  mergeAudioTags,
  mergeWarnungForDisplay,
  overlayFromForm,
  tagCellText,
  type AudioTags,
} from "./audio/audioTags";
import { readAudioTagsFromBlob } from "./audio/readId3Tags";
import { EdlLibraryPanel, type LibraryDeleteInfo } from "./components/EdlLibraryPanel";
import { MediaPlayerDock } from "./components/MediaPlayerDock";
import { MenuBar } from "./components/MenuBar";
import { StoragePathsModal } from "./components/StoragePathsModal";
import { SystemSettingsModal } from "./components/SystemSettingsModal";
import { TagEditorModal, type GvlApplyFromDbPayload } from "./components/TagEditorModal";
import { ChangePasswordModal } from "./components/ChangePasswordModal";
import { UserAuthScreen } from "./components/UserAuthScreen";
import { CustomersModal } from "./components/CustomersModal";
import { PlaylistMailModal } from "./components/PlaylistMailModal";
import { TransferCustomerModal } from "./components/TransferCustomerModal";
import { UserManagementModal } from "./components/UserManagementModal";
import { replaceFolderPathPrefix } from "./edl/libraryPathUtils";
import type { OpenLibraryFilePayload } from "./edl/edlLibraryAccess";
import { createCustomerServerEdlLibraryAccess } from "./edl/customerServerEdlLibraryAccess";
import { createServerEdlLibraryAccess } from "./edl/serverEdlLibraryAccess";
import {
  edlFileNameToPlaylistFileName,
  gemaXlsFileNameToPlaylistFileName,
  isPlaylistLibraryFileName,
  LEGACY_PLAYLIST_LIBRARY_FILE_EXT,
  parsePlaylistLibraryFile,
  PLAYLIST_LIBRARY_FILE_EXT,
  sameLibraryPlaylistDocumentName,
  serializePlaylistLibraryFile,
} from "./edl/playlistLibraryFile";
import { parseEdl } from "./edl/parseEdl";
import { eventsToMergedPlaylist } from "./edl/mergePlaylist";
import { netPlaylistTrackCount } from "./edl/netPlaylistTrackCount";
import { playlistDurationTimecode } from "./edl/timecode";
import type { PlaylistEntry } from "./edl/types";
import {
  collectTagStoreKeysForRemovedMusicPaths,
  fileTagKey,
  loadTagStore,
  loadTagStoreFromIdb,
  playlistEntryTagStoreKey,
  playlistRowTagOverlay,
  playlistTagKey,
  saveTagStore,
  type TagStore,
} from "./storage/audioTagsStorage";
import {
  loadMusicDatabaseFileNames,
  saveMusicDatabaseFileNames,
} from "./storage/musicDatabaseStorage";
import {
  loadGvlLabelDb,
  loadGvlLabelDbFromIdb,
  saveGvlLabelDb,
  type GvlLabelDb,
  type GvlLabelEntry,
} from "./storage/gvlLabelStore";
import {
  applyGvlPlaylistSyncItem,
  applyWarnungForMissingGvlLabelcodes,
  enumerateGvlPlaylistSyncItems,
  formatGvlPlaylistSyncMissingReport,
  gvlSyncFieldMismatchFlags,
  type GvlPlaylistSyncRowMissing,
  type GvlSyncUpdateItem,
} from "./gvlPlaylistSync";
import { setUsersApiToken } from "./api/authToken";
import { copyTextToClipboard } from "./utils/copyToClipboard";
import {
  apiSharedGvlLabelDbFetch,
  apiSharedGvlLabelDbSave,
  apiSharedMusicDbFetch,
  apiSharedMusicDbRegister,
  apiSharedMusicDbRemovePaths,
  apiSharedMusicDbTouchTagEdited,
  type MusicDbFileMeta,
  apiSharedTracksExists,
  apiSharedTracksReadBinary,
  apiSharedTracksWriteBinary,
} from "./api/sharedTracksApi";
import { downloadFullDataBackup } from "./api/adminBackupApi";
import { uploadRestoreBackup } from "./api/adminRestoreApi";
import { apiStoragePathsFetch } from "./api/storagePathsApi";
import { fetchUsersList } from "./api/usersApi";
import type { AppUserRecord } from "./storage/appUsersStorage";
import { displayName } from "./storage/appUsersStorage";
import { clearWorkspace, loadWorkspace, saveWorkspace } from "./storage/workspaceStorage";
import {
  clampFontScale,
  FONT_SCALE_DEFAULT,
  FONT_SCALE_MAX,
  FONT_SCALE_MIN,
  FONT_SCALE_STEP,
  loadFontScale,
  saveFontScale,
} from "./storage/fontScaleStorage";
import { loadTheme, saveTheme, type AppTheme } from "./storage/themeStorage";
import { writeAudioTagsToSharedMp3 } from "./audio/writeAudioTagsToSharedMp3";
import { deleteMp3FilesFromSharedStorage } from "./tracks/deleteMp3FromSharedStorage";
import {
  deriveExportProjectFolderName,
  exportFakeTracksToSharedStorage,
  type DuplicateChoice,
  type DuplicatePrompt,
} from "./tracks/exportTracks";
import {
  basenamePath,
  resolveMusicDbPathForBasename,
  stripExtension,
} from "./tracks/sanitizeFilename";
import { getMusicDbPathsMissingOnServer } from "./tracks/missingMusicDbFiles";
import {
  isSafeTracksRelativePath,
  recreatePlaceholderMp3sOnShared,
  relativePathHasSubfolder,
} from "./tracks/recreatePlaceholderMp3s";
import { createSharedFakeMp3Sink } from "./tracks/sharedTracksSink";
import {
  openP7S1MusikportalWithOptionalClip,
  P7S1_MUSIKPORTAL_TRACK_RESEARCH_URL,
} from "./p7s1Musikportal";
import { startColumnResizeDrag } from "./tableColResizeDrag";
import {
  defaultMp3ColumnWidthsById,
  emptyMp3FiltersRecord,
  getMp3ColumnLabel,
  loadMp3TableLayout,
  mp3ColumnWidthMax,
  mp3ResizeMinForColumnId,
  MP3_TABLE_ALL_COLUMN_IDS,
  sanitizeMp3ColumnWidths,
  reorderMp3Columns,
  saveMp3TableLayout,
  type Mp3TableColumnId,
} from "./mp3TableLayout";
import {
  defaultEdlColumnWidthsById,
  edlColumnWidthMax,
  emptyEdlFiltersRecord,
  getEdlColumnLabel,
  loadEdlTableLayout,
  edlResizeMinForColumnId,
  EDL_TABLE_ALL_COLUMN_IDS,
  sanitizeEdlColumnWidths,
  reorderEdlColumns,
  saveEdlTableLayout,
  type EdlTableColumnId,
} from "./edlTableLayout";
import { compareSortableStrings, type SortDirection } from "./tableColumnSort";
import {
  buildEdlRowCellsMap,
  buildMp3RowCellsMap,
  formatMusicDbTimestamp,
  formatMusicDbTrackNumber,
  hasActiveColumnFiltersRecord,
  matchesColumnFilters,
} from "./tableFilters";
import { isGemaXlsFileName, parseGemaXls } from "./gema/parseGemaXls";
import {
  buildPlaylistExportXlsxBuffer,
  exportPlaylistColumnIds,
  exportPlaylistViewToXlsx,
} from "./edl/exportPlaylistViewXls";
import { arrayBufferToBase64 } from "./api/sendPlaylistMailApi";
import {
  lookupPlaylistPendingCustomerRequest,
  registerPlaylistPendingRequest,
} from "./api/playlistPendingApi";

const IMPORT_EDL_TOOLTIP =
  "EDL einlesen (Avid / Premiere): zusammenhängende Schnitte werden zusammengefasst; ähnliche Titel ggf. über Spuren/Lücken verbunden; BL ignoriert. Außerdem gespeicherte Playlists (.list / .egpl).";

const IMPORT_XLS_TOOLTIP =
  "GEMA-Liste (.xls) einlesen: festes Layout, erste Datenzeile Zeile 8, Tags und Timecode aus der Tabelle — keine EDL-Zusammenführung.";

const IMPORT_EDL_ACCEPT = ".edl,.list,.egpl,text/plain";
const IMPORT_XLS_ACCEPT = ".xls";

const FAKE_MP3_TOOLTIP =
  "Legt für jeden Listeneintrag eine Platzhalter-MP3 auf dem Server (gemeinsame Musikdatenbank) an und verknüpft die Zeilen fest mit diesen Dateinamen. Kam die EDL aus dem EDL- & Playlist Browser, wird die .edl dort durch eine wiederverwendbare Playlist (.list) ersetzt. Bei Konflikten wirst du gefragt.";

const TRANSFER_TO_MP3_TOOLTIP =
  "Fake-MP3 aus EDL anlegen. " +
  FAKE_MP3_TOOLTIP +
  " Ist mp3 vorhanden, wird Datensatz verknüpft.";

const TRANSFER_OFFLINE_MP3_TOOLTIP =
  "Nur für weiß markierte Zeilen: Verknüpfung aus der Playlist, aber keine MP3 in der Musikdatenbank (z. B. nach Löschen). " +
  "Legt dafür Platzhalter-MP3s auf dem Server an; die Markierung verschwindet, sobald die Einträge in der Musikdatenbank sind.";

const GVL_ABGLEICH_TOOLTIP =
  "Vergleicht Label, Hersteller und Rechterückruf der verknüpften MP3-Tags mit der importierten GVL-Liste — wie beim erneuten Öffnen einer Playlist (.list).";

const XLS_EXPORT_TOOLTIP =
  "Export: wie die Ansicht (Sortierung, Filter), aber ohne Spalten „Titel / Quelle“ und „Jahr“; Spalte # als Zahl. GEMA-Listenstil: Titelleiste, Datum, graue Kopfzeile, Rahmen.";

const PLAYLIST_MAIL_TOOLTIP =
  "Dialog zum Versand der GEMA-Übersicht als Excel-Anhang per E-Mail an Kundenadressen (nur Administratoren).";

function escapeHtmlForMail(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const MP3_COL_DRAG_MIME = "application/x-mp3-col-id";
const EDL_COL_DRAG_MIME = "application/x-edl-col-id";

function initialMp3TableLayoutState() {
  return loadMp3TableLayout();
}

function initialEdlTableLayoutState() {
  return loadEdlTableLayout();
}

function isMp3TagColumnId(id: Mp3TableColumnId): id is (typeof AUDIO_TAG_TABLE_COLUMN_KEYS)[number] {
  return (AUDIO_TAG_TABLE_COLUMN_KEYS as readonly string[]).includes(id);
}

function mp3DataCellClass(colId: Mp3TableColumnId): string {
  if (colId === "num") return "tc table-td-resizable mono-cell";
  if (colId === "filename") return "mono-cell table-td-resizable";
  if (colId === "created" || colId === "edited") return "table-td-resizable";
  return "td-tag-field table-td-resizable";
}

function renderMp3DataCell(
  colId: Mp3TableColumnId,
  name: string,
  merged: AudioTags,
  catNo: number,
  rowMeta: { createdAt?: string; updatedAt?: string } | undefined
): ReactNode {
  switch (colId) {
    case "num":
      return formatMusicDbTrackNumber(catNo);
    case "filename":
      return name;
    case "created":
      return formatMusicDbTimestamp(rowMeta?.createdAt);
    case "edited":
      return formatMusicDbTimestamp(rowMeta?.updatedAt);
    default:
      return isMp3TagColumnId(colId) ? tagCellText(merged, colId) : "";
  }
}

function isEdlTagColumnId(id: EdlTableColumnId): id is (typeof AUDIO_TAG_TABLE_COLUMN_KEYS)[number] {
  return (AUDIO_TAG_TABLE_COLUMN_KEYS as readonly string[]).includes(id);
}

function edlDataCellClass(colId: EdlTableColumnId): string {
  if (colId === "num") return "tc table-td-resizable";
  if (colId === "track") return "track table-td-resizable";
  if (colId === "tcIn" || colId === "tcOut" || colId === "duration") return "tc table-td-resizable";
  if (colId === "title") return "table-td-resizable";
  return "td-tag-field table-td-resizable";
}

function renderEdlDataCell(
  colId: EdlTableColumnId,
  row: PlaylistEntry,
  rowIndex: number,
  merged: AudioTags
): ReactNode {
  switch (colId) {
    case "num":
      return rowIndex + 1;
    case "track":
      return row.track;
    case "tcIn":
      return row.recIn;
    case "tcOut":
      return row.recOut;
    case "duration":
      return playlistDurationTimecode(row.recInFrames, row.recOutFrames);
    case "title":
      return row.linkedTrackFileName ?? row.title;
    default:
      return isEdlTagColumnId(colId) ? tagCellText(merged, colId) : "";
  }
}

function getEdlCellPlainText(
  colId: EdlTableColumnId,
  row: PlaylistEntry,
  rowIndex: number,
  merged: AudioTags
): string {
  const cell = renderEdlDataCell(colId, row, rowIndex, merged);
  if (cell == null || typeof cell === "boolean") return "";
  return String(cell);
}

/** Kundenansicht: Mehrfachauswahl (Strg/Cmd+Klick) — Schlüssel ohne Kollision mit Spalten-IDs. */
const CUSTOMER_CELL_KEY_SEP = "\u0001";

function customerCellKey(rowIndex: number, colId: EdlTableColumnId): string {
  return `${rowIndex}${CUSTOMER_CELL_KEY_SEP}${colId}`;
}

function parseCustomerCellKey(key: string): { rowIndex: number; colId: EdlTableColumnId } | null {
  const i = key.indexOf(CUSTOMER_CELL_KEY_SEP);
  if (i < 0) return null;
  const rowIndex = Number(key.slice(0, i));
  if (!Number.isInteger(rowIndex) || rowIndex < 0) return null;
  const colId = key.slice(i + CUSTOMER_CELL_KEY_SEP.length) as EdlTableColumnId;
  if (!EDL_TABLE_ALL_COLUMN_IDS.includes(colId)) return null;
  return { rowIndex, colId };
}

/**
 * Mehrere markierte Zellen als TSV: Zeilen = Playlist-Zeilen (aufsteigend),
 * innerhalb einer Zeile Spalten in der aktuellen Tabellenreihenfolge.
 */
function buildCustomerMultiCellClipboardText(
  keys: Iterable<string>,
  playlist: PlaylistEntry[],
  playlistMergedTags: AudioTags[],
  columnOrder: EdlTableColumnId[]
): string {
  const byRow = new Map<number, EdlTableColumnId[]>();
  for (const key of keys) {
    const p = parseCustomerCellKey(key);
    if (!p || p.rowIndex >= playlist.length) continue;
    if (!playlist[p.rowIndex]) continue;
    let cols = byRow.get(p.rowIndex);
    if (!cols) {
      cols = [];
      byRow.set(p.rowIndex, cols);
    }
    if (!cols.includes(p.colId)) cols.push(p.colId);
  }
  const rowIndices = [...byRow.keys()].sort((a, b) => a - b);
  const colRank = (c: EdlTableColumnId) => {
    const ix = columnOrder.indexOf(c);
    return ix === -1 ? 9999 : ix;
  };
  const lines: string[] = [];
  for (const rowIndex of rowIndices) {
    const cols = byRow.get(rowIndex)!;
    cols.sort((a, b) => colRank(a) - colRank(b));
    const row = playlist[rowIndex]!;
    const plMerged = playlistMergedTags[rowIndex] ?? {};
    lines.push(
      cols.map((colId) => getEdlCellPlainText(colId, row, rowIndex, plMerged)).join("\t")
    );
  }
  return lines.join("\n");
}

/** Vertikaler Split EDL vs. Musikdatenbank (Anteil obere Pane); untere Pane = 1 − Wert. */
const SPLIT_TOP_FRAC_MIN = 0;
const SPLIT_TOP_FRAC_MAX = 1;

/** Anteil der Tabelle innerhalb des Bereichs Tabelle+Player (wie splitTopFrac für EDL vs. DB). */
const MP3_TABLE_TOP_FRAC_MIN = 1 - 0.72;
const MP3_TABLE_TOP_FRAC_MAX = 1 - 0.06;

function yieldFrames(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Datei konnte nicht gelesen werden."));
    reader.readAsText(file, "UTF-8");
  });
}

function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const r = reader.result;
      if (r instanceof ArrayBuffer) resolve(r);
      else reject(new Error("Datei konnte nicht gelesen werden."));
    };
    reader.onerror = () => reject(new Error("Datei konnte nicht gelesen werden."));
    reader.readAsArrayBuffer(file);
  });
}

type ImportOverlayState = { label: string; progress: number };

/** Erstimport (Datei/Menü/Drop) vs. erneutes Öffnen aus dem EDL- & Playlist Browser */
type EdlImportKind = "new" | "fromLibrary";

type DupModalState = DuplicatePrompt & {
  resolve: (c: DuplicateChoice) => void;
};

type TagModalState =
  | { kind: "playlist"; index: number }
  | { kind: "playlistMulti"; indices: number[] }
  | { kind: "file"; fileName: string }
  | { kind: "fileMulti"; fileNames: string[] };

function isMp3FileName(name: string): boolean {
  return basenamePath(name).toLowerCase().endsWith(".mp3");
}

/** Ordnerpfad / Dateiname am letzten Pfadtrenner (Duplikat-Dialog). */
function splitPathForDupModal(raw: string): { dir: string; base: string } {
  const t = raw.trim().replace(/\\/g, "/");
  const i = t.lastIndexOf("/");
  if (i < 0) return { dir: "", base: t };
  return { dir: t.slice(0, i + 1), base: t.slice(i + 1) };
}

function dupModalNorm(s: unknown): string {
  return typeof s === "string" ? s.trim() : "";
}

function initDupModalTagDrafts(info: DuplicatePrompt): {
  proposed: AudioTags;
  candidates: Record<string, AudioTags>;
} {
  const proposed: AudioTags = { ...info.proposedTags };
  for (const k of DUPLICATE_MODAL_DISPLAY_KEYS) {
    const v = proposed[k];
    (proposed as Record<string, string | undefined>)[k] = typeof v === "string" ? v : "";
  }
  const candidates: Record<string, AudioTags> = {};
  for (const c of info.candidates) {
    const t: AudioTags = { ...(info.candidateTagsByPath[c.existingFileName] ?? {}) };
    for (const k of DUPLICATE_MODAL_DISPLAY_KEYS) {
      const v = t[k];
      (t as Record<string, string | undefined>)[k] = typeof v === "string" ? v : "";
    }
    candidates[c.existingFileName] = t;
  }
  return { proposed, candidates };
}

function dupDraftFormToPersistedTags(draft: AudioTags): AudioTags {
  const o: AudioTags = {};
  for (const k of DUPLICATE_MODAL_DISPLAY_KEYS) {
    const v = draft[k];
    if (typeof v === "string" && v.trim()) (o as Record<string, string>)[k] = v.trim();
  }
  return mergeWarnungForDisplay(o);
}

function DupModalTagFields({
  tags,
  onTagsChange,
  diffBaseline,
  fieldIdPrefix,
}: {
  tags: AudioTags;
  onTagsChange: (next: AudioTags) => void;
  /** Wenn gesetzt: Felder hervorheben, die nicht mit dem neuen Datensatz übereinstimmen. */
  diffBaseline?: AudioTags;
  fieldIdPrefix: string;
}) {
  return (
    <div className="modal-dup-tag-form modal-dup-tag-form--row">
      {DUPLICATE_MODAL_DISPLAY_KEYS.map((k) => {
        const val = (typeof tags[k] === "string" ? tags[k] : "") ?? "";
        const diff =
          diffBaseline !== undefined && dupModalNorm(diffBaseline[k]) !== dupModalNorm(val);
        const fid = `${fieldIdPrefix}-${String(k)}`;
        return (
          <div
            key={k}
            className={`modal-dup-tag-field${diff ? " modal-dup-tag-field--diff" : ""}`}
          >
            <label className="modal-dup-tag-form-label" htmlFor={fid}>
              {AUDIO_TAG_FIELD_LABELS[k]}
            </label>
            <input
              id={fid}
              className="modal-dup-tag-form-input"
              type="text"
              value={val}
              autoComplete="off"
              onChange={(e) => onTagsChange({ ...tags, [k]: e.target.value })}
            />
          </div>
        );
      })}
    </div>
  );
}

type TagsCtxMenuState =
  | null
  | {
      x: number;
      y: number;
      kind: "playlist";
      index: number;
      /** Volle Playlist-Indizes (aus der gefilterten Ansicht), die „Aus der Liste löschen“ betrifft */
      removeFromListIndices: number[];
    }
  | { x: number; y: number; kind: "file"; fileName: string; deleteTargets: string[] };

function clampCtxMenuPos(x: number, y: number, menuW: number, menuH: number) {
  const pad = 8;
  const left = Math.min(Math.max(pad, x), window.innerWidth - menuW - pad);
  const top = Math.min(Math.max(pad, y), window.innerHeight - menuH - pad);
  return { left, top };
}

function ColumnFilterTh({
  colIndex,
  attachResize,
  className,
  title,
  label,
  filterValue,
  onFilterChange,
  onClearFilter,
  ariaLabelFilter,
  columnDrag,
  onHideColumn,
  hideColumnDisabled,
  columnSort,
}: {
  colIndex: number;
  attachResize: (colIndex: number) => (e: ReactMouseEvent) => void;
  className?: string;
  title?: string;
  label: ReactNode;
  filterValue: string;
  onFilterChange: (value: string) => void;
  onClearFilter: () => void;
  ariaLabelFilter: string;
  columnDrag?: {
    columnId: string;
    onDragStart: (e: ReactDragEvent) => void;
    onDragOver: (e: ReactDragEvent) => void;
    onDrop: (e: ReactDragEvent) => void;
    onDragEnd: (e: ReactDragEvent) => void;
  };
  onHideColumn?: () => void;
  hideColumnDisabled?: boolean;
  columnSort?: {
    activeDirection: "asc" | "desc" | null;
    onSortAsc: () => void;
    onSortDesc: () => void;
  };
}) {
  const hasFilter = filterValue.trim().length > 0;
  return (
    <th
      className={`table-th-resizable table-th-with-filter${className ? ` ${className}` : ""}${
        columnDrag ? " table-th-col-dnd" : ""
      }`}
      scope="col"
      title={title}
      onDragOver={
        columnDrag
          ? (e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              columnDrag.onDragOver(e);
            }
          : undefined
      }
      onDrop={columnDrag?.onDrop}
    >
      <div className="table-th-filter-stack">
      <div className="table-th-head-row">
        {columnDrag && (
          <span
            className="table-th-col-drag-handle"
            draggable
            onDragStart={columnDrag.onDragStart}
            onDragEnd={columnDrag.onDragEnd}
            title="Ziehen zum Umsortieren"
            aria-hidden
          >
            ⠿
          </span>
        )}
        <span className="table-th-text">{label}</span>
        {columnSort && (
          <span className="table-th-sort-btns" role="group" aria-label="Sortierung">
            <button
              type="button"
              className={`table-th-sort-btn${
                columnSort.activeDirection === "asc" ? " table-th-sort-btn--active" : ""
              }`}
              title="Aufsteigend (A–Z)"
              aria-label="Aufsteigend sortieren"
              onClick={(e) => {
                e.stopPropagation();
                columnSort.onSortAsc();
              }}
            >
              ▲
            </button>
            <button
              type="button"
              className={`table-th-sort-btn${
                columnSort.activeDirection === "desc" ? " table-th-sort-btn--active" : ""
              }`}
              title="Absteigend (Z–A)"
              aria-label="Absteigend sortieren"
              onClick={(e) => {
                e.stopPropagation();
                columnSort.onSortDesc();
              }}
            >
              ▼
            </button>
          </span>
        )}
        {onHideColumn && (
          <button
            type="button"
            className="table-th-col-hide"
            disabled={hideColumnDisabled}
            title={hideColumnDisabled ? "Mindestens eine Spalte muss sichtbar bleiben." : "Spalte ausblenden"}
            aria-label={`Spalte ${typeof label === "string" ? label : ""} ausblenden`}
            onClick={(e) => {
              e.stopPropagation();
              onHideColumn();
            }}
          >
            −
          </button>
        )}
        {hasFilter && (
          <button
            type="button"
            className="table-filter-clear-col"
            onClick={(e) => {
              e.stopPropagation();
              onClearFilter();
            }}
            aria-label="Filter dieser Spalte löschen"
            title="Filter löschen"
          >
            ×
          </button>
        )}
      </div>
      <input
        type="search"
        className="table-col-filter-input"
        value={filterValue}
        onChange={(e) => onFilterChange(e.target.value)}
        placeholder="Filter…"
        aria-label={ariaLabelFilter}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      />
      </div>
      <span
        className="table-col-resize-handle"
        onMouseDown={attachResize(colIndex)}
        role="separator"
        aria-orientation="vertical"
        aria-label="Spaltenbreite anpassen"
      />
    </th>
  );
}

export default function App() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const restoreBackupInputRef = useRef<HTMLInputElement>(null);
  const xlsInputRef = useRef<HTMLInputElement>(null);
  const [playlist, setPlaylist] = useState<PlaylistEntry[] | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [edlRawText, setEdlRawText] = useState<string | null>(null);
  const [edlTitle, setEdlTitle] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [musicDbFileNames, setMusicDbFileNames] = useState<string[]>([]);
  const [musicDbMetadata, setMusicDbMetadata] = useState<Record<string, MusicDbFileMeta>>({});
  const [highlightMp3Name, setHighlightMp3Name] = useState<string | null>(null);
  const mp3RowRefs = useRef<Map<string, HTMLTableRowElement>>(new Map());
  const [drag, setDrag] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [dupModal, setDupModal] = useState<DupModalState | null>(null);
  const [dupTagDraftProposed, setDupTagDraftProposed] = useState<AudioTags>({});
  const [dupTagDraftCandidates, setDupTagDraftCandidates] = useState<Record<string, AudioTags>>({});
  /** Testumgebung: nach erstem Dialog dieselbe Entscheidung für alle weiteren Konflikte (Pfad jeweils = erster Treffer). */
  const dupApplyAllRef = useRef<"identical" | "different" | null>(null);
  const [dupApplyAllChecked, setDupApplyAllChecked] = useState(false);
  /** Rückfrage vor erneutem Transfer, wenn bereits eine `.list`/`.egpl` aktiv ist. */
  const [transferListConfirmOpen, setTransferListConfirmOpen] = useState(false);
  /** Relativpfade unter dem Speicherort — Bestätigung vor Löschen der MP3-Dateien */
  const [mp3DeleteConfirmTargets, setMp3DeleteConfirmTargets] = useState<string[] | null>(null);
  /** Playlist-Zeilen-Indizes — Bestätigung vor „Aus der Liste entfernen“ */
  const [playlistRemoveConfirmIndices, setPlaylistRemoveConfirmIndices] = useState<number[] | null>(null);
  /** Pfade ohne Datei am Speicherort — Bestätigung vor Bereinigen der Musikdatenbank */
  const [musicDbOrphanConfirmPaths, setMusicDbOrphanConfirmPaths] = useState<string[] | null>(null);
  const [musicDbCleanupBusy, setMusicDbCleanupBusy] = useState(false);
  /** Relativpfade ohne Datei am Speicherort — gelb in der Musikdatenbank-Tabelle (Button „Fehlende markieren“). */
  const [musicDbMissingHighlightList, setMusicDbMissingHighlightList] = useState<string[]>([]);
  const [mp3RecreateBusy, setMp3RecreateBusy] = useState(false);
  /** Bestätigung, wenn Einträge nur einen Dateinamen ohne Unterordner haben (Ziel = Speicherort-Stamm). */
  const [mp3RecreateBasenameConfirmPaths, setMp3RecreateBasenameConfirmPaths] = useState<
    string[] | null
  >(null);
  const [mp3DbToolsMenuOpen, setMp3DbToolsMenuOpen] = useState(false);
  const mp3DbToolsMenuRef = useRef<HTMLDivElement>(null);
  const dupApplyAllCheckedRef = useRef(false);
  dupApplyAllCheckedRef.current = dupApplyAllChecked;
  const [tagStore, setTagStore] = useState<TagStore>(() => ({}));
  const tagStoreRef = useRef<TagStore>({} as TagStore);
  tagStoreRef.current = tagStore;
  /** GVL-Abgleich: zeilenweise Vorher/Nachher oder nur Hinweis bei fehlenden Labelcodes. */
  const [gvlSyncModalOpen, setGvlSyncModalOpen] = useState(false);
  const [gvlSyncModalPhase, setGvlSyncModalPhase] = useState<"queue" | "missing" | "missingOnly">("queue");
  /** Zeilenweiser GVL-Abgleich: null wenn kein Wizard aktiv. */
  const [gvlSyncWizard, setGvlSyncWizard] = useState<{
    items: GvlSyncUpdateItem[];
    index: number;
  } | null>(null);
  const gvlSyncWizardRef = useRef(gvlSyncWizard);
  gvlSyncWizardRef.current = gvlSyncWizard;
  const gvlSyncPendingMissingRef = useRef<GvlPlaylistSyncRowMissing[]>([]);
  const [gvlSyncReportText, setGvlSyncReportText] = useState("");
  const pendingPostGvlSyncRef = useRef<{
    runExport: boolean;
    exportOptions?: { onlyOffline?: boolean };
  } | null>(null);
  const [gvlLabelDb, setGvlLabelDb] = useState<GvlLabelDb | null>(() => loadGvlLabelDb());
  const [tagModal, setTagModal] = useState<TagModalState | null>(null);
  const [systemSettingsOpen, setSystemSettingsOpen] = useState(false);
  const [gvlApplyToTag, setGvlApplyToTag] = useState<GvlApplyFromDbPayload | null>(null);
  const [tagEditInitial, setTagEditInitial] = useState<AudioTags>({});
  /** ID3/Merged werden vor dem Öffnen des Tag-Dialogs geladen. */
  const [tagModalLoadBusy, setTagModalLoadBusy] = useState(false);
  const [tagsCtxMenu, setTagsCtxMenu] = useState<TagsCtxMenuState>(null);
  /** Anteil der oberen Pane (EDL- & Playlist) an der Split-Höhe (Musikdatenbank = Rest). */
  const [splitTopFrac, setSplitTopFrac] = useState(0.5);
  const splitPanesRef = useRef<HTMLDivElement>(null);
  const splitDragRef = useRef<{ y: number; frac: number } | null>(null);
  /** Horizontal: EDL- & Playlist vs. EDL- & Playlist Browser (Anteil links), 0.22–0.82 */
  const [splitPlaylistVsLibrary, setSplitPlaylistVsLibrary] = useState(0.52);
  /** EDL- & Playlist Browser-Spalte komplett ausblenden (mehr Platz für EDL- & Playlist). */
  const [edlAblageCollapsed, setEdlAblageCollapsed] = useState(false);
  const edlSplitRowRef = useRef<HTMLDivElement>(null);
  const splitHDragRef = useRef<{ x: number; frac: number } | null>(null);
  const [windowInnerHeight, setWindowInnerHeight] = useState(() =>
    typeof window !== "undefined" ? window.innerHeight : 800
  );
  const [fontScale, setFontScale] = useState(() => loadFontScale());
  const [theme, setTheme] = useState<AppTheme>(() => loadTheme());
  /** Entspricht `calc(100vh - 9.5rem)` wie bisher — Basis für EDL-/MP3-Höhen ohne Zusatz. */
  const splitBaseHeightPx = useMemo(() => {
    const rem =
      typeof document !== "undefined"
        ? parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
        : 16;
    return Math.max(240, windowInnerHeight - 9.5 * rem);
  }, [windowInnerHeight, fontScale]);
  /** Standard: etwas weniger Tabelle, mehr Platz für Player/Timeline (alle drei Spuren sichtbar). */
  const [mp3TableTopFrac, setMp3TableTopFrac] = useState(0.52);
  const mp3TablePlayerSplitRef = useRef<HTMLDivElement>(null);
  const mp3TablePlayerDragRef = useRef<{ y: number; frac: number } | null>(null);
  /** Sichtbarkeit Tabelle vs. Mediaplayer innerhalb der Musikdatenbank-Sektion (Hamburger-Menü). */
  const [mp3DbTableVisible, setMp3DbTableVisible] = useState(true);
  const [mp3DbPlayerVisible, setMp3DbPlayerVisible] = useState(true);
  const [storagePathsOpen, setStoragePathsOpen] = useState(false);
  const [backupDownloadBusy, setBackupDownloadBusy] = useState(false);
  const [restoreBackupBusy, setRestoreBackupBusy] = useState(false);
  const [edlLibraryRefresh, setEdlLibraryRefresh] = useState(0);
  /** `null` = Import/EDL-Speichern in die EDL-Wurzel; sonst Unterordner-Pfad. */
  const [edlImportTargetSegments, setEdlImportTargetSegments] = useState<string[] | null>(null);
  const [importOverlay, setImportOverlay] = useState<ImportOverlayState | null>(null);
  const edlLayoutInitRef = useRef<ReturnType<typeof loadEdlTableLayout> | null>(null);
  if (edlLayoutInitRef.current === null) edlLayoutInitRef.current = initialEdlTableLayoutState();
  const [edlColumnOrder, setEdlColumnOrder] = useState<EdlTableColumnId[]>(
    () => edlLayoutInitRef.current!.order
  );
  const [edlColumnHidden, setEdlColumnHidden] = useState<Set<EdlTableColumnId>>(
    () => new Set(edlLayoutInitRef.current!.hidden)
  );
  const [edlColWidthsById, setEdlColWidthsById] = useState<Record<EdlTableColumnId, number>>(
    () => edlLayoutInitRef.current!.widths
  );
  const mp3LayoutInitRef = useRef<ReturnType<typeof loadMp3TableLayout> | null>(null);
  if (mp3LayoutInitRef.current === null) mp3LayoutInitRef.current = initialMp3TableLayoutState();
  const [mp3ColumnOrder, setMp3ColumnOrder] = useState<Mp3TableColumnId[]>(
    () => mp3LayoutInitRef.current!.order
  );
  const [mp3ColumnHidden, setMp3ColumnHidden] = useState<Set<Mp3TableColumnId>>(
    () => new Set(mp3LayoutInitRef.current!.hidden)
  );
  const [mp3ColWidthsById, setMp3ColWidthsById] = useState<Record<Mp3TableColumnId, number>>(
    () => mp3LayoutInitRef.current!.widths
  );
  const edlColWidthsRef = useRef<number[]>([]);
  const mp3ColWidthsRef = useRef<number[]>([]);
  const edlColGroupRef = useRef<HTMLTableColElement | null>(null);
  const mp3ColGroupRef = useRef<HTMLTableColElement | null>(null);
  const [edlFilters, setEdlFilters] = useState<Record<EdlTableColumnId, string>>(emptyEdlFiltersRecord);
  const [mp3Filters, setMp3Filters] = useState<Record<Mp3TableColumnId, string>>(emptyMp3FiltersRecord);
  const [mp3Sort, setMp3Sort] = useState<{
    columnId: Mp3TableColumnId;
    direction: SortDirection;
  } | null>(null);
  const [edlSort, setEdlSort] = useState<{
    columnId: EdlTableColumnId;
    direction: SortDirection;
  } | null>(null);
  /** Mehrfachauswahl EDL-Liste: Zeilenindizes in `playlist` (0-basiert). */
  const [edlSelectedRowIndices, setEdlSelectedRowIndices] = useState<Set<number>>(() => new Set());
  /** Anker für Shift-Bereich: Zeilenindex in `playlist` (wie bei Auswahl). */
  const [edlSelectionAnchorPlaylistIndex, setEdlSelectionAnchorPlaylistIndex] = useState<
    number | null
  >(null);
  /** Monoton steigend: Player springt zum Start-TC des angeklickten Tracks (Programm-Frames). */
  const edlSeekToProgramRequestIdRef = useRef(0);
  const [edlSeekToProgramFramesRequest, setEdlSeekToProgramFramesRequest] = useState<{
    programFrames: number;
    requestId: number;
  } | null>(null);
  /** Mehrfachauswahl Musikdatenbank: Dateinamen. */
  const [mp3SelectedNames, setMp3SelectedNames] = useState<Set<string>>(() => new Set());
  /** Anker für Shift-Bereich: Dateiname. */
  const [mp3SelectionAnchorName, setMp3SelectionAnchorName] = useState<string | null>(null);
  /** Geöffnete Datei aus dem EDL- & Playlist Browser (`.edl`, `.xls`, gespeicherte Playlist `.list` / `.egpl`). */
  const [loadedLibraryFile, setLoadedLibraryFile] = useState<{
    parentSegments: string[];
    fileName: string;
    kind: "edl" | "playlist" | "gemaXls";
  } | null>(null);

  const [appUsers, setAppUsers] = useState<AppUserRecord[]>([]);
  const [sessionUserId, setSessionUserIdState] = useState<string | null>(null);
  const [userManagementOpen, setUserManagementOpen] = useState(false);
  const [customersModalOpen, setCustomersModalOpen] = useState(false);
  /** Vorschau „Kundenansicht“ (Playlist wie XLS-Export, ohne Musikdatenbank) — zunächst nur aus dem Verwaltungsmenü. */
  const [customerModeActive, setCustomerModeActive] = useState(false);
  /** Kundenansicht: markierte Zellen (Strg/Cmd+Klick); Strg/Cmd+C → Zwischenablage. */
  const [customerSelectedCells, setCustomerSelectedCells] = useState<Set<string>>(() => new Set());
  const customerSelectedCellsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    customerSelectedCellsRef.current = customerSelectedCells;
  }, [customerSelectedCells]);
  /** Anker für Shift+Bereich in einer Zeile (letzter normaler Klick ohne Strg). */
  const [customerSelectionAnchorCell, setCustomerSelectionAnchorCell] = useState<{
    rowIndex: number;
    colId: EdlTableColumnId;
  } | null>(null);
  const [playlistMailPayload, setPlaylistMailPayload] = useState<{
    attachmentBase64: string;
    attachmentFileName: string;
    defaultSubject: string;
    defaultBody: string;
    mailAssignment: {
      libraryOwnerUserId: string;
      parentSegments: string[];
      playlistFileName: string;
    } | null;
    initialCustomerId: string;
    customerMissingHint: boolean;
  } | null>(null);
  /** Admin: vor Transfer — Kunde wählen; Ref wird nach erfolgreicher Server-.list an /api/playlist-pending/register gesendet. */
  const [transferCustomerModalOpen, setTransferCustomerModalOpen] = useState(false);
  const transferCustomerIdForPendingRef = useRef<string | null>(null);
  const pendingTransferKindRef = useRef<"full" | "offline" | null>(null);

  const currentUser = useMemo(() => {
    if (!sessionUserId) return null;
    return appUsers.find((u) => u.id === sessionUserId) ?? null;
  }, [appUsers, sessionUserId]);

  const isAdmin = currentUser?.role === "admin";
  const isCustomerUser = currentUser?.role === "customer";
  /** Playlist wie Export + Kunden-UI (Admin-Vorschau oder echtes Kundenkonto). */
  const playlistAsCustomerExport = customerModeActive || isCustomerUser;

  useEffect(() => {
    document.documentElement.style.setProperty("--app-font-scale", String(fontScale));
    saveFontScale(fontScale);
  }, [fontScale]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    saveTheme(theme);
  }, [theme]);

  const bumpFontScale = useCallback((delta: number) => {
    setFontScale((prev) => clampFontScale(prev + delta));
  }, []);

  const onFontScaleDec = useCallback(() => {
    bumpFontScale(-FONT_SCALE_STEP);
  }, [bumpFontScale]);

  const onFontScaleInc = useCallback(() => {
    bumpFontScale(FONT_SCALE_STEP);
  }, [bumpFontScale]);

  const onFontScaleReset = useCallback(() => {
    setFontScale(FONT_SCALE_DEFAULT);
  }, []);

  const fontScaleDecDisabled = fontScale <= FONT_SCALE_MIN;
  const fontScaleIncDisabled = fontScale >= FONT_SCALE_MAX;

  const refreshMusicDbFromServer = useCallback(async () => {
    try {
      const state = await apiSharedMusicDbFetch();
      setMusicDbFileNames(state.paths);
      setMusicDbMetadata(state.metadata);
      return state;
    } catch {
      /* Session / Netzwerk */
      return null;
    }
  }, []);

  const edlLibraryAccess = useMemo(
    () =>
      sessionUserId
        ? isCustomerUser
          ? createCustomerServerEdlLibraryAccess()
          : createServerEdlLibraryAccess()
        : null,
    [sessionUserId, isCustomerUser]
  );

  const sessionUserIdRef = useRef<string | null>(null);
  sessionUserIdRef.current = sessionUserId;

  const persistTagStore = useCallback((store: TagStore) => {
    const id = sessionUserIdRef.current;
    if (id) saveTagStore(store, id);
  }, []);

  useEffect(() => {
    if (sessionUserId && !appUsers.some((u) => u.id === sessionUserId)) {
      setSessionUserIdState(null);
      setUsersApiToken(null);
      setAppUsers([]);
    }
  }, [appUsers, sessionUserId]);

  const onLogout = useCallback(() => {
    setUsersApiToken(null);
    setSessionUserIdState(null);
    setAppUsers([]);
    setUserManagementOpen(false);
    setPlaylist(null);
    setFileName(null);
    setEdlRawText(null);
    setEdlTitle(null);
    setLoadedLibraryFile(null);
    setEdlImportTargetSegments(null);
    setMusicDbFileNames([]);
    setMusicDbMetadata({});
    setTagStore({});
    setError(null);
  }, []);

  const handleAuthLoggedIn = useCallback((user: AppUserRecord, token: string) => {
    setUsersApiToken(token);
    setSessionUserIdState(user.id);
    setAppUsers([user]);
    if (user.role === "admin") {
      void fetchUsersList()
        .then(setAppUsers)
        .catch(() => setAppUsers([user]));
    }
  }, []);

  /** Arbeitsbereich, EDL-Browser und Playlist-Tags sind pro Nutzer; Musikdatenbank bleibt global. */
  useEffect(() => {
    if (!sessionUserId) return;
    let cancelled = false;
    (async () => {
      const w = await loadWorkspace(sessionUserId);
      if (cancelled) return;
      if (w) {
        setPlaylist((prev) => (prev !== null ? prev : w.playlist));
        setFileName((prev) => (prev !== null ? prev : w.fileName));
        setEdlTitle((prev) => (prev !== null ? prev : w.edlTitle));
        setEdlRawText((prev) => {
          if (prev !== null) return prev;
          const sk =
            w.sessionKind ?? (typeof w.edlText === "string" && w.edlText.trim() ? "edl" : "playlistLinked");
          if (sk === "playlistLinked") return null;
          return typeof w.edlText === "string" ? w.edlText : null;
        });
      }

      let tags = loadTagStore(sessionUserId);
      if (Object.keys(tags).length === 0) {
        const fromIdb = await loadTagStoreFromIdb(sessionUserId);
        if (!cancelled && fromIdb && Object.keys(fromIdb).length > 0) {
          tags = fromIdb;
          saveTagStore(fromIdb, sessionUserId);
        }
      }
      if (!cancelled) setTagStore(tags);
      if (!cancelled && w?.playlist?.length && !isCustomerUser) {
        const state = await refreshMusicDbFromServer();
        if (cancelled) return;
        const paths = state?.paths ?? [];
        const db = loadGvlLabelDb();
        if (db?.entries?.length) {
          const { updates, missingInGvl } = enumerateGvlPlaylistSyncItems({
            playlist: w.playlist,
            tagStore: tags,
            musicDbFileNames: paths,
            gvlDb: db,
          });
          if (updates.length === 0 && missingInGvl.length === 0) return;
          queueMicrotask(() => {
            pendingPostGvlSyncRef.current = { runExport: false };
            if (updates.length > 0) {
              gvlSyncPendingMissingRef.current = missingInGvl;
              setGvlSyncWizard({ items: updates, index: 0 });
              setGvlSyncModalPhase("queue");
              setGvlSyncModalOpen(true);
            } else {
              setGvlSyncReportText(formatGvlPlaylistSyncMissingReport(missingInGvl));
              setGvlSyncModalPhase("missingOnly");
              setGvlSyncModalOpen(true);
            }
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionUserId, refreshMusicDbFromServer, isCustomerUser]);

  useEffect(() => {
    setEdlSelectedRowIndices(new Set());
    setEdlSelectionAnchorPlaylistIndex(null);
  }, [fileName]);

  useEffect(() => {
    if (!sessionUserId) {
      setMusicDbFileNames([]);
      setMusicDbMetadata({});
      return;
    }
    if (isCustomerUser) {
      setMusicDbFileNames([]);
      setMusicDbMetadata({});
      return;
    }
    let cancelled = false;
    void (async () => {
      const legacy = loadMusicDatabaseFileNames();
      try {
        if (legacy.length > 0) {
          const merged = await apiSharedMusicDbRegister(legacy);
          if (!cancelled) {
            setMusicDbFileNames(merged.paths);
            setMusicDbMetadata(merged.metadata);
            saveMusicDatabaseFileNames([]);
          }
        } else {
          const state = await apiSharedMusicDbFetch();
          if (!cancelled) {
            setMusicDbFileNames(state.paths);
            setMusicDbMetadata(state.metadata);
          }
        }
      } catch {
        if (!cancelled) {
          setMusicDbFileNames(legacy.length > 0 ? legacy : []);
          setMusicDbMetadata({});
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionUserId, isCustomerUser]);

  useEffect(() => {
    const onResize = () => setWindowInnerHeight(window.innerHeight);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (sessionUserId) {
        try {
          const serverDb = await apiSharedGvlLabelDbFetch();
          if (cancelled) return;
          if (serverDb && serverDb.entries.length > 0) {
            setGvlLabelDb(serverDb);
            saveGvlLabelDb(serverDb);
            return;
          }
        } catch {
          /* Offline oder API nicht erreichbar: lokalen Cache behalten */
        }
      }
      if (loadGvlLabelDb()) return;
      const fromIdb = await loadGvlLabelDbFromIdb();
      if (cancelled || !fromIdb) return;
      setGvlLabelDb(fromIdb);
      saveGvlLabelDb(fromIdb);
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionUserId]);

  /** Erhöht die Chance, dass IndexedDB/Handles nicht so aggressiv verworfen werden (Browser-abhängig). */
  useEffect(() => {
    if (typeof navigator !== "undefined" && navigator.storage?.persist) {
      void navigator.storage.persist().catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (!sessionUserId) return;
    if (playlist == null || !fileName) return;
    const sessionKind =
      edlRawText === null || edlRawText === "" ? "playlistLinked" : "edl";
    void saveWorkspace(
      {
        v: 1,
        fileName,
        edlTitle,
        edlText: edlRawText ?? "",
        playlist,
        sessionKind,
      },
      sessionUserId
    );
  }, [playlist, fileName, edlTitle, edlRawText, sessionUserId]);

  const runEdlImport = useCallback(
    async (
      text: string,
      name: string,
      kind: EdlImportKind = "new",
      /** Ordner der geöffneten Datei (nur bei kind === "fromLibrary"); sonst würde fälschlich der Import-Zielordner beschrieben. */
      openFromLibraryParentSegments?: string[]
    ): Promise<boolean> => {
      setError(null);
      const openingLabel =
        kind === "fromLibrary" ? "EDL wird aufgerufen …" : "EDL wird analysiert …";
      setImportOverlay({ label: openingLabel, progress: 22 });
      await yieldFrames();
      const titleLine = text.match(/^TITLE:\s*(.+)$/im);
      setEdlTitle(titleLine?.[1]?.trim() ?? null);
      try {
        const events = parseEdl(text);
        setImportOverlay({ label: "Schnitte werden zusammengefasst …", progress: 44 });
        await yieldFrames();
        const merged = eventsToMergedPlaylist(events);
        setPlaylist(merged);
        setFileName(name);
        setEdlRawText(text);
        setImportOverlay({ label: "Speichere im EDL- & Playlist Browser …", progress: 72 });
        await yieldFrames();
        if (edlLibraryAccess) {
          try {
            const pathSegments =
              kind === "fromLibrary" && openFromLibraryParentSegments !== undefined
                ? openFromLibraryParentSegments
                : edlImportTargetSegments ?? [];
            await edlLibraryAccess.writeText(pathSegments, name, text);
            setEdlLibraryRefresh((k) => k + 1);
            setLoadedLibraryFile({
              parentSegments: pathSegments,
              fileName: name,
              kind: "edl",
            });
          } catch {
            /* Speichern im EDL- & Playlist Browser ist optional */
          }
        }
        setImportOverlay({ label: "Fertig", progress: 100 });
        await new Promise((r) => setTimeout(r, 220));
        setImportOverlay(null);
        return true;
      } catch (e) {
        setPlaylist(null);
        setFileName(null);
        setEdlRawText(null);
        setEdlTitle(null);
        setError(e instanceof Error ? e.message : "EDL konnte nicht gelesen werden.");
        setImportOverlay(null);
        return false;
      }
    },
    [edlLibraryAccess, edlImportTargetSegments]
  );

  const runPlaylistLibraryLoad = useCallback(
    async (text: string, name: string): Promise<boolean> => {
      setError(null);
      setImportOverlay({ label: "Playlist wird geladen …", progress: 30 });
      await yieldFrames();
      try {
        const parsed = parsePlaylistLibraryFile(text);
        setEdlTitle(parsed.displayTitle);
        setPlaylist(parsed.playlist);
        setFileName(name);
        setEdlRawText(null);
        if (parsed.tagsByRowId && Object.keys(parsed.tagsByRowId).length > 0) {
          setTagStore((prev) => {
            const next = { ...prev };
            for (const [rowId, tags] of Object.entries(parsed.tagsByRowId!)) {
              next[playlistTagKey(rowId)] = tags;
            }
            persistTagStore(next);
            return next;
          });
        }
        setImportOverlay({ label: "Fertig", progress: 100 });
        await new Promise((r) => setTimeout(r, 220));
        setImportOverlay(null);
        if (sessionUserId) {
          const state = await refreshMusicDbFromServer();
          const paths = state?.paths ?? [];
          const db = gvlLabelDb ?? loadGvlLabelDb();
          if (db?.entries?.length && parsed.playlist.length > 0) {
            setTagStore((prev) => {
              const { updates, missingInGvl } = enumerateGvlPlaylistSyncItems({
                playlist: parsed.playlist,
                tagStore: prev,
                musicDbFileNames: paths,
                gvlDb: db,
              });
              if (updates.length === 0 && missingInGvl.length === 0) return prev;
              queueMicrotask(() => {
                pendingPostGvlSyncRef.current = { runExport: false };
                if (updates.length > 0) {
                  gvlSyncPendingMissingRef.current = missingInGvl;
                  setGvlSyncWizard({ items: updates, index: 0 });
                  setGvlSyncModalPhase("queue");
                  setGvlSyncModalOpen(true);
                } else {
                  setGvlSyncReportText(formatGvlPlaylistSyncMissingReport(missingInGvl));
                  setGvlSyncModalPhase("missingOnly");
                  setGvlSyncModalOpen(true);
                }
              });
              return prev;
            });
          }
        }
        return true;
      } catch (e) {
        setPlaylist(null);
        setFileName(null);
        setEdlRawText(null);
        setEdlTitle(null);
        setError(e instanceof Error ? e.message : "Playlist konnte nicht gelesen werden.");
        setImportOverlay(null);
        return false;
      }
    },
    [sessionUserId, refreshMusicDbFromServer, gvlLabelDb]
  );

  const runGemaXlsImport = useCallback(
    async (
      buffer: ArrayBuffer,
      name: string,
      kind: EdlImportKind = "new",
      openFromLibraryParentSegments?: string[]
    ): Promise<boolean> => {
      setError(null);
      setImportOverlay({ label: "GEMA-Liste wird gelesen …", progress: 28 });
      await yieldFrames();
      try {
        const { playlist, tagEntries } = parseGemaXls(buffer);
        setImportOverlay({ label: "Tags und Playlist werden gesetzt …", progress: 55 });
        await yieldFrames();
        const stem = stripExtension(name);
        setEdlTitle(stem.trim() ? stem : null);
        setPlaylist(playlist);
        setFileName(name);
        setEdlRawText(null);
        setTagStore((prev) => {
          const next = { ...prev };
          for (const { id, tags } of tagEntries) {
            next[playlistTagKey(id)] = tags;
          }
          persistTagStore(next);
          return next;
        });
        setImportOverlay({ label: "Speichere im EDL- & Playlist Browser …", progress: 78 });
        await yieldFrames();
        if (edlLibraryAccess) {
          try {
            const pathSegments =
              kind === "fromLibrary" && openFromLibraryParentSegments !== undefined
                ? openFromLibraryParentSegments
                : edlImportTargetSegments ?? [];
            await edlLibraryAccess.writeBinary(pathSegments, name, buffer);
            setEdlLibraryRefresh((k) => k + 1);
            setLoadedLibraryFile({
              parentSegments: pathSegments,
              fileName: name,
              kind: "gemaXls",
            });
          } catch {
            /* Speichern im EDL- & Playlist Browser ist optional */
          }
        }
        setImportOverlay({ label: "Fertig", progress: 100 });
        await new Promise((r) => setTimeout(r, 220));
        setImportOverlay(null);
        return true;
      } catch (e) {
        setPlaylist(null);
        setFileName(null);
        setEdlRawText(null);
        setEdlTitle(null);
        setError(e instanceof Error ? e.message : "GEMA-XLS konnte nicht gelesen werden.");
        setImportOverlay(null);
        return false;
      }
    },
    [edlLibraryAccess, edlImportTargetSegments, persistTagStore]
  );

  const onFile = useCallback(
    async (file: File) => {
      if (importOverlay) return;
      setLoadedLibraryFile(null);
      try {
        if (isGemaXlsFileName(file.name)) {
          const buf = await readFileAsArrayBuffer(file);
          await runGemaXlsImport(buf, file.name);
          return;
        }
        const text = await readFileAsText(file);
        if (isPlaylistLibraryFileName(file.name)) {
          await runPlaylistLibraryLoad(text, file.name);
        } else {
          await runEdlImport(text, file.name);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Datei konnte nicht gelesen werden.");
        setImportOverlay(null);
      }
    },
    [runEdlImport, runPlaylistLibraryLoad, runGemaXlsImport, importOverlay]
  );

  const clearEdlWorkspace = useCallback(async () => {
    const uid = sessionUserIdRef.current;
    setPlaylist(null);
    setFileName(null);
    setEdlRawText(null);
    setEdlTitle(null);
    setLoadedLibraryFile(null);
    setError(null);
    if (uid) await clearWorkspace(uid);
  }, []);

  const deleteWouldClearOpenEdl = useCallback(
    (info: LibraryDeleteInfo): boolean => {
      if (info.kind === "file") {
        if (loadedLibraryFile) {
          const { parentSegments: p, fileName: fn } = loadedLibraryFile;
          return (
            JSON.stringify(info.parentSegments) === JSON.stringify(p) &&
            sameLibraryPlaylistDocumentName(fn, info.fileName)
          );
        }
        return (
          fileName !== null && sameLibraryPlaylistDocumentName(info.fileName, fileName)
        );
      }
      if (!loadedLibraryFile) return false;
      const { parentSegments: p } = loadedLibraryFile;
      const d = info.pathSegments;
      return d.length <= p.length && d.every((s, i) => s === p[i]);
    },
    [loadedLibraryFile, fileName]
  );

  const onLibraryEntryDeleted = useCallback(
    (info: LibraryDeleteInfo) => {
      if (info.kind === "directory") {
        const d = info.pathSegments;
        setEdlImportTargetSegments((prev) => {
          if (prev === null) return null;
          if (d.length <= prev.length && d.every((s, i) => s === prev[i])) return null;
          return prev;
        });
      }
      if (info.kind === "file") {
        const matchesLibraryOpen =
          loadedLibraryFile !== null &&
          JSON.stringify(info.parentSegments) ===
            JSON.stringify(loadedLibraryFile.parentSegments) &&
          sameLibraryPlaylistDocumentName(info.fileName, loadedLibraryFile.fileName);
        const matchesDisplayedName =
          loadedLibraryFile === null &&
          fileName !== null &&
          sameLibraryPlaylistDocumentName(info.fileName, fileName);
        if (matchesLibraryOpen || matchesDisplayedName) {
          void clearEdlWorkspace();
        }
        return;
      }
      if (!loadedLibraryFile) return;
      const { parentSegments: p } = loadedLibraryFile;
      const d = info.pathSegments;
      if (d.length <= p.length && d.every((s, i) => s === p[i])) {
        void clearEdlWorkspace();
      }
    },
    [loadedLibraryFile, fileName, clearEdlWorkspace]
  );

  const onInputChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      if (f) void onFile(f);
      e.target.value = "";
    },
    [onFile]
  );

  const onXlsInputChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      if (f) {
        void (async () => {
          if (importOverlay) return;
          setLoadedLibraryFile(null);
          try {
            const buf = await readFileAsArrayBuffer(f);
            await runGemaXlsImport(buf, f.name);
          } catch (err) {
            setError(err instanceof Error ? err.message : "Datei konnte nicht gelesen werden.");
            setImportOverlay(null);
          }
        })();
      }
      e.target.value = "";
    },
    [runGemaXlsImport, importOverlay]
  );

  const remapEdlPathsAfterFolderRelocate = useCallback((oldPath: string[], newPath: string[]) => {
    setEdlImportTargetSegments((prev) => {
      if (prev === null) return null;
      return replaceFolderPathPrefix(prev, oldPath, newPath);
    });
    setLoadedLibraryFile((lf) => {
      if (!lf) return null;
      const next = replaceFolderPathPrefix(lf.parentSegments, oldPath, newPath);
      if (
        next.length === lf.parentSegments.length &&
        next.every((s, i) => s === lf.parentSegments[i])
      ) {
        return lf;
      }
      return { ...lf, parentSegments: next };
    });
  }, []);

  const onEdlFolderRenamed = useCallback(
    (parentSegments: string[], oldFolderName: string, newFolderName: string) => {
      remapEdlPathsAfterFolderRelocate(
        [...parentSegments, oldFolderName],
        [...parentSegments, newFolderName]
      );
    },
    [remapEdlPathsAfterFolderRelocate]
  );

  const onEdlFolderMoved = useCallback(
    (fromParentSegments: string[], folderName: string, toParentSegments: string[]) => {
      remapEdlPathsAfterFolderRelocate(
        [...fromParentSegments, folderName],
        [...toParentSegments, folderName]
      );
    },
    [remapEdlPathsAfterFolderRelocate]
  );

  const askDuplicate = useCallback((info: DuplicatePrompt) => {
    const preset = dupApplyAllRef.current;
    if (preset !== null && info.candidates.length > 0) {
      const proposed = mergeWarnungForDisplay({ ...info.proposedTags });
      if (preset === "identical") {
        const exPath = info.candidates[0].existingFileName;
        return Promise.resolve({
          action: "identical" as const,
          existingFileName: exPath,
          proposedTagsEdited: proposed,
          existingFileTagsEdited: mergeWarnungForDisplay({
            ...(info.candidateTagsByPath[exPath] ?? {}),
          }),
        });
      }
      return Promise.resolve({ action: "different" as const, proposedTagsEdited: proposed });
    }
    return new Promise<DuplicateChoice>((resolve) => {
      setDupModal({ ...info, resolve });
    });
  }, []);

  useEffect(() => {
    if (dupModal) setDupApplyAllChecked(false);
  }, [dupModal]);

  useLayoutEffect(() => {
    if (!dupModal) return;
    const { proposed, candidates } = initDupModalTagDrafts(dupModal);
    setDupTagDraftProposed(proposed);
    setDupTagDraftCandidates(candidates);
  }, [dupModal]);

  useEffect(() => {
    if (!mp3DbToolsMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (mp3DbToolsMenuRef.current?.contains(e.target as Node)) return;
      setMp3DbToolsMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMp3DbToolsMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [mp3DbToolsMenuOpen]);

  const resolveDuplicate = useCallback((choice: DuplicateChoice) => {
    if (dupApplyAllCheckedRef.current) {
      dupApplyAllRef.current = choice.action === "identical" ? "identical" : "different";
    }
    setDupModal((m) => {
      if (m) m.resolve(choice);
      return null;
    });
  }, []);

  const openPlaylistTags = useCallback(
    (index: number) => {
      if (!playlist) return;
      setTagModalLoadBusy(true);
      void (async () => {
        try {
          const row = playlist[index];
          const base = defaultTagsFromPlaylistTitle(row.linkedTrackFileName ?? row.title);
          let id3: AudioTags = {};
          const linked = row.linkedTrackFileName;
          if (sessionUserId && linked && isMp3FileName(linked)) {
            try {
              const buf = await apiSharedTracksReadBinary(linked);
              const file = new File([buf], basenamePath(linked), { type: "audio/mpeg" });
              id3 = await readAudioTagsFromBlob(file);
            } catch {
              /* Datei fehlt oder kein Lesen */
            }
          }
          const merged = mergeWarnungForDisplay(
            mergeAudioTags(mergeAudioTags(base, playlistRowTagOverlay(row, tagStore)), id3)
          );
          setTagEditInitial(merged);
          setTagModal({ kind: "playlist", index });
        } finally {
          setTagModalLoadBusy(false);
        }
      })();
    },
    [playlist, tagStore, sessionUserId]
  );

  /** In der Playlist: genau eine Zeile ausgewählt → T öffnet „Tags bearbeiten“. */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key !== "t" && e.key !== "T") return;
      const ae = document.activeElement;
      if (
        ae instanceof HTMLInputElement ||
        ae instanceof HTMLTextAreaElement ||
        ae instanceof HTMLSelectElement ||
        (ae instanceof HTMLElement && ae.isContentEditable)
      )
        return;
      if (tagModal || tagModalLoadBusy) return;
      if (playlistAsCustomerExport) return;
      if (!playlist?.length) return;
      if (edlSelectedRowIndices.size !== 1) return;
      const idx = edlSelectedRowIndices.values().next().value;
      if (typeof idx !== "number") return;
      e.preventDefault();
      openPlaylistTags(idx);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [
    tagModal,
    tagModalLoadBusy,
    playlistAsCustomerExport,
    playlist,
    edlSelectedRowIndices,
    openPlaylistTags,
  ]);

  const openPlaylistTagsMulti = useCallback((indices: number[]) => {
    if (indices.length < 2) return;
    setTagEditInitial({});
    setTagModal({ kind: "playlistMulti", indices: [...indices].sort((a, b) => a - b) });
  }, []);

  const openFileTags = useCallback(
    (fileName: string) => {
      setTagModalLoadBusy(true);
      void (async () => {
        try {
          const base = defaultTagsFromPlaylistTitle(fileName);
          const row = playlist?.find((r) => r.linkedTrackFileName === fileName);
          const overlay = row
            ? playlistRowTagOverlay(row, tagStore)
            : tagStore[fileTagKey(fileName)] ?? {};
          let id3: AudioTags = {};
          if (sessionUserId && isMp3FileName(fileName)) {
            try {
              const buf = await apiSharedTracksReadBinary(fileName);
              const file = new File([buf], basenamePath(fileName), { type: "audio/mpeg" });
              id3 = await readAudioTagsFromBlob(file);
            } catch {
              /* Datei fehlt oder kein Lesen */
            }
          }
          const merged = mergeWarnungForDisplay(
            mergeAudioTags(mergeAudioTags(base, overlay), id3)
          );
          setTagEditInitial(merged);
          setTagModal({ kind: "file", fileName });
        } finally {
          setTagModalLoadBusy(false);
        }
      })();
    },
    [playlist, tagStore, sessionUserId]
  );

  const openFileTagsMulti = useCallback((fileNames: string[]) => {
    const uniq = [...new Set(fileNames)];
    if (uniq.length < 2) return;
    setTagEditInitial({});
    setTagModal({ kind: "fileMulti", fileNames: uniq });
  }, []);

  /** Mehrfachauswahl: M öffnet Multi-Tag-Bearbeitung (Playlist oder Musikdatenbank). */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key !== "m" && e.key !== "M") return;
      const ae = document.activeElement;
      if (
        ae instanceof HTMLInputElement ||
        ae instanceof HTMLTextAreaElement ||
        ae instanceof HTMLSelectElement ||
        (ae instanceof HTMLElement && ae.isContentEditable)
      )
        return;
      if (tagModal || tagModalLoadBusy) return;
      if (playlistAsCustomerExport) return;
      if (edlSelectedRowIndices.size >= 2) {
        e.preventDefault();
        openPlaylistTagsMulti([...edlSelectedRowIndices]);
        return;
      }
      if (mp3SelectedNames.size >= 2) {
        e.preventDefault();
        openFileTagsMulti([...mp3SelectedNames]);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [
    tagModal,
    tagModalLoadBusy,
    playlistAsCustomerExport,
    edlSelectedRowIndices,
    mp3SelectedNames,
    openPlaylistTagsMulti,
    openFileTagsMulti,
  ]);

  const closeTagModal = useCallback(() => {
    setTagModal(null);
    setGvlApplyToTag(null);
  }, []);

  const saveTagModal = useCallback(
    async (form: AudioTags, meta?: { multi: true; touchedKeys: readonly string[] }) => {
      setError(null);
      if (!tagModal) {
        setTagModal(null);
        setGvlApplyToTag(null);
        return;
      }

      if (meta?.multi) {
        const touched = new Set(meta.touchedKeys);
        const st = tagStoreRef.current;
        try {
          if (tagModal.kind === "playlistMulti") {
            if (!playlist?.length) {
              setTagModal(null);
              setGvlApplyToTag(null);
              return;
            }
            type PlUp = { key: string; overlay: AudioTags; row: (typeof playlist)[number] };
            const pending: PlUp[] = [];
            for (const idx of tagModal.indices) {
              const row = playlist[idx];
              if (!row) continue;
              const base = defaultTagsFromPlaylistTitle(row.linkedTrackFileName ?? row.title);
              let id3: AudioTags = {};
              const linked = row.linkedTrackFileName;
              if (sessionUserId && linked && isMp3FileName(linked)) {
                try {
                  const buf = await apiSharedTracksReadBinary(linked);
                  const file = new File([buf], basenamePath(linked), { type: "audio/mpeg" });
                  id3 = await readAudioTagsFromBlob(file);
                } catch {
                  /* Datei fehlt */
                }
              }
              const merged = mergeWarnungForDisplay(
                mergeAudioTags(mergeAudioTags(base, playlistRowTagOverlay(row, st)), id3)
              );
              const after = applyMultiEditTagPatch(merged, form, touched);
              const overlay = overlayFromForm(base, after);
              if (sessionUserId && linked && isMp3FileName(linked)) {
                await writeAudioTagsToSharedMp3(
                  apiSharedTracksReadBinary,
                  apiSharedTracksWriteBinary,
                  linked,
                  after
                );
                try {
                  const entry = await apiSharedMusicDbTouchTagEdited(linked);
                  setMusicDbMetadata((prev) => ({ ...prev, [linked]: entry }));
                } catch {
                  /* optional */
                }
              }
              pending.push({ key: playlistEntryTagStoreKey(row), overlay, row });
            }
            setTagStore((prev) => {
              const next = { ...prev };
              for (const p of pending) {
                if (Object.keys(p.overlay).length === 0) delete next[p.key];
                else next[p.key] = p.overlay;
                if (p.row.linkedTrackFileName?.trim()) {
                  delete next[playlistTagKey(p.row.id)];
                }
              }
              persistTagStore(next);
              return next;
            });
          } else if (tagModal.kind === "fileMulti") {
            type FUp = { key: string; overlay: AudioTags; fileName: string };
            const pending: FUp[] = [];
            for (const fileName of tagModal.fileNames) {
              const base = defaultTagsFromPlaylistTitle(fileName);
              const row = playlist?.find((r) => r.linkedTrackFileName === fileName);
              const overlayPrev = row
                ? playlistRowTagOverlay(row, st)
                : st[fileTagKey(fileName)] ?? {};
              let id3: AudioTags = {};
              if (sessionUserId && isMp3FileName(fileName)) {
                try {
                  const buf = await apiSharedTracksReadBinary(fileName);
                  const file = new File([buf], basenamePath(fileName), { type: "audio/mpeg" });
                  id3 = await readAudioTagsFromBlob(file);
                } catch {
                  /* */
                }
              }
              const merged = mergeWarnungForDisplay(
                mergeAudioTags(mergeAudioTags(base, overlayPrev), id3)
              );
              const after = applyMultiEditTagPatch(merged, form, touched);
              const overlay = overlayFromForm(base, after);
              if (sessionUserId && isMp3FileName(fileName)) {
                await writeAudioTagsToSharedMp3(
                  apiSharedTracksReadBinary,
                  apiSharedTracksWriteBinary,
                  fileName,
                  after
                );
                try {
                  const entry = await apiSharedMusicDbTouchTagEdited(fileName);
                  setMusicDbMetadata((prev) => ({ ...prev, [fileName]: entry }));
                } catch {
                  /* */
                }
              }
              pending.push({ key: fileTagKey(fileName), overlay, fileName });
            }
            setTagStore((prev) => {
              const next = { ...prev };
              for (const p of pending) {
                if (Object.keys(p.overlay).length === 0) delete next[p.key];
                else next[p.key] = p.overlay;
                if (playlist) {
                  for (const r of playlist) {
                    if (r.linkedTrackFileName === p.fileName) {
                      delete next[playlistTagKey(r.id)];
                    }
                  }
                }
              }
              persistTagStore(next);
              return next;
            });
          }
        } catch (e) {
          setError(e instanceof Error ? e.message : "Tags konnten nicht gespeichert werden.");
          return;
        }
        setTagModal(null);
        setGvlApplyToTag(null);
        return;
      }

      if (tagModal.kind === "playlist") {
        if (!playlist) {
          setTagModal(null);
          setGvlApplyToTag(null);
          return;
        }
        const row = playlist[tagModal.index];
        const base = defaultTagsFromPlaylistTitle(row.linkedTrackFileName ?? row.title);
        const overlay = overlayFromForm(base, form);
        const key = playlistEntryTagStoreKey(row);
        const linked = row.linkedTrackFileName;
        if (sessionUserId && linked && isMp3FileName(linked)) {
          try {
            await writeAudioTagsToSharedMp3(
              apiSharedTracksReadBinary,
              apiSharedTracksWriteBinary,
              linked,
              form
            );
            try {
              const entry = await apiSharedMusicDbTouchTagEdited(linked);
              setMusicDbMetadata((prev) => ({ ...prev, [linked]: entry }));
            } catch {
              /* Zeitstempel optional */
            }
          } catch (e) {
            setError(
              e instanceof Error
                ? e.message
                : "MP3-Datei konnte nicht mit ID3-Tags beschrieben werden."
            );
            return;
          }
        }
        setTagStore((prev) => {
          const next = { ...prev };
          if (Object.keys(overlay).length === 0) delete next[key];
          else next[key] = overlay;
          if (linked?.trim()) {
            delete next[playlistTagKey(row.id)];
          }
          persistTagStore(next);
          return next;
        });
      } else {
        const base = defaultTagsFromPlaylistTitle(tagModal.fileName);
        const key = fileTagKey(tagModal.fileName);
        const overlay = overlayFromForm(base, form);
        if (sessionUserId && isMp3FileName(tagModal.fileName)) {
          try {
            await writeAudioTagsToSharedMp3(
              apiSharedTracksReadBinary,
              apiSharedTracksWriteBinary,
              tagModal.fileName,
              form
            );
            try {
              const entry = await apiSharedMusicDbTouchTagEdited(tagModal.fileName);
              setMusicDbMetadata((prev) => ({ ...prev, [tagModal.fileName]: entry }));
            } catch {
              /* Zeitstempel optional */
            }
          } catch (e) {
            setError(
              e instanceof Error
                ? e.message
                : "MP3-Datei konnte nicht mit ID3-Tags beschrieben werden."
            );
            return;
          }
        }
        setTagStore((prev) => {
          const next = { ...prev };
          if (Object.keys(overlay).length === 0) delete next[key];
          else next[key] = overlay;
          if (playlist) {
            for (const r of playlist) {
              if (r.linkedTrackFileName === tagModal.fileName) {
                delete next[playlistTagKey(r.id)];
              }
            }
          }
          persistTagStore(next);
          return next;
        });
      }
      setTagModal(null);
      setGvlApplyToTag(null);
    },
    [tagModal, playlist, sessionUserId, persistTagStore]
  );

  const onImportEdl = useCallback(() => {
    if (importOverlay) return;
    fileInputRef.current?.click();
  }, [importOverlay]);

  const onImportGemaXls = useCallback(() => {
    if (importOverlay) return;
    xlsInputRef.current?.click();
  }, [importOverlay]);

  const onOpenSystemSettings = useCallback(() => {
    setSystemSettingsOpen(true);
  }, []);

  const applyGvlRowToOpenTag = useCallback((entry: GvlLabelEntry) => {
    setGvlApplyToTag({ id: Date.now(), entry });
    setSystemSettingsOpen(false);
  }, []);

  const onImportGvlDb = useCallback(
    async (nextDb: GvlLabelDb) => {
      setGvlLabelDb(nextDb);
      saveGvlLabelDb(nextDb);
      if (!sessionUserId || !isAdmin) return;
      try {
        await apiSharedGvlLabelDbSave(nextDb);
      } catch (e) {
        setError(
          e instanceof Error
            ? e.message
            : "GVL-Daten konnten nicht auf dem Server gespeichert werden."
        );
      }
    },
    [sessionUserId, isAdmin]
  );

  const hasOfflinePlaylistRows = useMemo(() => {
    if (!playlist?.length) return false;
    return playlist.some((row) => {
      const linked = row.linkedTrackFileName?.trim();
      if (!linked || !isMp3FileName(linked)) return false;
      return resolveMusicDbPathForBasename(musicDbFileNames, linked) === null;
    });
  }, [playlist, musicDbFileNames]);

  const executeFakeMp3Export = useCallback(
    async (options?: { onlyOffline?: boolean }) => {
      if (!playlist?.length) return;
      if (!sessionUserId) {
        setError("Bitte anmelden, um Fake-MP3s auf dem Server zu speichern.");
        return;
      }
      let onlyIndices: Set<number> | undefined;
      if (options?.onlyOffline) {
        onlyIndices = new Set<number>();
        playlist.forEach((row, i) => {
          const linked = row.linkedTrackFileName?.trim();
          if (!linked || !isMp3FileName(linked)) return;
          if (resolveMusicDbPathForBasename(musicDbFileNames, linked) === null) {
            onlyIndices!.add(i);
          }
        });
        if (onlyIndices.size === 0) {
          setError("Keine weiß markierten Zeilen ohne Eintrag in der Musikdatenbank.");
          return;
        }
      }
      dupApplyAllRef.current = null;
      setExportBusy(true);
      setError(null);
      try {
        const projectFolderName = deriveExportProjectFolderName({
          fileName,
          edlTitle,
          loadedLibraryFileName: loadedLibraryFile?.fileName ?? null,
        });
        const sink = createSharedFakeMp3Sink();
        const {
          updates,
          identicalChoiceIndices,
          duplicateProposedTagsByIndex,
          duplicateIdenticalFileTagsByIndex,
        } = await exportFakeTracksToSharedStorage(
          playlist,
          sink,
          {
            onDuplicate: askDuplicate,
            projectFolderName,
            onlyIndices,
            getTagsForIndex: (index) => {
              const row = playlist[index];
              const base = defaultTagsFromPlaylistTitle(row.linkedTrackFileName ?? row.title);
              return mergeWarnungForDisplay(
                mergeAudioTags(base, playlistRowTagOverlay(row, tagStoreRef.current))
              );
            },
          }
        );
        /** Nur Verknüpfung setzen — Rec-/Programmzeiten und EDL-Metadaten (id, title, sourceKey) unverändert lassen. */
        const mergedPlaylist = playlist.map((row, i) => {
          const u = updates.find((x) => x.index === i);
          if (!u) return row;
          return {
            id: row.id,
            title: row.title,
            track: row.track,
            recIn: row.recIn,
            recOut: row.recOut,
            recInFrames: row.recInFrames,
            recOutFrames: row.recOutFrames,
            sourceKey: row.sourceKey,
            linkedTrackFileName: u.linkedTrackFileName,
          };
        });
        /** Damit Tags nach späterem Wechsel der Playlist (z. B. neues XLS) in der Musikdatenbank bleiben: f:-Overlay wie nach Tag-Editor. */
        const tagSnapshot = tagStoreRef.current;
        const identicalIdxSet = new Set(identicalChoiceIndices);
        const exportPersistToFileKeys: { key: string; overlay: AudioTags; playlistRowId: string }[] = [];
        for (const u of updates) {
          const row = playlist[u.index];
          const rel = u.linkedTrackFileName?.trim();
          if (!row || !rel || !isMp3FileName(rel)) continue;
          const fk = fileTagKey(rel);
          /** Bei „identisch“: keine p:→f:-Migration und kein Löschen der Zeilen-Tags — Anreicherung nur über playlistTagCopiesFromDb. */
          if (identicalIdxSet.has(u.index)) continue;
          const baseFile = defaultTagsFromPlaylistTitle(rel);
          const full = mergeWarnungForDisplay(
            mergeAudioTags(
              defaultTagsFromPlaylistTitle(row.linkedTrackFileName ?? row.title),
              playlistRowTagOverlay(row, tagSnapshot)
            )
          );
          const overlay = overlayFromForm(baseFile, full);
          if (Object.keys(overlay).length === 0) continue;
          exportPersistToFileKeys.push({ key: fk, overlay, playlistRowId: row.id });
        }

        const dupFromModalIndices = new Set(
          duplicateProposedTagsByIndex ? Object.keys(duplicateProposedTagsByIndex).map(Number) : []
        );
        const playlistTagCopiesFromDb: { key: string; overlay: AudioTags }[] = [];
        for (const idx of identicalChoiceIndices) {
          if (dupFromModalIndices.has(idx)) continue;
          const row = mergedPlaylist[idx];
          if (!row) continue;
          const u = updates.find((x) => x.index === idx);
          if (!u) continue;
          const storedName = u.linkedTrackFileName;
          const dbPath = resolveMusicDbPathForBasename(musicDbFileNames, storedName);
          if (!dbPath) continue;
          const fileKeyDb = fileTagKey(dbPath);
          const fileKeyLinked = fileTagKey(storedName);
          const fileOverlay =
            tagStoreRef.current[fileKeyDb] ?? tagStoreRef.current[fileKeyLinked] ?? {};
          if (!hasAnyAudioTagValue(fileOverlay)) continue;
          const fileBase = defaultTagsFromPlaylistTitle(dbPath);
          const fileFull = mergeAudioTags(fileBase, fileOverlay);
          const playlistBase = defaultTagsFromPlaylistTitle(row.linkedTrackFileName ?? row.title);
          /** f:-Schlüssel wie `linkedTrackFileName` der Zeile (kann von dbPath abweichen, gleicher Basename). */
          playlistTagCopiesFromDb.push({
            key: fileKeyLinked,
            overlay: overlayFromForm(playlistBase, fileFull),
          });
        }
        const hasDupModalTags =
          (duplicateProposedTagsByIndex &&
            Object.keys(duplicateProposedTagsByIndex).length > 0) ||
          (duplicateIdenticalFileTagsByIndex &&
            Object.keys(duplicateIdenticalFileTagsByIndex).length > 0);

        if (playlistTagCopiesFromDb.length || exportPersistToFileKeys.length || hasDupModalTags) {
          setTagStore((prev) => {
            const next = { ...prev };
            for (const { key, overlay } of playlistTagCopiesFromDb) {
              next[key] = overlay;
            }
            for (const { key, overlay, playlistRowId } of exportPersistToFileKeys) {
              next[key] = overlay;
              delete next[playlistTagKey(playlistRowId)];
            }
            for (const [idxStr, formTags] of Object.entries(duplicateProposedTagsByIndex ?? {})) {
              const idx = Number(idxStr);
              const row = mergedPlaylist[idx];
              if (!row) continue;
              const playlistBase = defaultTagsFromPlaylistTitle(row.linkedTrackFileName ?? row.title);
              next[playlistTagKey(row.id)] = overlayFromForm(playlistBase, formTags);
            }
            for (const [, ent] of Object.entries(duplicateIdenticalFileTagsByIndex ?? {})) {
              const fk = fileTagKey(ent.relativePath);
              const fileBase = defaultTagsFromPlaylistTitle(ent.relativePath);
              next[fk] = overlayFromForm(fileBase, ent.tags);
            }
            persistTagStore(next);
            return next;
          });
          if (playlistTagCopiesFromDb.length) {
            setInfoMessage(
              playlistTagCopiesFromDb.length === 1
                ? "Tags aus der Musikdatenbank in die Playlist-Zeile übernommen (identischer Track)."
                : `${playlistTagCopiesFromDb.length} Playlist-Zeilen mit Tags aus der Musikdatenbank angereichert (identische Tracks).`
            );
          }
        }
        setPlaylist(mergedPlaylist);
        setEdlRawText(null);
        await refreshMusicDbFromServer();

        if (edlLibraryAccess && loadedLibraryFile) {
          try {
            const dirSegments = loadedLibraryFile.parentSegments;
            const payload = serializePlaylistLibraryFile({
              v: 1,
              displayTitle: edlTitle,
              playlist: mergedPlaylist,
              tracksLinkedAtIso: new Date().toISOString(),
            });
            let listFileForPending: string | null = null;
            if (loadedLibraryFile.kind === "edl") {
              const plName = edlFileNameToPlaylistFileName(loadedLibraryFile.fileName);
              await edlLibraryAccess.writeText(dirSegments, plName, payload);
              await edlLibraryAccess.deleteFile(dirSegments, loadedLibraryFile.fileName);
              listFileForPending = plName;
              setLoadedLibraryFile({
                ...loadedLibraryFile,
                fileName: plName,
                kind: "playlist",
              });
              setFileName(plName);
            } else if (loadedLibraryFile.kind === "gemaXls") {
              const plName = gemaXlsFileNameToPlaylistFileName(loadedLibraryFile.fileName);
              await edlLibraryAccess.writeText(dirSegments, plName, payload);
              await edlLibraryAccess.deleteFile(dirSegments, loadedLibraryFile.fileName);
              listFileForPending = plName;
              setLoadedLibraryFile({
                ...loadedLibraryFile,
                fileName: plName,
                kind: "playlist",
              });
              setFileName(plName);
            } else {
              const fn = loadedLibraryFile.fileName;
              if (fn.toLowerCase().endsWith(LEGACY_PLAYLIST_LIBRARY_FILE_EXT)) {
                const plName = `${fn.slice(0, -LEGACY_PLAYLIST_LIBRARY_FILE_EXT.length)}${PLAYLIST_LIBRARY_FILE_EXT}`;
                await edlLibraryAccess.writeText(dirSegments, plName, payload);
                await edlLibraryAccess.deleteFile(dirSegments, fn);
                listFileForPending = plName;
                setLoadedLibraryFile({
                  ...loadedLibraryFile,
                  fileName: plName,
                  kind: "playlist",
                });
                setFileName(plName);
              } else {
                await edlLibraryAccess.writeText(dirSegments, fn, payload);
                listFileForPending = fn;
              }
            }
            if (listFileForPending && sessionUserId && transferCustomerIdForPendingRef.current) {
              try {
                await registerPlaylistPendingRequest({
                  customerId: transferCustomerIdForPendingRef.current,
                  libraryOwnerUserId: sessionUserId,
                  parentSegments: dirSegments,
                  playlistFileName: listFileForPending,
                });
              } catch (e) {
                setError(
                  e instanceof Error
                    ? e.message
                    : "Kunden-Vormerkung konnte nicht gespeichert werden (Transfer ist gespeichert)."
                );
              }
            }
            setEdlLibraryRefresh((k) => k + 1);
          } catch {
            setError(
              "MP3-Export ist gespeichert, die Playlist-Datei im EDL- & Playlist Browser konnte aber nicht aktualisiert werden."
            );
          }
        }
        if (fileName?.toLowerCase().endsWith(".edl")) {
          const plName = edlFileNameToPlaylistFileName(fileName);
          setFileName(plName);
          setLoadedLibraryFile((prev) => {
            if (
              prev &&
              prev.kind === "edl" &&
              prev.fileName.toLowerCase() === fileName.toLowerCase()
            ) {
              return { ...prev, fileName: plName, kind: "playlist" };
            }
            return prev;
          });
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Export fehlgeschlagen.");
      } finally {
        transferCustomerIdForPendingRef.current = null;
        setExportBusy(false);
      }
    },
    [
      playlist,
      sessionUserId,
      askDuplicate,
      musicDbFileNames,
      edlLibraryAccess,
      loadedLibraryFile,
      edlTitle,
      fileName,
      persistTagStore,
      refreshMusicDbFromServer,
    ]
  );

  const onExportFakeMp3s = useCallback(
    async (options?: { onlyOffline?: boolean }) => {
      if (!playlist?.length) return;
      if (!sessionUserId) {
        setError("Bitte anmelden, um Fake-MP3s auf dem Server zu speichern.");
        return;
      }
      let onlyIndices: Set<number> | undefined;
      if (options?.onlyOffline) {
        onlyIndices = new Set<number>();
        playlist.forEach((row, i) => {
          const linked = row.linkedTrackFileName?.trim();
          if (!linked || !isMp3FileName(linked)) return;
          if (resolveMusicDbPathForBasename(musicDbFileNames, linked) === null) {
            onlyIndices!.add(i);
          }
        });
        if (onlyIndices.size === 0) {
          setError("Keine weiß markierten Zeilen ohne Eintrag in der Musikdatenbank.");
          return;
        }
      }
      try {
        const state = await refreshMusicDbFromServer();
        const paths = state?.paths ?? musicDbFileNames;
        const db = gvlLabelDb ?? loadGvlLabelDb();
        const { updates, missingInGvl } = enumerateGvlPlaylistSyncItems({
          playlist,
          tagStore: tagStoreRef.current,
          musicDbFileNames: paths,
          gvlDb: db,
        });
        if (updates.length > 0) {
          pendingPostGvlSyncRef.current = { runExport: true, exportOptions: options };
          gvlSyncPendingMissingRef.current = missingInGvl;
          setGvlSyncWizard({ items: updates, index: 0 });
          setGvlSyncModalPhase("queue");
          setGvlSyncModalOpen(true);
          return;
        }
        if (missingInGvl.length > 0) {
          pendingPostGvlSyncRef.current = { runExport: true, exportOptions: options };
          setGvlSyncReportText(formatGvlPlaylistSyncMissingReport(missingInGvl));
          setGvlSyncModalPhase("missingOnly");
          setGvlSyncModalOpen(true);
          return;
        }
        await executeFakeMp3Export(options);
      } catch (e) {
        setError(e instanceof Error ? e.message : "GVL-Abgleich fehlgeschlagen.");
      }
    },
    [playlist, sessionUserId, musicDbFileNames, gvlLabelDb, refreshMusicDbFromServer, executeFakeMp3Export]
  );

  const handleGvlSyncAbort = useCallback(() => {
    setGvlSyncModalOpen(false);
    setGvlSyncWizard(null);
    setGvlSyncModalPhase("queue");
    pendingPostGvlSyncRef.current = null;
    gvlSyncPendingMissingRef.current = [];
  }, []);

  const handleGvlSyncMissingOk = useCallback(() => {
    const missing = gvlSyncPendingMissingRef.current;
    if (missing.length > 0) {
      setTagStore((s) => {
        const next = applyWarnungForMissingGvlLabelcodes(s, missing);
        persistTagStore(next);
        return next;
      });
    }
    gvlSyncPendingMissingRef.current = [];
    setGvlSyncModalOpen(false);
    setGvlSyncWizard(null);
    setGvlSyncModalPhase("queue");
    const p = pendingPostGvlSyncRef.current;
    pendingPostGvlSyncRef.current = null;
    if (p?.runExport) void executeFakeMp3Export(p.exportOptions);
  }, [executeFakeMp3Export, persistTagStore]);

  const handleGvlSyncQueueDecision = useCallback(
    (accept: boolean) => {
      const w = gvlSyncWizardRef.current;
      if (!w) return;
      const { items, index } = w;
      const current = items[index];
      if (!current) return;

      if (accept) {
        setTagStore((s) => {
          const next = applyGvlPlaylistSyncItem(s, current);
          persistTagStore(next);
          return next;
        });
      }

      if (index + 1 < items.length) {
        setGvlSyncWizard({ items, index: index + 1 });
        return;
      }

      setGvlSyncWizard(null);
      const missing = gvlSyncPendingMissingRef.current;
      if (missing.length > 0) {
        setGvlSyncReportText(formatGvlPlaylistSyncMissingReport(missing));
        setGvlSyncModalPhase("missing");
      } else {
        setGvlSyncModalOpen(false);
        const p = pendingPostGvlSyncRef.current;
        pendingPostGvlSyncRef.current = null;
        if (p?.runExport) void executeFakeMp3Export(p.exportOptions);
      }
    },
    [persistTagStore, executeFakeMp3Export]
  );

  const handleGvlSyncBackdrop = useCallback(() => {
    if (gvlSyncModalPhase === "queue") handleGvlSyncAbort();
    else handleGvlSyncMissingOk();
  }, [gvlSyncModalPhase, handleGvlSyncAbort, handleGvlSyncMissingOk]);

  const closeTransferCustomerModal = useCallback(() => {
    pendingTransferKindRef.current = null;
    transferCustomerIdForPendingRef.current = null;
    setTransferCustomerModalOpen(false);
  }, []);

  const onTransferCustomerConfirmed = useCallback(
    (customerId: string) => {
      transferCustomerIdForPendingRef.current = customerId.trim() || null;
      setTransferCustomerModalOpen(false);
      const kind = pendingTransferKindRef.current;
      pendingTransferKindRef.current = null;
      if (kind === "offline") {
        void onExportFakeMp3s({ onlyOffline: true });
        return;
      }
      if (kind === "full") {
        if (fileName && isPlaylistLibraryFileName(fileName) && !hasOfflinePlaylistRows) {
          setTransferListConfirmOpen(true);
        } else {
          void onExportFakeMp3s();
        }
      }
    },
    [fileName, hasOfflinePlaylistRows, onExportFakeMp3s]
  );

  const requestExportFakeMp3s = useCallback(() => {
    if (!playlist?.length || exportBusy) return;
    if (isAdmin) {
      pendingTransferKindRef.current = "full";
      setTransferCustomerModalOpen(true);
      return;
    }
    if (fileName && isPlaylistLibraryFileName(fileName) && !hasOfflinePlaylistRows) {
      setTransferListConfirmOpen(true);
      return;
    }
    void onExportFakeMp3s();
  }, [playlist, exportBusy, fileName, onExportFakeMp3s, hasOfflinePlaylistRows, isAdmin]);

  const requestOfflineExportFakeMp3s = useCallback(() => {
    if (!playlist?.length || exportBusy) return;
    if (isAdmin) {
      pendingTransferKindRef.current = "offline";
      setTransferCustomerModalOpen(true);
      return;
    }
    void onExportFakeMp3s({ onlyOffline: true });
  }, [playlist, exportBusy, onExportFakeMp3s, isAdmin]);

  /** Derselbe Ablauf wie beim erneuten Laden einer Session mit Playlist (GVL-Abgleich), ohne Datei neu zu öffnen. */
  const requestGvlAbgleich = useCallback(async () => {
    if (!playlist?.length || exportBusy) return;
    if (!sessionUserId) {
      setError("Bitte anmelden, um den GVL-Abgleich auszuführen.");
      return;
    }
    setError(null);
    try {
      const state = await refreshMusicDbFromServer();
      const paths = state?.paths ?? musicDbFileNames;
      const db = gvlLabelDb ?? loadGvlLabelDb();
      if (!db?.entries?.length) {
        setError("Keine GVL-Datenbank. Bitte unter Systemeinstellungen importieren.");
        return;
      }
      const { updates, missingInGvl } = enumerateGvlPlaylistSyncItems({
        playlist,
        tagStore: tagStoreRef.current,
        musicDbFileNames: paths,
        gvlDb: db,
      });
      if (updates.length === 0 && missingInGvl.length === 0) {
        setError(
          "Hinweis: GVL-Abgleich — keine Änderungen und keine fehlenden Labelcodes (für verknüpfte MP3s in der Musikdatenbank)."
        );
        return;
      }
      pendingPostGvlSyncRef.current = { runExport: false };
      if (updates.length > 0) {
        gvlSyncPendingMissingRef.current = missingInGvl;
        setGvlSyncWizard({ items: updates, index: 0 });
        setGvlSyncModalPhase("queue");
        setGvlSyncModalOpen(true);
      } else {
        setGvlSyncReportText(formatGvlPlaylistSyncMissingReport(missingInGvl));
        setGvlSyncModalPhase("missingOnly");
        setGvlSyncModalOpen(true);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "GVL-Abgleich fehlgeschlagen.");
    }
  }, [
    playlist,
    exportBusy,
    sessionUserId,
    musicDbFileNames,
    gvlLabelDb,
    refreshMusicDbFromServer,
  ]);

  const mp3KnownFromPlaylist = useMemo(() => musicDbFileNames, [musicDbFileNames]);

  const mp3IndexByName = useMemo(() => {
    const m = new Map<string, number>();
    mp3KnownFromPlaylist.forEach((name, i) => m.set(name, i + 1));
    return m;
  }, [mp3KnownFromPlaylist]);

  const mp3VisibleColumnIds = useMemo(
    () => mp3ColumnOrder.filter((id) => !mp3ColumnHidden.has(id)),
    [mp3ColumnOrder, mp3ColumnHidden]
  );

  const mp3HiddenColumnIdsSorted = useMemo(() => {
    const hidden = [...mp3ColumnHidden].sort(
      (a, b) => mp3ColumnOrder.indexOf(a) - mp3ColumnOrder.indexOf(b)
    );
    return hidden;
  }, [mp3ColumnHidden, mp3ColumnOrder]);

  const mp3VisibleWidthsArr = useMemo(() => {
    const def = defaultMp3ColumnWidthsById();
    return mp3VisibleColumnIds.map((id) => mp3ColWidthsById[id] ?? def[id]);
  }, [mp3VisibleColumnIds, mp3ColWidthsById]);

  mp3ColWidthsRef.current = mp3VisibleWidthsArr;

  useEffect(() => {
    saveMp3TableLayout({
      order: mp3ColumnOrder,
      hidden: mp3ColumnHidden,
      widths: sanitizeMp3ColumnWidths(mp3ColWidthsById),
    });
  }, [mp3ColumnOrder, mp3ColumnHidden, mp3ColWidthsById]);

  const hideMp3Column = useCallback((id: Mp3TableColumnId) => {
    setMp3ColumnHidden((prev) => {
      if (prev.has(id)) return prev;
      const visibleCount = MP3_TABLE_ALL_COLUMN_IDS.length - prev.size;
      if (visibleCount <= 1) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    setMp3Filters((f) => ({ ...f, [id]: "" }));
  }, []);

  const showMp3Column = useCallback((id: Mp3TableColumnId) => {
    setMp3ColumnHidden((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const edlVisibleColumnIds = useMemo(
    () => edlColumnOrder.filter((id) => !edlColumnHidden.has(id)),
    [edlColumnOrder, edlColumnHidden]
  );

  const edlHiddenColumnIdsSorted = useMemo(() => {
    return [...edlColumnHidden].sort(
      (a, b) => edlColumnOrder.indexOf(a) - edlColumnOrder.indexOf(b)
    );
  }, [edlColumnHidden, edlColumnOrder]);

  const edlVisibleWidthsArr = useMemo(() => {
    const def = defaultEdlColumnWidthsById();
    return edlVisibleColumnIds.map((id) => edlColWidthsById[id] ?? def[id]);
  }, [edlVisibleColumnIds, edlColWidthsById]);

  const exportColumnIdsForCustomer = useMemo(
    () => exportPlaylistColumnIds(edlVisibleColumnIds).filter((id) => id !== "track"),
    [edlVisibleColumnIds]
  );
  const customerPlaylistWidthsArr = useMemo(() => {
    const def = defaultEdlColumnWidthsById();
    return exportColumnIdsForCustomer.map((id) => edlColWidthsById[id] ?? def[id]);
  }, [exportColumnIdsForCustomer, edlColWidthsById]);

  const edlDisplayColumnIds = playlistAsCustomerExport ? exportColumnIdsForCustomer : edlVisibleColumnIds;
  const edlDisplayWidthsArr = playlistAsCustomerExport ? customerPlaylistWidthsArr : edlVisibleWidthsArr;

  edlColWidthsRef.current = edlVisibleWidthsArr;

  useEffect(() => {
    saveEdlTableLayout({
      order: edlColumnOrder,
      hidden: edlColumnHidden,
      widths: sanitizeEdlColumnWidths(edlColWidthsById),
    });
  }, [edlColumnOrder, edlColumnHidden, edlColWidthsById]);

  const hideEdlColumn = useCallback((id: EdlTableColumnId) => {
    setEdlColumnHidden((prev) => {
      if (prev.has(id)) return prev;
      const visibleCount = EDL_TABLE_ALL_COLUMN_IDS.length - prev.size;
      if (visibleCount <= 1) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    setEdlFilters((f) => ({ ...f, [id]: "" }));
  }, []);

  const showEdlColumn = useCallback((id: EdlTableColumnId) => {
    setEdlColumnHidden((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const removePlaylistRowsFromList = useCallback((indices: number[]) => {
    if (!indices.length) return;
    setEdlSelectedRowIndices(new Set());
    setEdlSelectionAnchorPlaylistIndex(null);
    const removeSet = new Set(indices);
    let rowsToRemove: PlaylistEntry[] = [];
    setPlaylist((prev) => {
      if (!prev?.length) return prev;
      rowsToRemove = prev.filter((_, idx) => removeSet.has(idx));
      if (!rowsToRemove.length) return prev;
      return prev.filter((_, idx) => !removeSet.has(idx));
    });
    if (!rowsToRemove.length) return;
    setTagStore((ts) => {
      const next = { ...ts };
      for (const row of rowsToRemove) {
        delete next[playlistTagKey(row.id)];
      }
      persistTagStore(next);
      return next;
    });
    setTagModal((tm) => {
      if (!tm || tm.kind !== "playlist") return tm;
      if (removeSet.has(tm.index)) return null;
      const removedBefore = [...removeSet].filter((i) => i < tm.index).length;
      if (removedBefore === 0) return tm;
      return { ...tm, index: tm.index - removedBefore };
    });
    setTagsCtxMenu(null);
    const n = rowsToRemove.length;
    setInfoMessage(
      n === 1
        ? "Ein Eintrag wurde aus der Liste entfernt. Verknüpfte MP3s bleiben in der Musikdatenbank."
        : `${n} Einträge wurden aus der Liste entfernt. Verknüpfte MP3s bleiben in der Musikdatenbank.`
    );
  }, [persistTagStore]);

  const showTrackInMusicDatabase = useCallback((fileName: string) => {
    setTagsCtxMenu(null);
    setInfoMessage(null);
    setMp3Filters(emptyMp3FiltersRecord());
    setMp3SelectedNames(new Set([fileName]));
    setMp3SelectionAnchorName(fileName);
    setHighlightMp3Name(fileName);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        mp3RowRefs.current.get(fileName)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
    });
    window.setTimeout(() => setHighlightMp3Name(null), 2200);
  }, []);

  /** Gecachtes tracksDir vom API-Server (Pfad kopieren im Kontextmenü). */
  const serverTracksDirRef = useRef<string | null>(null);
  useEffect(() => {
    if (!sessionUserId) serverTracksDirRef.current = null;
  }, [sessionUserId]);

  const copyMp3ServerPathToClipboard = useCallback(async (relativeFilePath: string) => {
    setTagsCtxMenu(null);
    setError(null);
    const rel = relativeFilePath.replace(/\\/g, "/").replace(/^\/+/, "").trim();
    if (!rel) {
      setInfoMessage("Kein Dateipfad vorhanden.");
      return;
    }
    if (!sessionUserId) {
      const ok = await copyTextToClipboard(rel);
      setInfoMessage(
        ok
          ? `Relativer Pfad kopiert: „${rel}“. Nach der Anmeldung kopiert die App den vollständigen Server-Pfad.`
          : "Kopieren in die Zwischenablage fehlgeschlagen."
      );
      return;
    }
    try {
      let root = serverTracksDirRef.current;
      if (!root) {
        const p = await apiStoragePathsFetch();
        root = p.tracksDir;
        serverTracksDirRef.current = root;
      }
      const full = `${root.replace(/[/\\]+$/, "")}/${rel}`;
      const ok = await copyTextToClipboard(full);
      setInfoMessage(ok ? "Pfad in die Zwischenablage kopiert." : "Kopieren fehlgeschlagen.");
    } catch (e) {
      setInfoMessage(e instanceof Error ? e.message : "Server-Pfad konnte nicht geladen werden.");
    }
  }, [sessionUserId]);

  const purgeMusicDbEntriesFromState = useCallback(
    async (
      removed: string[],
      mode: "orphan-index" | "after-file-delete" = "orphan-index"
    ) => {
      if (!removed.length) return;
      const normPath = (s: string) => s.replace(/\\/g, "/").trim().toLowerCase();
      const removedNorm = new Set(removed.map(normPath));

      let musicDbPathsAfterRemoval: string[] | null = null;
      try {
        if (sessionUserIdRef.current) {
          if (mode === "after-file-delete") {
            const state = await refreshMusicDbFromServer();
            musicDbPathsAfterRemoval = state?.paths ?? null;
          } else {
            const merged = await apiSharedMusicDbRemovePaths(removed);
            setMusicDbFileNames(merged.paths);
            setMusicDbMetadata(merged.metadata);
            musicDbPathsAfterRemoval = merged.paths;
          }
        } else {
          const nextPaths = musicDbFileNames.filter((n) => !removedNorm.has(normPath(n)));
          musicDbPathsAfterRemoval = nextPaths;
          setMusicDbFileNames(nextPaths);
          setMusicDbMetadata((prev) => {
            const next = { ...prev };
            for (const p of removed) delete next[p];
            return next;
          });
        }
      } catch {
        const nextPaths = musicDbFileNames.filter((n) => !removedNorm.has(normPath(n)));
        musicDbPathsAfterRemoval = nextPaths;
        setMusicDbFileNames(nextPaths);
        setMusicDbMetadata((prev) => {
          const next = { ...prev };
          for (const p of removed) delete next[p];
          return next;
        });
      }

      const tagKeysToRemove = collectTagStoreKeysForRemovedMusicPaths(
        removed,
        playlist,
        musicDbPathsAfterRemoval
      );

      setTagStore((prev) => {
        const next = { ...prev };
        for (const k of tagKeysToRemove) {
          delete next[k];
        }
        persistTagStore(next);
        return next;
      });
      /* Verknüpfung beibehalten: Zeile bleibt mit Metadaten sichtbar und wird weiß markiert (MP3 nicht mehr in der DB). */
      setMp3SelectedNames((prev) => {
        const next = new Set(prev);
        for (const x of prev) {
          if (removedNorm.has(normPath(x))) next.delete(x);
        }
        return next;
      });
      setHighlightMp3Name((h) => (h && removedNorm.has(normPath(h)) ? null : h));
      setMusicDbMissingHighlightList((prev) => {
        if (!prev.length) return prev;
        const next = prev.filter((n) => !removedNorm.has(normPath(n)));
        return next.length === prev.length ? prev : next;
      });
    },
    [
      persistTagStore,
      refreshMusicDbFromServer,
      musicDbFileNames,
      playlist,
    ]
  );

  const scanMusicDbForOrphans = useCallback(async () => {
    if (!sessionUserId || !musicDbFileNames.length) return;
    setError(null);
    setInfoMessage(null);
    setMusicDbCleanupBusy(true);
    try {
      const missing = await getMusicDbPathsMissingOnServer(
        (p) => apiSharedTracksExists(p),
        musicDbFileNames
      );
      if (!missing.length) {
        setInfoMessage(
          "Auf dem Server existiert zu jedem Eintrag eine MP3-Datei — die Musikdatenbank ist konsistent."
        );
        return;
      }
      setMusicDbOrphanConfirmPaths(missing);
    } finally {
      setMusicDbCleanupBusy(false);
    }
  }, [sessionUserId, musicDbFileNames]);

  const confirmMp3DeleteAction = useCallback(
    async (targets: string[]) => {
      if (!targets.length) return;
      if (!isAdmin) {
        setError("Nur Administratoren dürfen MP3-Dateien aus der Musikdatenbank löschen.");
        return;
      }
      if (!sessionUserId) {
        setError("Bitte anmelden.");
        return;
      }
      setError(null);
      setInfoMessage(null);
      const { removed, failed } = await deleteMp3FilesFromSharedStorage(targets);
      if (removed.length) {
        await purgeMusicDbEntriesFromState(removed, "after-file-delete");
      }
      if (failed.length) {
        const detail = failed.map((f) => `„${f.path}“: ${f.message}`).join(" ");
        setError(
          removed.length
            ? `Einige Dateien konnten nicht gelöscht werden: ${detail}`
            : `Löschen fehlgeschlagen: ${detail}`
        );
      } else if (removed.length) {
        setInfoMessage(
          removed.length === 1
            ? "Die MP3-Datei wurde auf dem Server gelöscht und aus der Musikdatenbank entfernt. Playlist-Verknüpfungen und Einträge bleiben erhalten (weiß markiert, solange keine MP3 in der DB)."
            : `${removed.length} MP3-Dateien wurden auf dem Server gelöscht und aus der Musikdatenbank entfernt. Playlist-Verknüpfungen und Einträge bleiben erhalten (weiß markiert, solange keine MP3 in der DB).`
        );
      }
    },
    [sessionUserId, purgeMusicDbEntriesFromState, isAdmin]
  );

  const playlistMergedTags = useMemo(() => {
    if (!playlist) return [];
    return playlist.map((row) => {
      const base = defaultTagsFromPlaylistTitle(row.linkedTrackFileName ?? row.title);
      return mergeWarnungForDisplay(mergeAudioTags(base, playlistRowTagOverlay(row, tagStore)));
    });
  }, [playlist, tagStore]);

  const fileMergedTagsByName = useMemo(() => {
    const map = new Map<string, AudioTags>();
    for (const name of mp3KnownFromPlaylist) {
      const base = defaultTagsFromPlaylistTitle(name);
      const linkedRow = playlist?.find((r) => r.linkedTrackFileName === name);
      const overlay = linkedRow
        ? playlistRowTagOverlay(linkedRow, tagStore)
        : tagStore[fileTagKey(name)] ?? {};
      let merged = mergeWarnungForDisplay(mergeAudioTags(base, overlay));
      const anyPlaylistWarnung = playlist?.some((r) => {
        if (r.linkedTrackFileName !== name) return false;
        const b = defaultTagsFromPlaylistTitle(r.linkedTrackFileName ?? r.title);
        return (
          mergeWarnungForDisplay(mergeAudioTags(b, playlistRowTagOverlay(r, tagStore)))
            .warnung === true
        );
      });
      if (anyPlaylistWarnung) merged = { ...merged, warnung: true };
      map.set(name, merged);
    }
    return map;
  }, [mp3KnownFromPlaylist, playlist, tagStore]);

  /** In der Kundenansicht gelten Filter nur für die angezeigten Export-Spalten (ohne Titel/Jahr). */
  const edlFilterColumnIdsForPlaylist = useMemo(
    () => (playlistAsCustomerExport ? exportColumnIdsForCustomer : edlVisibleColumnIds),
    [playlistAsCustomerExport, exportColumnIdsForCustomer, edlVisibleColumnIds]
  );

  const edlFiltersActiveForPlaylistView = useMemo(() => {
    if (playlistAsCustomerExport) {
      return edlFilterColumnIdsForPlaylist.some((id) => (edlFilters[id] ?? "").trim().length > 0);
    }
    return hasActiveColumnFiltersRecord(edlFilters);
  }, [playlistAsCustomerExport, edlFilterColumnIdsForPlaylist, edlFilters]);

  const filteredPlaylistRowIndices = useMemo(() => {
    if (!playlist?.length) return [] as number[];
    const out: number[] = [];
    for (let i = 0; i < playlist.length; i++) {
      const row = playlist[i];
      const merged = playlistMergedTags[i] ?? {};
      const cellsMap = buildEdlRowCellsMap(row, i, merged);
      const vals = edlFilterColumnIdsForPlaylist.map((id) => cellsMap[id]);
      const filters = edlFilterColumnIdsForPlaylist.map((id) => edlFilters[id] ?? "");
      if (matchesColumnFilters(vals, filters)) out.push(i);
    }
    return out;
  }, [playlist, playlistMergedTags, edlFilters, edlFilterColumnIdsForPlaylist]);

  const sortedPlaylistRowIndices = useMemo(() => {
    const indices = [...filteredPlaylistRowIndices];
    if (!edlSort || !playlist?.length) return indices;
    const { columnId, direction } = edlSort;
    indices.sort((ia, ib) => {
      const rowA = playlist[ia]!;
      const rowB = playlist[ib]!;
      const mergedA = playlistMergedTags[ia] ?? {};
      const mergedB = playlistMergedTags[ib] ?? {};
      let va: string;
      let vb: string;
      switch (columnId) {
        case "num":
          va = String(ia + 1).padStart(12, "0");
          vb = String(ib + 1).padStart(12, "0");
          break;
        case "track":
          va = rowA.track;
          vb = rowB.track;
          break;
        case "tcIn":
          va = rowA.recIn;
          vb = rowB.recIn;
          break;
        case "tcOut":
          va = rowA.recOut;
          vb = rowB.recOut;
          break;
        case "duration":
          va = playlistDurationTimecode(rowA.recInFrames, rowA.recOutFrames);
          vb = playlistDurationTimecode(rowB.recInFrames, rowB.recOutFrames);
          break;
        case "title":
          va = rowA.linkedTrackFileName ?? rowA.title;
          vb = rowB.linkedTrackFileName ?? rowB.title;
          break;
        default:
          va = isEdlTagColumnId(columnId) ? tagCellText(mergedA, columnId) : "";
          vb = isEdlTagColumnId(columnId) ? tagCellText(mergedB, columnId) : "";
      }
      return compareSortableStrings(va, vb, direction);
    });
    return indices;
  }, [filteredPlaylistRowIndices, edlSort, playlist, playlistMergedTags]);

  const requestPlaylistXlsExport = useCallback(async () => {
    if (!playlist?.length || exportBusy || !fileName) return;
    try {
      await exportPlaylistViewToXlsx(
        edlVisibleColumnIds,
        sortedPlaylistRowIndices,
        playlist,
        playlistMergedTags,
        fileName
      );
    } catch (e) {
      console.error(e);
    }
  }, [
    playlist,
    exportBusy,
    fileName,
    edlVisibleColumnIds,
    sortedPlaylistRowIndices,
    playlistMergedTags,
  ]);

  const requestPlaylistMailExport = useCallback(async () => {
    if (!playlist?.length || exportBusy || !fileName) return;
    try {
      const { fileName: outName, buffer } = await buildPlaylistExportXlsxBuffer(
        edlVisibleColumnIds,
        sortedPlaylistRowIndices,
        playlist,
        playlistMergedTags,
        fileName
      );

      const base = basenamePath(fileName);
      const stem = base.replace(/\.(edl|list|egpl|xls|xlsx)$/i, "") || base;
      let mailAssignment: {
        libraryOwnerUserId: string;
        parentSegments: string[];
        playlistFileName: string;
      } | null = null;
      if (sessionUserId && edlLibraryAccess) {
        const targetSegments = loadedLibraryFile?.parentSegments ?? edlImportTargetSegments ?? [];
        const listFileName = (() => {
          if (loadedLibraryFile?.kind === "playlist") return loadedLibraryFile.fileName;
          const sourceName = loadedLibraryFile?.fileName ?? fileName;
          const lower = sourceName.toLowerCase();
          if (lower.endsWith(".xls") || lower.endsWith(".xlsx")) {
            return gemaXlsFileNameToPlaylistFileName(sourceName);
          }
          return edlFileNameToPlaylistFileName(sourceName);
        })();
        const tagsByRowId: Record<string, AudioTags> = {};
        for (let i = 0; i < playlist.length; i++) {
          const row = playlist[i];
          if (!row) continue;
          const merged = playlistMergedTags[i] ?? {};
          if (!hasAnyAudioTagValue(merged) && merged.warnung !== true) continue;
          tagsByRowId[row.id] = merged;
        }
        const payload = serializePlaylistLibraryFile({
          v: 1,
          displayTitle: edlTitle,
          playlist,
          ...(Object.keys(tagsByRowId).length ? { tagsByRowId } : {}),
          tracksLinkedAtIso: new Date().toISOString(),
        });
        await edlLibraryAccess.writeText(targetSegments, listFileName, payload);
        setEdlLibraryRefresh((k) => k + 1);
        mailAssignment = {
          libraryOwnerUserId: sessionUserId,
          parentSegments: targetSegments,
          playlistFileName: listFileName,
        };
      }
      let initialCustomerId = "";
      if (mailAssignment) {
        try {
          const cid = await lookupPlaylistPendingCustomerRequest({
            libraryOwnerUserId: mailAssignment.libraryOwnerUserId,
            parentSegments: mailAssignment.parentSegments,
            playlistFileName: mailAssignment.playlistFileName,
          });
          if (cid) initialCustomerId = cid;
        } catch {
          /* Lookup optional */
        }
      }
      const customerMissingHint = Boolean(mailAssignment && !initialCustomerId);
      setPlaylistMailPayload({
        attachmentBase64: arrayBufferToBase64(buffer),
        attachmentFileName: outName,
        defaultSubject: `GEMA ${stem}`,
        defaultBody: `Hallo zusammen,<br><br>anbei erhaltet ihr die GEMA-Übersicht zum Film <strong>${escapeHtmlForMail(
          stem
        )}</strong> als Excel-Datei. Mit den von euch genutzten Tracks ist alles in Ordnung. Wenn ihr euch mit euren Kontodaten hier einloggt: <a href="https://musiclist.dsm.team/">https://musiclist.dsm.team/</a> dann könnt ihr die Tabellen komfortabler betrachten.<br><br>Viele Grüße<br>Oliver`,
        mailAssignment,
        initialCustomerId,
        customerMissingHint,
      });
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : "Export/Mail konnte nicht vorbereitet werden.");
    }
  }, [
    playlist,
    exportBusy,
    fileName,
    edlVisibleColumnIds,
    sortedPlaylistRowIndices,
    playlistMergedTags,
    edlTitle,
    loadedLibraryFile,
    edlLibraryAccess,
    edlImportTargetSegments,
    sessionUserId,
  ]);

  const netPlaylistTracks = useMemo(
    () => (playlist?.length ? netPlaylistTrackCount(playlist) : 0),
    [playlist]
  );

  const filteredMp3Names = useMemo(() => {
    return mp3KnownFromPlaylist.filter((name) => {
      const merged = fileMergedTagsByName.get(name) ?? {};
      const idx = mp3IndexByName.get(name) ?? 1;
      const cellsMap = buildMp3RowCellsMap(name, merged, idx, musicDbMetadata[name]);
      const vals = mp3VisibleColumnIds.map((id) => cellsMap[id]);
      const filters = mp3VisibleColumnIds.map((id) => mp3Filters[id] ?? "");
      return matchesColumnFilters(vals, filters);
    });
  }, [
    mp3KnownFromPlaylist,
    fileMergedTagsByName,
    mp3Filters,
    mp3IndexByName,
    musicDbMetadata,
    mp3VisibleColumnIds,
  ]);

  const sortedMp3Names = useMemo(() => {
    const list = [...filteredMp3Names];
    if (!mp3Sort) return list;
    const { columnId, direction } = mp3Sort;
    list.sort((na, nb) => {
      const idxA = mp3IndexByName.get(na) ?? 1;
      const idxB = mp3IndexByName.get(nb) ?? 1;
      const mergedA = fileMergedTagsByName.get(na) ?? {};
      const mergedB = fileMergedTagsByName.get(nb) ?? {};
      const metaA = musicDbMetadata[na];
      const metaB = musicDbMetadata[nb];
      let va: string;
      let vb: string;
      switch (columnId) {
        case "num":
          va = String(idxA).padStart(12, "0");
          vb = String(idxB).padStart(12, "0");
          break;
        case "filename":
          va = na;
          vb = nb;
          break;
        case "created":
          va = metaA?.createdAt ?? "";
          vb = metaB?.createdAt ?? "";
          break;
        case "edited":
          va = metaA?.updatedAt ?? "";
          vb = metaB?.updatedAt ?? "";
          break;
        default:
          va = isMp3TagColumnId(columnId) ? tagCellText(mergedA, columnId) : "";
          vb = isMp3TagColumnId(columnId) ? tagCellText(mergedB, columnId) : "";
      }
      return compareSortableStrings(va, vb, direction);
    });
    return list;
  }, [filteredMp3Names, mp3Sort, mp3IndexByName, fileMergedTagsByName, musicDbMetadata]);

  const musicDbMissingOnDiskSet = useMemo(
    () => new Set(musicDbMissingHighlightList),
    [musicDbMissingHighlightList]
  );

  const markMusicDbMissingOnDisk = useCallback(async () => {
    if (!sessionUserId || !musicDbFileNames.length) return;
    setError(null);
    setInfoMessage(null);
    setMusicDbCleanupBusy(true);
    try {
      const missing = await getMusicDbPathsMissingOnServer(
        (p) => apiSharedTracksExists(p),
        musicDbFileNames
      );
      setMusicDbMissingHighlightList(missing);
      if (!missing.length) {
        setInfoMessage(
          "Auf dem Server existiert zu jedem Eintrag eine MP3-Datei — nichts hervorzuheben."
        );
        return;
      }
      const visible = missing.filter((n) => filteredMp3Names.includes(n));
      const filteredOut = missing.length - visible.length;
      setInfoMessage(
        filteredOut > 0
          ? `${missing.length} fehlende Datei(en) gelb markiert. ${filteredOut} davon sind durch die Spaltenfilter ausgeblendet — Filter zurücksetzen, um alle zu sehen.`
          : `${missing.length} fehlende Datei(en) gelb in der Liste markiert.`
      );
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          for (const n of missing) {
            const el = mp3RowRefs.current.get(n);
            if (el) {
              el.scrollIntoView({ behavior: "smooth", block: "nearest" });
              break;
            }
          }
        });
      });
    } finally {
      setMusicDbCleanupBusy(false);
    }
  }, [sessionUserId, musicDbFileNames, filteredMp3Names]);

  const runRecreatePlaceholderMp3Job = useCallback(
    async (paths: string[]) => {
      if (!sessionUserId || paths.length === 0) return;
      setError(null);
      setInfoMessage(null);
      setMp3RecreateBusy(true);
      try {
        const getTags = (rel: string) => fileMergedTagsByName.get(rel);
        const sink = createSharedFakeMp3Sink();
        const { written, skippedExisting, failed } = await recreatePlaceholderMp3sOnShared(
          sink,
          paths,
          getTags
        );
        setMusicDbMissingHighlightList((prev) => {
          if (!prev.length || !written.length) return prev;
          const w = new Set(written);
          const next = prev.filter((p) => !w.has(p));
          return next.length === prev.length ? prev : next;
        });
        const infos: string[] = [];
        if (written.length > 0) {
          await refreshMusicDbFromServer();
          infos.push(
            written.length === 1
              ? "Eine Platzhalter-MP3 mit Tags wurde auf dem Server am gespeicherten Pfad angelegt."
              : `${written.length} Platzhalter-MP3s mit Tags wurden auf dem Server angelegt.`
          );
        }
        if (skippedExisting.length > 0) {
          infos.push(
            skippedExisting.length === 1
              ? "Eine Datei existierte bereits und wurde übersprungen."
              : `${skippedExisting.length} Dateien existierten bereits und wurden übersprungen.`
          );
        }
        if (infos.length > 0) setInfoMessage(infos.join(" "));
        if (failed.length > 0) {
          const detail = failed.map((f) => `„${f.path}“: ${f.message}`).join(" ");
          setError(
            written.length || skippedExisting.length
              ? `Teilweise fehlgeschlagen: ${detail}`
              : `Anlegen fehlgeschlagen: ${detail}`
          );
        }
      } finally {
        setMp3RecreateBusy(false);
      }
    },
    [sessionUserId, fileMergedTagsByName, refreshMusicDbFromServer]
  );

  const onMp3RecreatePlaceholderClick = useCallback(async () => {
    setError(null);
    setInfoMessage(null);
    const selected = [...mp3SelectedNames];
    if (selected.length === 0) {
      setError(
        "Bitte mindestens einen Eintrag auswählen, der auf dem Server fehlt (z. B. gelb markiert)."
      );
      return;
    }
    if (!sessionUserId) {
      setError("Bitte anmelden, um Platzhalter-MP3s auf dem Server anzulegen.");
      return;
    }
    setMp3RecreateBusy(true);
    try {
      const missing = await getMusicDbPathsMissingOnServer(
        (p) => apiSharedTracksExists(p),
        selected
      );
      if (missing.length === 0) {
        setInfoMessage(
          "Keine der ausgewählten Dateien fehlt auf dem Server — es wurde nichts angelegt."
        );
        return;
      }
      const safeMissing = missing.filter((p) => isSafeTracksRelativePath(p));
      const unsafe = missing.filter((p) => !isSafeTracksRelativePath(p));
      if (unsafe.length > 0) {
        setError(
          unsafe.length === 1
            ? `Ungültiger Pfad (wird übersprungen): „${unsafe[0]}“`
            : `${unsafe.length} ungültige Pfade werden übersprungen.`
        );
      }
      if (safeMissing.length === 0) return;

      const needsRootConfirm = safeMissing.some((p) => !relativePathHasSubfolder(p));
      if (needsRootConfirm) {
        setMp3RecreateBasenameConfirmPaths(safeMissing);
        return;
      }
      await runRecreatePlaceholderMp3Job(safeMissing);
    } finally {
      setMp3RecreateBusy(false);
    }
  }, [sessionUserId, mp3SelectedNames, runRecreatePlaceholderMp3Job]);

  const clearAllEdlFilters = useCallback(() => {
    setEdlFilters(emptyEdlFiltersRecord());
  }, []);

  const clearAllMp3Filters = useCallback(() => {
    setMp3Filters(emptyMp3FiltersRecord());
  }, []);

  const onEdlRowClick = useCallback(
    (e: ReactMouseEvent, playlistIndex: number) => {
      const filtered = sortedPlaylistRowIndices;
      const pos = filtered.indexOf(playlistIndex);
      if (pos < 0) return;
      if (e.shiftKey && edlSelectionAnchorPlaylistIndex !== null) {
        const posAnchor = filtered.indexOf(edlSelectionAnchorPlaylistIndex);
        if (posAnchor < 0) {
          setEdlSelectedRowIndices(new Set([playlistIndex]));
          setEdlSelectionAnchorPlaylistIndex(playlistIndex);
        } else {
          const lo = Math.min(posAnchor, pos);
          const hi = Math.max(posAnchor, pos);
          const next = new Set<number>();
          for (let p = lo; p <= hi; p++) next.add(filtered[p]!);
          setEdlSelectedRowIndices(next);
        }
      } else {
        setEdlSelectedRowIndices(new Set([playlistIndex]));
        setEdlSelectionAnchorPlaylistIndex(playlistIndex);
      }
      const row = playlist?.[playlistIndex];
      if (row) {
        setEdlSeekToProgramFramesRequest({
          programFrames: row.recInFrames,
          requestId: ++edlSeekToProgramRequestIdRef.current,
        });
      }
    },
    [sortedPlaylistRowIndices, edlSelectionAnchorPlaylistIndex, playlist]
  );

  const onCustomerPlaylistCellClick = useCallback(
    async (e: ReactMouseEvent, playlistIndex: number, colId: EdlTableColumnId) => {
      e.preventDefault();
      e.stopPropagation();
      if (!playlist) return;
      const row = playlist[playlistIndex];
      if (!row) return;
      const plMerged = playlistMergedTags[playlistIndex] ?? {};
      const text = getEdlCellPlainText(colId, row, playlistIndex, plMerged);
      const key = customerCellKey(playlistIndex, colId);

      if (e.ctrlKey || e.metaKey) {
        setCustomerSelectedCells((prev) => {
          const next = new Set(prev);
          if (next.has(key)) next.delete(key);
          else next.add(key);
          return next;
        });
        return;
      }

      if (e.shiftKey && customerSelectionAnchorCell?.rowIndex === playlistIndex) {
        const ia = edlDisplayColumnIds.indexOf(customerSelectionAnchorCell.colId);
        const ib = edlDisplayColumnIds.indexOf(colId);
        if (ia >= 0 && ib >= 0) {
          const lo = Math.min(ia, ib);
          const hi = Math.max(ia, ib);
          const keys: string[] = [];
          for (let j = lo; j <= hi; j++) {
            keys.push(customerCellKey(playlistIndex, edlDisplayColumnIds[j]!));
          }
          setCustomerSelectedCells(new Set(keys));
          const tsv = buildCustomerMultiCellClipboardText(
            keys,
            playlist,
            playlistMergedTags,
            edlDisplayColumnIds
          );
          try {
            await navigator.clipboard.writeText(tsv);
          } catch {
            setError("Zwischenablage konnte nicht beschrieben werden.");
          }
          setEdlSeekToProgramFramesRequest({
            programFrames: row.recInFrames,
            requestId: ++edlSeekToProgramRequestIdRef.current,
          });
          return;
        }
      }

      setCustomerSelectionAnchorCell({ rowIndex: playlistIndex, colId });
      setCustomerSelectedCells(new Set([key]));
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        setError("Zwischenablage konnte nicht beschrieben werden.");
      }
      setEdlSeekToProgramFramesRequest({
        programFrames: row.recInFrames,
        requestId: ++edlSeekToProgramRequestIdRef.current,
      });
    },
    [playlist, playlistMergedTags, edlDisplayColumnIds, customerSelectionAnchorCell]
  );

  const copyCustomerSelectionToClipboard = useCallback(async () => {
    if (!playlist?.length) return;
    const keys = [...customerSelectedCellsRef.current];
    if (keys.length === 0) return;
    const text = buildCustomerMultiCellClipboardText(
      keys,
      playlist,
      playlistMergedTags,
      edlDisplayColumnIds
    );
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      setError("Zwischenablage konnte nicht beschrieben werden.");
    }
  }, [playlist, playlistMergedTags, edlDisplayColumnIds]);

  useEffect(() => {
    if (!playlistAsCustomerExport) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        const t = e.target as HTMLElement | null;
        if (t?.closest?.("input, textarea, [contenteditable='true']")) return;
        if (customerSelectedCellsRef.current.size === 0) return;
        e.preventDefault();
        setCustomerSelectedCells(new Set());
        setCustomerSelectionAnchorCell(null);
        return;
      }
      if (e.key !== "c" && e.key !== "C") return;
      if (!e.ctrlKey && !e.metaKey) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest?.("input, textarea, [contenteditable='true']")) return;
      if (customerSelectedCellsRef.current.size === 0) return;
      e.preventDefault();
      void copyCustomerSelectionToClipboard();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [playlistAsCustomerExport, copyCustomerSelectionToClipboard]);

  useEffect(() => {
    if (!playlistAsCustomerExport) {
      setCustomerSelectedCells(new Set());
      setCustomerSelectionAnchorCell(null);
      return;
    }
    if (isCustomerUser) return;
    setEdlAblageCollapsed(true);
    setMp3DbTableVisible(false);
  }, [playlistAsCustomerExport, isCustomerUser]);

  const onMp3RowClick = useCallback(
    (e: ReactMouseEvent, name: string) => {
      const filtered = sortedMp3Names;
      const pos = filtered.indexOf(name);
      if (pos < 0) return;
      if (e.shiftKey && mp3SelectionAnchorName !== null) {
        const posAnchor = filtered.indexOf(mp3SelectionAnchorName);
        if (posAnchor < 0) {
          setMp3SelectedNames(new Set([name]));
          setMp3SelectionAnchorName(name);
          return;
        }
        const lo = Math.min(posAnchor, pos);
        const hi = Math.max(posAnchor, pos);
        const next = new Set<string>();
        for (let p = lo; p <= hi; p++) next.add(filtered[p]!);
        setMp3SelectedNames(next);
      } else {
        setMp3SelectedNames(new Set([name]));
        setMp3SelectionAnchorName(name);
      }
    },
    [sortedMp3Names, mp3SelectionAnchorName]
  );

  const attachEdlResize = useCallback(
    (colIndex: number) => (e: ReactMouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const ids = edlVisibleColumnIds;
      startColumnResizeDrag({
        colIndex,
        clientX: e.clientX,
        startWidths: [...edlColWidthsRef.current],
        minForIndex: (i) => edlResizeMinForColumnId(ids[i]!),
        maxForIndex: (i) => edlColumnWidthMax(ids[i]!),
        lastColumnAuto: true,
        getColElements: () => edlColGroupRef.current?.children,
        onCommit: (nextWidths) => {
          setEdlColWidthsById((prev) => {
            const n = { ...prev };
            ids.forEach((id, i) => {
              n[id] = nextWidths[i]!;
            });
            return sanitizeEdlColumnWidths(n);
          });
        },
      });
    },
    [edlVisibleColumnIds]
  );

  const attachMp3Resize = useCallback(
    (colIndex: number) => (e: ReactMouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const ids = mp3VisibleColumnIds;
      startColumnResizeDrag({
        colIndex,
        clientX: e.clientX,
        startWidths: [...mp3ColWidthsRef.current],
        minForIndex: (i) => mp3ResizeMinForColumnId(ids[i]!),
        maxForIndex: (i) => mp3ColumnWidthMax(ids[i]!),
        lastColumnAuto: true,
        getColElements: () => mp3ColGroupRef.current?.children,
        onCommit: (nextWidths) => {
          setMp3ColWidthsById((prev) => {
            const n = { ...prev };
            ids.forEach((id, i) => {
              n[id] = nextWidths[i]!;
            });
            return sanitizeMp3ColumnWidths(n);
          });
        },
      });
    },
    [mp3VisibleColumnIds]
  );

  useEffect(() => {
    if (!tagsCtxMenu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setTagsCtxMenu(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tagsCtxMenu]);

  useEffect(() => {
    if (error) setInfoMessage(null);
  }, [error]);

  useEffect(() => {
    if (!infoMessage) return;
    const t = window.setTimeout(() => setInfoMessage(null), 2000);
    return () => window.clearTimeout(t);
  }, [infoMessage]);

  const onDownloadFullBackup = useCallback(() => {
    void (async () => {
      setBackupDownloadBusy(true);
      setError(null);
      try {
        await downloadFullDataBackup();
        setInfoMessage("Datensicherung wurde heruntergeladen.");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Sicherung fehlgeschlagen.");
      } finally {
        setBackupDownloadBusy(false);
      }
    })();
  }, []);

  const onRequestRestoreBackup = useCallback(() => {
    restoreBackupInputRef.current?.click();
  }, []);

  const onRestoreBackupFileChange = useCallback(async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (!f.name.toLowerCase().endsWith(".zip")) {
      setError("Bitte eine ZIP-Datei wählen.");
      return;
    }
    if (
      !window.confirm(
        "Die aktuelle Datenbank auf dem Server wird durch diese ZIP-Sicherung ersetzt.\n\n" +
          "Das bisherige data-Verzeichnis wird vorher umbenannt (data.pre-restore-…).\n\n" +
          "Fortfahren?"
      )
    ) {
      return;
    }
    setRestoreBackupBusy(true);
    setError(null);
    try {
      await uploadRestoreBackup(f);
      setInfoMessage("Wiederherstellung abgeschlossen. Die Seite lädt neu …");
      window.setTimeout(() => {
        window.location.reload();
      }, 600);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Wiederherstellung fehlgeschlagen.");
    } finally {
      setRestoreBackupBusy(false);
    }
  }, []);

  const onSplitResizeMouseDown = useCallback((e: ReactMouseEvent) => {
    e.preventDefault();
    splitDragRef.current = { y: e.clientY, frac: splitTopFrac };
    const onMove = (ev: MouseEvent) => {
      const start = splitDragRef.current;
      const root = splitPanesRef.current;
      if (!start || !root) return;
      const h = root.getBoundingClientRect().height;
      if (h < 1) return;
      const dy = ev.clientY - start.y;
      const next = Math.min(SPLIT_TOP_FRAC_MAX, Math.max(SPLIT_TOP_FRAC_MIN, start.frac + dy / h));
      setSplitTopFrac(next);
    };
    const onUp = () => {
      splitDragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [splitTopFrac]);

  const onSplitHorizontalMouseDown = useCallback((e: ReactMouseEvent) => {
    e.preventDefault();
    splitHDragRef.current = { x: e.clientX, frac: splitPlaylistVsLibrary };
    const onMove = (ev: MouseEvent) => {
      const start = splitHDragRef.current;
      const row = edlSplitRowRef.current;
      if (!start || !row) return;
      const w = row.getBoundingClientRect().width;
      if (w < 1) return;
      const dx = ev.clientX - start.x;
      const next = Math.min(0.82, Math.max(0.22, start.frac + dx / w));
      setSplitPlaylistVsLibrary(next);
    };
    const onUp = () => {
      splitHDragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [splitPlaylistVsLibrary]);

  const onMp3TablePlayerResizeMouseDown = useCallback((e: ReactMouseEvent) => {
    e.preventDefault();
    mp3TablePlayerDragRef.current = { y: e.clientY, frac: mp3TableTopFrac };
    const onMove = (ev: MouseEvent) => {
      const start = mp3TablePlayerDragRef.current;
      const root = mp3TablePlayerSplitRef.current;
      if (!start || !root) return;
      const h = root.getBoundingClientRect().height;
      if (h < 1) return;
      const dy = ev.clientY - start.y;
      const next = Math.min(
        MP3_TABLE_TOP_FRAC_MAX,
        Math.max(MP3_TABLE_TOP_FRAC_MIN, start.frac + dy / h)
      );
      setMp3TableTopFrac(next);
    };
    const onUp = () => {
      mp3TablePlayerDragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [mp3TableTopFrac]);

  const onOpenLibraryFromLibrary = useCallback(
    async (payload: OpenLibraryFilePayload) => {
      if (importOverlay) return;
      const { parentSegments, fileName: name } = payload;
      try {
        setLoadedLibraryFile(null);
        if (payload.arrayBuffer !== undefined && isGemaXlsFileName(name)) {
          const ok = await runGemaXlsImport(payload.arrayBuffer, name, "fromLibrary", parentSegments);
          if (ok) {
            setLoadedLibraryFile({
              parentSegments,
              fileName: name,
              kind: "gemaXls",
            });
          }
        } else if (payload.text !== undefined) {
          const text = payload.text;
          if (isPlaylistLibraryFileName(name)) {
            const ok = await runPlaylistLibraryLoad(text, name);
            if (ok) {
              setLoadedLibraryFile({
                parentSegments,
                fileName: name,
                kind: "playlist",
              });
            }
          } else {
            const ok = await runEdlImport(text, name, "fromLibrary", parentSegments);
            if (ok) {
              setLoadedLibraryFile({
                parentSegments,
                fileName: name,
                kind: "edl",
              });
            }
          }
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Datei konnte nicht gelesen werden.");
        setImportOverlay(null);
      }
    },
    [runEdlImport, runPlaylistLibraryLoad, runGemaXlsImport, importOverlay]
  );

  const tagCtxMenuPos = tagsCtxMenu
    ? (() => {
        const w = 280;
        let h = 44;
        if (tagsCtxMenu.kind === "file") {
          h = sessionUserId ? 204 : 152;
        } else {
          const linked = playlist?.[tagsCtxMenu.index]?.linkedTrackFileName;
          h = linked ? 204 : 96;
        }
        return clampCtxMenuPos(tagsCtxMenu.x, tagsCtxMenu.y, w, h);
      })()
    : null;

  const mp3TableColCount = Math.max(1, mp3VisibleColumnIds.length);
  const edlTableColCount = Math.max(1, edlDisplayColumnIds.length);

  const mp3TablePlayerSplitBothVisible = mp3DbTableVisible && mp3DbPlayerVisible;

  const innerSplitPx = Math.max(120, splitBaseHeightPx - 7);
  const edlPanelHeightPx = innerSplitPx * splitTopFrac;
  const mp3PanelHeightPx = innerSplitPx * (1 - splitTopFrac);
  const splitPanesHeightPx = edlPanelHeightPx + 7 + mp3PanelHeightPx;

  if (!currentUser) {
    return (
      <UserAuthScreen onLoggedIn={handleAuthLoggedIn} />
    );
  }

  return (
    <>
      {currentUser.mustChangePassword ? (
        <ChangePasswordModal
          user={currentUser}
          users={appUsers}
          onUsersUpdated={setAppUsers}
        />
      ) : null}
      <input
        ref={fileInputRef}
        type="file"
        accept={IMPORT_EDL_ACCEPT}
        className="file-input-hidden"
        aria-hidden
        onChange={onInputChange}
      />
      <input
        ref={xlsInputRef}
        type="file"
        accept={IMPORT_XLS_ACCEPT}
        className="file-input-hidden"
        aria-hidden
        onChange={onXlsInputChange}
      />
      <input
        ref={restoreBackupInputRef}
        type="file"
        accept=".zip,application/zip"
        className="file-input-hidden"
        aria-hidden
        onChange={onRestoreBackupFileChange}
      />

      <div className="app-shell" inert={currentUser.mustChangePassword}>
        <MenuBar
          brand="Musiclist"
          sessionUserName={displayName(currentUser)}
          isAdmin={isAdmin}
          onLogout={onLogout}
          onOpenUserManagement={() => setUserManagementOpen(true)}
          onOpenStoragePaths={() => setStoragePathsOpen(true)}
          onDownloadFullBackup={isAdmin ? onDownloadFullBackup : undefined}
          backupDownloadBusy={backupDownloadBusy}
          onRequestRestoreBackup={isAdmin ? onRequestRestoreBackup : undefined}
          restoreBackupBusy={restoreBackupBusy}
          onOpenCustomers={() => setCustomersModalOpen(true)}
          customerViewActive={customerModeActive}
          onToggleCustomerView={() => setCustomerModeActive((v) => !v)}
          onExitCustomerView={() => setCustomerModeActive(false)}
          onSystemSettings={onOpenSystemSettings}
          infoMessage={!error ? infoMessage : null}
          fontScale={fontScale}
          onFontScaleDec={onFontScaleDec}
          onFontScaleInc={onFontScaleInc}
          onFontScaleReset={onFontScaleReset}
          fontScaleDecDisabled={fontScaleDecDisabled}
          fontScaleIncDisabled={fontScaleIncDisabled}
          theme={theme}
          onThemeChange={setTheme}
        />

        <div
          className="split-panes"
          ref={splitPanesRef}
          style={{ height: splitPanesHeightPx, minHeight: splitPanesHeightPx }}
        >
          <section
            className={"panel panel-edl" + (drag ? " panel-edl--drag" : "")}
            style={{ flex: "none", height: edlPanelHeightPx, minHeight: 0 }}
            aria-label={
              playlistAsCustomerExport
                ? "Playlist (Kundenansicht)"
                : "EDL- & Playlist und EDL- & Playlist Browser"
            }
            onDragOver={(e) => {
              e.preventDefault();
              if (!isCustomerUser) setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              if (isCustomerUser) return;
              if (importOverlay) return;
              const f = e.dataTransfer.files[0];
              if (f) void onFile(f);
            }}
          >
            <div className="panel-edl-split-row" ref={edlSplitRowRef}>
              <div
                className="panel-edl-playlist"
                style={{
                  flex:
                    (customerModeActive && !isCustomerUser) || edlAblageCollapsed
                      ? "1 1 0"
                      : `${splitPlaylistVsLibrary} 1 0`,
                  minWidth: 0,
                }}
              >
                <div className="panel-head">
                  <div className="panel-head-title-row panel-head-title-row--mp3">
                    <div className="panel-edl-playlist-title-stack">
                      <div className="panel-mp3-title-cluster">
                        <h2 className="panel-title">
                          {playlistAsCustomerExport ? "Kundenansicht" : "EDL- & Playlist"}
                        </h2>
                        {!playlistAsCustomerExport && edlHiddenColumnIdsSorted.length > 0 && (
                          <div
                            className="panel-mp3-hidden-cols"
                            role="group"
                            aria-label="Ausgeblendete Spalten wieder anzeigen"
                          >
                            {edlHiddenColumnIdsSorted.map((hid) => (
                              <button
                                key={hid}
                                type="button"
                                className="btn-mp3-col-restore"
                                onClick={() => showEdlColumn(hid)}
                              >
                                {getEdlColumnLabel(hid)}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      {playlist && fileName && (
                        <div className="panel-title-meta" aria-label="EDL-Informationen">
                          <span>{fileName}</span>
                          {fileName.toLowerCase().endsWith(".xls") ? (
                            <span className="panel-title-meta-kind"> · XLS</span>
                          ) : null}
                          <span>
                            {" · "}
                            {playlist.length} Einträge (Netto: {netPlaylistTracks})
                          </span>
                          {edlFiltersActiveForPlaylistView && (
                            <span>
                              {" · "}
                              {filteredPlaylistRowIndices.length} angezeigt
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    {!playlistAsCustomerExport ? (
                      <div className="panel-head-edl-actions">
                        <button
                          type="button"
                          className="btn-transfer-mp3"
                          title={
                            hasOfflinePlaylistRows ? TRANSFER_OFFLINE_MP3_TOOLTIP : TRANSFER_TO_MP3_TOOLTIP
                          }
                          disabled={!playlist?.length || exportBusy}
                          onClick={
                            hasOfflinePlaylistRows ? requestOfflineExportFakeMp3s : requestExportFakeMp3s
                          }
                        >
                          {hasOfflinePlaylistRows ? "Transfer offline to mp3" : "Transfer to mp3"}
                        </button>
                        <button
                          type="button"
                          className="btn-transfer-mp3"
                          title={GVL_ABGLEICH_TOOLTIP}
                          disabled={!playlist?.length || exportBusy}
                          onClick={() => void requestGvlAbgleich()}
                        >
                          GVL-Abgleich
                        </button>
                        {isAdmin ? (
                          <button
                            type="button"
                            className="btn-transfer-mp3"
                            title={PLAYLIST_MAIL_TOOLTIP}
                            disabled={!playlist?.length || exportBusy || !fileName}
                            onClick={() => void requestPlaylistMailExport()}
                          >
                            Mail
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="btn-transfer-mp3"
                          title={XLS_EXPORT_TOOLTIP}
                          disabled={!playlist?.length || exportBusy || !fileName}
                          onClick={() => void requestPlaylistXlsExport()}
                        >
                          XLS-Export
                        </button>
                        {playlist && fileName && edlFiltersActiveForPlaylistView && (
                          <button
                            type="button"
                            className="btn-filter-clear-global"
                            onClick={clearAllEdlFilters}
                          >
                            Alle Filter zurücksetzen
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="panel-head-edl-actions panel-head-edl-actions--customer-hint">
                        <span
                          className="customer-view-hint"
                          title="Filter, Sortierung, Spaltenbreite und Reihenfolge; Klick auf Zelle kopiert den Inhalt"
                        >
                          Filter · Sortierung · Spalten · Klick kopiert Zelle
                        </span>
                        {playlist && fileName && edlFiltersActiveForPlaylistView && (
                          <button
                            type="button"
                            className="btn-filter-clear-global"
                            onClick={clearAllEdlFilters}
                          >
                            Alle Filter zurücksetzen
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                <div className="panel-body">
                  {error && <div className="err">{error}</div>}

                  <div className="panel-scroll">
                    {playlist && fileName ? (
                      <div className="table-wrap table-wrap--dense">
                        <table className="table-dense table-resizable">
                          <colgroup ref={edlColGroupRef}>
                            {edlDisplayWidthsArr.map((w, i) => {
                              const last = i === edlDisplayWidthsArr.length - 1;
                              const colId = edlDisplayColumnIds[i]!;
                              const minW = edlResizeMinForColumnId(colId);
                              return (
                                <col
                                  key={colId}
                                  style={
                                    last
                                      ? { width: "auto", minWidth: w }
                                      : { width: w, minWidth: minW }
                                  }
                                />
                              );
                            })}
                          </colgroup>
                          <thead>
                            <tr>
                              {edlDisplayColumnIds.map((colId, j) => {
                                const label = getEdlColumnLabel(colId);
                                const tagTitle = isEdlTagColumnId(colId)
                                  ? AUDIO_TAG_FIELD_LABELS[colId]
                                  : undefined;
                                const thClass = [
                                  isEdlTagColumnId(colId) && "th-tag-field",
                                  playlistAsCustomerExport && "table-th-customer",
                                ]
                                  .filter(Boolean)
                                  .join(" ");
                                return (
                                  <ColumnFilterTh
                                    key={colId}
                                    colIndex={j}
                                    attachResize={attachEdlResize}
                                    className={thClass || undefined}
                                    title={tagTitle}
                                    label={label}
                                    filterValue={edlFilters[colId] ?? ""}
                                    onFilterChange={(v) =>
                                      setEdlFilters((p) => ({ ...p, [colId]: v }))
                                    }
                                    onClearFilter={() =>
                                      setEdlFilters((p) => ({ ...p, [colId]: "" }))
                                    }
                                    ariaLabelFilter={`Filter ${label}`}
                                    columnSort={{
                                      activeDirection:
                                        edlSort?.columnId === colId ? edlSort.direction : null,
                                      onSortAsc: () =>
                                        setEdlSort({ columnId: colId, direction: "asc" }),
                                      onSortDesc: () =>
                                        setEdlSort({ columnId: colId, direction: "desc" }),
                                    }}
                                    columnDrag={{
                                      columnId: colId,
                                      onDragStart: (e) => {
                                        e.dataTransfer.setData(EDL_COL_DRAG_MIME, colId);
                                        e.dataTransfer.setData("text/plain", colId);
                                        e.dataTransfer.effectAllowed = "move";
                                      },
                                      onDragOver: () => {},
                                      onDrop: (e) => {
                                        e.preventDefault();
                                        const from = (
                                          e.dataTransfer.getData(EDL_COL_DRAG_MIME) ||
                                          e.dataTransfer.getData("text/plain")
                                        ) as EdlTableColumnId;
                                        if (!from || from === colId) return;
                                        setEdlColumnOrder((o) =>
                                          reorderEdlColumns(o, edlColumnHidden, from, colId)
                                        );
                                      },
                                      onDragEnd: () => {},
                                    }}
                                    onHideColumn={
                                      playlistAsCustomerExport ? undefined : () => hideEdlColumn(colId)
                                    }
                                    hideColumnDisabled={
                                      playlistAsCustomerExport ? undefined : edlVisibleColumnIds.length <= 1
                                    }
                                  />
                                );
                              })}
                            </tr>
                          </thead>
                          <tbody>
                            {playlist.length === 0 ? (
                              <tr>
                                <td className="tc-empty" colSpan={edlTableColCount}>
                                  Keine Einträge in der EDL.
                                </td>
                              </tr>
                            ) : filteredPlaylistRowIndices.length === 0 ? (
                              <tr>
                                <td className="tc-empty" colSpan={edlTableColCount}>
                                  Keine Treffer für die Filter.
                                </td>
                              </tr>
                            ) : (
                              sortedPlaylistRowIndices.map((i) => {
                                const row = playlist[i];
                                const plMerged = playlistMergedTags[i] ?? {};
                                const linked = row.linkedTrackFileName?.trim();
                                const isOfflinePlaylistRow =
                                  !!linked &&
                                  isMp3FileName(linked) &&
                                  resolveMusicDbPathForBasename(musicDbFileNames, linked) === null;
                                return (
                                  <tr
                                    key={row.id}
                                    className={
                                      [
                                        !playlistAsCustomerExport && "table-tr-clickable",
                                        plMerged.warnung === true && "table-tr-warnung",
                                        !playlistAsCustomerExport && isOfflinePlaylistRow && "table-tr-offline-mp3",
                                        edlSelectedRowIndices.has(i) && "table-tr-selected",
                                        playlistAsCustomerExport && "table-tr-customer",
                                      ]
                                        .filter(Boolean)
                                        .join(" ") || undefined
                                    }
                                    onClick={!playlistAsCustomerExport ? (e) => onEdlRowClick(e, i) : undefined}
                                    onContextMenu={
                                      !playlistAsCustomerExport
                                        ? (e) => {
                                            e.preventDefault();
                                            if (!sortedPlaylistRowIndices.includes(i)) return;
                                            let removeFromListIndices: number[];
                                            if (
                                              edlSelectedRowIndices.has(i) &&
                                              edlSelectedRowIndices.size > 1
                                            ) {
                                              removeFromListIndices = sortedPlaylistRowIndices.filter((idx) =>
                                                edlSelectedRowIndices.has(idx)
                                              );
                                            } else {
                                              setEdlSelectedRowIndices(new Set([i]));
                                              setEdlSelectionAnchorPlaylistIndex(i);
                                              removeFromListIndices = [i];
                                            }
                                            setTagsCtxMenu({
                                              x: e.clientX,
                                              y: e.clientY,
                                              kind: "playlist",
                                              index: i,
                                              removeFromListIndices,
                                            });
                                          }
                                        : undefined
                                    }
                                  >
                                    {edlDisplayColumnIds.map((colId) => {
                                      const cellActive =
                                        playlistAsCustomerExport &&
                                        customerSelectedCells.has(customerCellKey(i, colId));
                                      return (
                                        <td
                                          key={colId}
                                          className={
                                            [
                                              edlDataCellClass(colId),
                                              playlistAsCustomerExport && "table-td-customer-cell",
                                              cellActive && "table-td-customer-cell--active",
                                            ]
                                              .filter(Boolean)
                                              .join(" ") || undefined
                                          }
                                          onClick={
                                            playlistAsCustomerExport
                                              ? (e) => void onCustomerPlaylistCellClick(e, i, colId)
                                              : undefined
                                          }
                                          title={
                                            playlistAsCustomerExport
                                              ? "Klick: Zelle kopieren · Umschalt+Klick: Bereich in der Zeile kopieren (Tab-getrennt) · Strg/Cmd+Klick: Mehrfachauswahl · Strg/Cmd+C: Auswahl kopieren · Esc: Aufheben"
                                              : undefined
                                          }
                                        >
                                          {renderEdlDataCell(colId, row, i, plMerged)}
                                        </td>
                                      );
                                    })}
                                  </tr>
                                );
                              })
                            )}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="panel-empty">
                        Noch keine EDL oder GEMA-XLS geladen — „Funktionen“ › „Import EDL“ oder Datei
                        (.edl / .xls) hierher ziehen.
                      </p>
                    )}
                  </div>

                  {exportBusy && (
                    <p className="export-busy" aria-live="polite">
                      Fake-MP3s werden angelegt …
                    </p>
                  )}
                </div>
              </div>

              {customerModeActive && !isCustomerUser ? null : edlAblageCollapsed ? (
                <button
                  type="button"
                  className="edl-ablage-expand-tab"
                  onClick={() => setEdlAblageCollapsed(false)}
                  aria-label="EDL- & Playlist Browser einblenden"
                  title="EDL- & Playlist Browser einblenden"
                >
                  <span className="edl-ablage-expand-tab-label" aria-hidden>
                    EDL- & Playlist Browser
                  </span>
                  <span className="edl-ablage-expand-tab-chevron" aria-hidden>
                    ‹
                  </span>
                </button>
              ) : (
                <>
                  <div
                    className="split-panes-resizer split-panes-resizer--col"
                    role="separator"
                    aria-orientation="vertical"
                    aria-label="Breite EDL- & Playlist und EDL- & Playlist Browser"
                    tabIndex={0}
                    onMouseDown={onSplitHorizontalMouseDown}
                    onKeyDown={(e) => {
                      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                        e.preventDefault();
                        const step = 0.03;
                        setSplitPlaylistVsLibrary((f) =>
                          e.key === "ArrowLeft"
                            ? Math.max(0.22, f - step)
                            : Math.min(0.82, f + step)
                        );
                      }
                    }}
                  />

                  <div
                    className="panel-edl-archive"
                    style={{ flex: `${1 - splitPlaylistVsLibrary} 1 0`, minWidth: 0 }}
                  >
                    <EdlLibraryPanel
                      library={edlLibraryAccess}
                      refreshKey={edlLibraryRefresh}
                      onOpenLibraryFile={onOpenLibraryFromLibrary}
                      onLibraryChange={() => setEdlLibraryRefresh((k) => k + 1)}
                      deleteClearsPlaylist={deleteWouldClearOpenEdl}
                      onLibraryEntryDeleted={onLibraryEntryDeleted}
                      importTargetSegments={edlImportTargetSegments}
                      onImportTargetChange={setEdlImportTargetSegments}
                      onCollapseAblagePanel={() => setEdlAblageCollapsed(true)}
                      onImportEdl={onImportEdl}
                      importEdlTitle={IMPORT_EDL_TOOLTIP}
                      importEdlDisabled={!!importOverlay}
                      onImportGemaXls={onImportGemaXls}
                      importGemaXlsTitle={IMPORT_XLS_TOOLTIP}
                      importGemaXlsDisabled={!!importOverlay}
                      onEdlFolderRenamed={onEdlFolderRenamed}
                      onEdlFolderMoved={onEdlFolderMoved}
                      readOnly={isCustomerUser}
                      activeLibraryFile={
                        loadedLibraryFile
                          ? {
                              parentSegments: loadedLibraryFile.parentSegments,
                              fileName: loadedLibraryFile.fileName,
                            }
                          : null
                      }
                    />
                  </div>
                </>
              )}
            </div>
          </section>

          <div
            className="split-panes-resizer"
            role="separator"
            aria-orientation="horizontal"
            aria-label="Höhe der Bereiche anpassen"
            tabIndex={0}
            onMouseDown={onSplitResizeMouseDown}
            onKeyDown={(e) => {
              if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                e.preventDefault();
                const step = 0.03;
                setSplitTopFrac((f) =>
                  e.key === "ArrowUp"
                    ? Math.min(SPLIT_TOP_FRAC_MAX, f + step)
                    : Math.max(SPLIT_TOP_FRAC_MIN, f - step)
                );
              }
            }}
          />

          <section
            className={"panel panel-mp3" + (playlistAsCustomerExport ? " panel--customer-wiedergabe" : "")}
            style={{ flex: "none", height: mp3PanelHeightPx, minHeight: 0 }}
            aria-label={playlistAsCustomerExport ? "Wiedergabe und Timeline" : "Musikdatenbank"}
          >
            {playlistAsCustomerExport ? (
              <>
                <div className="panel-head">
                  <div className="panel-head-title-row panel-head-title-row--mp3">
                    <h2 className="panel-title">Wiedergabe &amp; Timeline</h2>
                  </div>
                </div>
                <div className="panel-mp3-customer-player">
                  <div
                    className="panel-mp3-player-wrap"
                    style={{ flex: "1 1 0", minHeight: 0 }}
                  >
                    <MediaPlayerDock
                      playlist={playlist}
                      playlistDocumentTitle={
                        playlist && fileName
                          ? edlTitle?.trim() || basenamePath(fileName)
                          : null
                      }
                      seekToProgramFramesRequest={edlSeekToProgramFramesRequest}
                    />
                  </div>
                </div>
              </>
            ) : (
            <>
            <div className="panel-head">
              <div className="panel-head-title-row panel-head-title-row--mp3">
                <div className="panel-mp3-title-cluster">
                  <h2 className="panel-title">Musikdatenbank</h2>
                  {mp3HiddenColumnIdsSorted.length > 0 && (
                    <div
                      className="panel-mp3-hidden-cols"
                      role="group"
                      aria-label="Ausgeblendete Spalten wieder anzeigen"
                    >
                      {mp3HiddenColumnIdsSorted.map((hid) => (
                        <button
                          key={hid}
                          type="button"
                          className="btn-mp3-col-restore"
                          onClick={() => showMp3Column(hid)}
                        >
                          {getMp3ColumnLabel(hid)}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="panel-head-edl-actions">
                  <div className="menu panel-mp3-tools-menu" ref={mp3DbToolsMenuRef}>
                    <button
                      type="button"
                      className="menu-trigger menu-trigger--hamburger"
                      aria-expanded={mp3DbToolsMenuOpen}
                      aria-haspopup="menu"
                      aria-label="Menü Musikdatenbank"
                      title="Ansicht und Werkzeuge"
                      onClick={() => setMp3DbToolsMenuOpen((o) => !o)}
                    >
                      <span className="hamburger-icon" aria-hidden>
                        <span />
                        <span />
                        <span />
                      </span>
                    </button>
                    {mp3DbToolsMenuOpen && (
                      <div
                        className="menu-dropdown menu-dropdown--align-end menu-dropdown--mp3-tools"
                        role="menu"
                      >
                        <button
                          type="button"
                          className="menu-item"
                          role="menuitem"
                          onClick={() => {
                            setMp3DbToolsMenuOpen(false);
                            setMp3DbTableVisible((v) => !v);
                          }}
                        >
                          {mp3DbTableVisible ? "Musikdatenbank ausblenden" : "Musikdatenbank einblenden"}
                        </button>
                        <button
                          type="button"
                          className="menu-item"
                          role="menuitem"
                          onClick={() => {
                            setMp3DbToolsMenuOpen(false);
                            setMp3DbPlayerVisible((v) => !v);
                          }}
                        >
                          {mp3DbPlayerVisible ? "Videoplayer ausblenden" : "Videoplayer einblenden"}
                        </button>
                        {mp3KnownFromPlaylist.length > 0 && (
                          <>
                            <button
                              type="button"
                              className="menu-item menu-item--border"
                              role="menuitem"
                              disabled={!sessionUserId || musicDbCleanupBusy || mp3RecreateBusy}
                              title={
                                !sessionUserId
                                  ? "Anmeldung erforderlich."
                                  : "Prüft den Server und markiert fehlende MP3s gelb in der Liste (ohne sie zu entfernen)."
                              }
                              onClick={() => {
                                setMp3DbToolsMenuOpen(false);
                                void markMusicDbMissingOnDisk();
                              }}
                            >
                              Fehlende markieren
                            </button>
                            <button
                              type="button"
                              className="menu-item"
                              role="menuitem"
                              disabled={!sessionUserId || musicDbCleanupBusy || mp3RecreateBusy}
                              title={
                                !sessionUserId
                                  ? "Anmeldung erforderlich."
                                  : "Prüft auf dem Server und kann fehlende Einträge aus der Datenbank entfernen."
                              }
                              onClick={() => {
                                setMp3DbToolsMenuOpen(false);
                                void scanMusicDbForOrphans();
                              }}
                            >
                              Fehlende Dateien bereinigen …
                            </button>
                            <button
                              type="button"
                              className="menu-item menu-item--border"
                              role="menuitem"
                              disabled={musicDbCleanupBusy || mp3RecreateBusy}
                              title="Ausgewählte fehlende Einträge: Platzhalter-MP3 mit Tags auf dem Server am gespeicherten Pfad anlegen."
                              onClick={() => {
                                setMp3DbToolsMenuOpen(false);
                                void onMp3RecreatePlaceholderClick();
                              }}
                            >
                              {mp3RecreateBusy ? "Lege an …" : "Fehlende MP3 erstellen"}
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                  {mp3KnownFromPlaylist.length > 0 && hasActiveColumnFiltersRecord(mp3Filters) && (
                    <button
                      type="button"
                      className="btn-filter-clear-global"
                      onClick={clearAllMp3Filters}
                    >
                      Alle Filter zurücksetzen
                    </button>
                  )}
                </div>
              </div>
            </div>
            <div ref={mp3TablePlayerSplitRef} className="panel-mp3-table-player-split">
              {mp3DbTableVisible && (
              <div
                className="panel-body"
                style={{
                  flex: mp3TablePlayerSplitBothVisible ? `${mp3TableTopFrac} 1 0` : "1 1 0",
                  minHeight: 0,
                }}
              >
              <div className="panel-scroll">
                <div className="table-wrap table-wrap--dense">
                  <table className="table-dense table-resizable">
                    <colgroup ref={mp3ColGroupRef}>
                      {mp3VisibleWidthsArr.map((w, i) => {
                        const last = i === mp3VisibleWidthsArr.length - 1;
                        const colId = mp3VisibleColumnIds[i]!;
                        const minW = mp3ResizeMinForColumnId(colId);
                        return (
                          <col
                            key={colId}
                            style={
                              last
                                ? { width: "auto", minWidth: w }
                                : { width: w, minWidth: minW }
                            }
                          />
                        );
                      })}
                    </colgroup>
                    <thead>
                      <tr>
                        {mp3VisibleColumnIds.map((colId, j) => {
                          const label = getMp3ColumnLabel(colId);
                          const tagTitle = isMp3TagColumnId(colId) ? AUDIO_TAG_FIELD_LABELS[colId] : undefined;
                          return (
                            <ColumnFilterTh
                              key={colId}
                              colIndex={j}
                              attachResize={attachMp3Resize}
                              className={isMp3TagColumnId(colId) ? "th-tag-field" : undefined}
                              title={tagTitle}
                              label={label}
                              filterValue={mp3Filters[colId] ?? ""}
                              onFilterChange={(v) =>
                                setMp3Filters((p) => ({ ...p, [colId]: v }))
                              }
                              onClearFilter={() =>
                                setMp3Filters((p) => ({ ...p, [colId]: "" }))
                              }
                              ariaLabelFilter={`Filter ${label}`}
                              columnSort={{
                                activeDirection:
                                  mp3Sort?.columnId === colId ? mp3Sort.direction : null,
                                onSortAsc: () =>
                                  setMp3Sort({ columnId: colId, direction: "asc" }),
                                onSortDesc: () =>
                                  setMp3Sort({ columnId: colId, direction: "desc" }),
                              }}
                              columnDrag={{
                                columnId: colId,
                                onDragStart: (e) => {
                                  e.dataTransfer.setData(MP3_COL_DRAG_MIME, colId);
                                  e.dataTransfer.setData("text/plain", colId);
                                  e.dataTransfer.effectAllowed = "move";
                                },
                                onDragOver: () => {},
                                onDrop: (e) => {
                                  e.preventDefault();
                                  const from = (
                                    e.dataTransfer.getData(MP3_COL_DRAG_MIME) ||
                                    e.dataTransfer.getData("text/plain")
                                  ) as Mp3TableColumnId;
                                  if (!from || from === colId) return;
                                  setMp3ColumnOrder((o) =>
                                    reorderMp3Columns(o, mp3ColumnHidden, from, colId)
                                  );
                                },
                                onDragEnd: () => {},
                              }}
                              onHideColumn={() => hideMp3Column(colId)}
                              hideColumnDisabled={mp3VisibleColumnIds.length <= 1}
                            />
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {mp3KnownFromPlaylist.length === 0 ? (
                        <tr>
                          <td className="tc-empty" colSpan={mp3TableColCount}>
                            Noch keine Einträge.
                          </td>
                        </tr>
                      ) : filteredMp3Names.length === 0 ? (
                        <tr>
                          <td className="tc-empty" colSpan={mp3TableColCount}>
                            Keine Treffer für die Filter.
                          </td>
                        </tr>
                      ) : (
                        sortedMp3Names.map((name) => {
                          const merged = fileMergedTagsByName.get(name) ?? {};
                          const catNo = mp3IndexByName.get(name) ?? 1;
                          const rowMeta = musicDbMetadata[name];
                          return (
                            <tr
                              key={name}
                              className={
                                [
                                  "table-tr-clickable",
                                  merged.warnung === true && "table-tr-warnung",
                                  highlightMp3Name === name && "table-tr-mp3-highlight",
                                  musicDbMissingOnDiskSet.has(name) && "table-tr-music-db-missing",
                                  mp3SelectedNames.has(name) && "table-tr-selected",
                                ]
                                  .filter(Boolean)
                                  .join(" ") || undefined
                              }
                              ref={(el) => {
                                if (el) mp3RowRefs.current.set(name, el);
                                else mp3RowRefs.current.delete(name);
                              }}
                              onClick={(e) => onMp3RowClick(e, name)}
                              onContextMenu={(e) => {
                                e.preventDefault();
                                if (!sortedMp3Names.includes(name)) return;
                                let deleteTargets: string[];
                                if (mp3SelectedNames.has(name) && mp3SelectedNames.size > 1) {
                                  deleteTargets = sortedMp3Names.filter((n) =>
                                    mp3SelectedNames.has(n)
                                  );
                                } else {
                                  setMp3SelectedNames(new Set([name]));
                                  setMp3SelectionAnchorName(name);
                                  deleteTargets = [name];
                                }
                                setTagsCtxMenu({
                                  x: e.clientX,
                                  y: e.clientY,
                                  kind: "file",
                                  fileName: name,
                                  deleteTargets,
                                });
                              }}
                            >
                              {mp3VisibleColumnIds.map((colId) => (
                                <td key={colId} className={mp3DataCellClass(colId)}>
                                  {renderMp3DataCell(colId, name, merged, catNo, rowMeta)}
                                </td>
                              ))}
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
              )}
            {mp3TablePlayerSplitBothVisible && (
            <div
              className="split-panes-resizer"
              role="separator"
              aria-orientation="horizontal"
              aria-label="Höhe zwischen Musikdatenbank und Player anpassen"
              tabIndex={0}
              onMouseDown={onMp3TablePlayerResizeMouseDown}
              onKeyDown={(e) => {
                if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                  e.preventDefault();
                  const step = 0.03;
                  setMp3TableTopFrac((f) =>
                    e.key === "ArrowUp"
                      ? Math.min(MP3_TABLE_TOP_FRAC_MAX, f + step)
                      : Math.max(MP3_TABLE_TOP_FRAC_MIN, f - step)
                  );
                }
              }}
            />
            )}
            {mp3DbPlayerVisible && (
            <div
              className="panel-mp3-player-wrap"
              style={{
                flex: mp3TablePlayerSplitBothVisible ? `${1 - mp3TableTopFrac} 1 0` : "1 1 0",
                minHeight: 0,
              }}
            >
              <MediaPlayerDock
                playlist={playlist}
                playlistDocumentTitle={
                  playlist && fileName
                    ? edlTitle?.trim() || basenamePath(fileName)
                    : null
                }
                seekToProgramFramesRequest={edlSeekToProgramFramesRequest}
              />
            </div>
            )}
            {!mp3DbTableVisible && !mp3DbPlayerVisible && (
              <div className="panel-mp3-both-hidden-hint" role="status">
                Musikdatenbank und Player sind ausgeblendet — über das Menü oben wieder einblenden.
              </div>
            )}
            </div>
            </>
            )}
          </section>
        </div>
      </div>

      {tagsCtxMenu && tagCtxMenuPos && (
        <>
          <div
            className="tags-ctx-backdrop"
            role="presentation"
            aria-hidden
            onPointerDown={() => setTagsCtxMenu(null)}
          />
          <div
            className="tags-ctx-menu"
            role="menu"
            style={{ left: tagCtxMenuPos.left, top: tagCtxMenuPos.top }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="tags-ctx-menu-item"
              role="menuitem"
              onClick={() => {
                const m = tagsCtxMenu;
                setTagsCtxMenu(null);
                if (m?.kind === "playlist") {
                  if (m.removeFromListIndices.length > 1) {
                    openPlaylistTagsMulti(m.removeFromListIndices);
                  } else {
                    openPlaylistTags(m.index);
                  }
                } else if (m?.kind === "file") {
                  if (m.deleteTargets.length > 1) {
                    openFileTagsMulti(m.deleteTargets);
                  } else {
                    openFileTags(m.fileName);
                  }
                }
              }}
            >
              {tagsCtxMenu.kind === "playlist"
                ? tagsCtxMenu.removeFromListIndices.length > 1
                  ? `Tags bearbeiten (${tagsCtxMenu.removeFromListIndices.length}) …`
                  : "Tags bearbeiten"
                : tagsCtxMenu.deleteTargets.length > 1
                  ? `Tags bearbeiten (${tagsCtxMenu.deleteTargets.length}) …`
                  : "Tags bearbeiten"}
            </button>
            {tagsCtxMenu.kind === "playlist" &&
              playlist?.[tagsCtxMenu.index]?.linkedTrackFileName && (
                <>
                  <button
                    type="button"
                    className="tags-ctx-menu-item tags-ctx-menu-item--border"
                    role="menuitem"
                    onClick={() => {
                      const fn = playlist[tagsCtxMenu.index].linkedTrackFileName!;
                      setTagsCtxMenu(null);
                      showTrackInMusicDatabase(fn);
                    }}
                  >
                    Zeige Track in Musikdatenbank
                  </button>
                  <button
                    type="button"
                    className="tags-ctx-menu-item"
                    role="menuitem"
                    title="Kopiert den vollständigen Server-Pfad der MP3 in die Zwischenablage (bei Anmeldung)."
                    onClick={() => {
                      const fn = playlist[tagsCtxMenu.index].linkedTrackFileName!;
                      void copyMp3ServerPathToClipboard(fn);
                    }}
                  >
                    Pfad kopieren
                  </button>
                </>
              )}
            {tagsCtxMenu.kind === "playlist" && (
              <button
                type="button"
                className="tags-ctx-menu-item tags-ctx-menu-item--border"
                role="menuitem"
                onClick={() => {
                  const m = tagsCtxMenu;
                  if (m?.kind !== "playlist") return;
                  setTagsCtxMenu(null);
                  setPlaylistRemoveConfirmIndices(m.removeFromListIndices);
                }}
              >
                {tagsCtxMenu.removeFromListIndices.length === 1
                  ? "Aus der Liste löschen …"
                  : `${tagsCtxMenu.removeFromListIndices.length} Einträge aus der Liste löschen …`}
              </button>
            )}
            {tagsCtxMenu.kind === "file" && (
              <>
                <button
                  type="button"
                  className="tags-ctx-menu-item tags-ctx-menu-item--border"
                  role="menuitem"
                  title={`${P7S1_MUSIKPORTAL_TRACK_RESEARCH_URL} — kopiert zugleich den Suchbegriff (Dateiname bis zum ersten _) in die Zwischenablage.`}
                  onClick={() => {
                    const fileName = tagsCtxMenu.fileName;
                    setTagsCtxMenu(null);
                    openP7S1MusikportalWithOptionalClip(fileName);
                  }}
                >
                  P7S1-Musikportal öffnen
                </button>
                <button
                  type="button"
                  className="tags-ctx-menu-item"
                  role="menuitem"
                  title="Kopiert den vollständigen Server-Pfad der MP3 in die Zwischenablage (bei Anmeldung)."
                  onClick={() => {
                    const fileName = tagsCtxMenu.fileName;
                    void copyMp3ServerPathToClipboard(fileName);
                  }}
                >
                  Pfad kopieren
                </button>
                {sessionUserId && isAdmin && (
                  <button
                    type="button"
                    className="tags-ctx-menu-item tags-ctx-menu-item--border tags-ctx-menu-item--danger"
                    role="menuitem"
                    onClick={() => {
                      const m = tagsCtxMenu;
                      if (m?.kind !== "file") return;
                      setTagsCtxMenu(null);
                      setMp3DeleteConfirmTargets(m.deleteTargets);
                    }}
                  >
                    {tagsCtxMenu.deleteTargets.length === 1
                      ? "MP3-Datei löschen …"
                      : `${tagsCtxMenu.deleteTargets.length} MP3-Dateien löschen …`}
                  </button>
                )}
              </>
            )}
          </div>
        </>
      )}

      {tagModalLoadBusy && (
        <div
          className="modal-backdrop modal-backdrop--tag-editor"
          role="status"
          aria-live="polite"
          aria-busy="true"
        >
          <div className="modal modal--tag-loading" onMouseDown={(e) => e.stopPropagation()}>
            <p className="modal-lead modal-lead--tag-loading">Metadaten werden geladen …</p>
          </div>
        </div>
      )}
      {tagModal && !tagModalLoadBusy && (
        <TagEditorModal
          open
          multiTrack={
            tagModal.kind === "playlistMulti" || tagModal.kind === "fileMulti"
          }
          heading={
            tagModal.kind === "playlistMulti"
              ? `Tags — ${tagModal.indices.length} Einträge gleichzeitig`
              : tagModal.kind === "fileMulti"
                ? `Tags — ${tagModal.fileNames.length} Dateien gleichzeitig`
                : tagModal.kind === "playlist"
                  ? `Tags — Zeile ${tagModal.index + 1}`
                  : `Tags — ${tagModal.fileName}`
          }
          initial={tagEditInitial}
          gvlLabelDb={gvlLabelDb}
          p7SearchSource={
            tagModal.kind === "playlistMulti" || tagModal.kind === "fileMulti"
              ? null
              : tagModal.kind === "playlist" && playlist
                ? playlist[tagModal.index]?.linkedTrackFileName ??
                  playlist[tagModal.index]?.title ??
                  null
                : tagModal.kind === "file"
                  ? tagModal.fileName
                  : null
          }
          gvlApplyFromDb={
            tagModal.kind === "playlistMulti" || tagModal.kind === "fileMulti" ? null : gvlApplyToTag
          }
          showGvlDatabaseButton={isAdmin}
          onOpenGvlDatabase={onOpenSystemSettings}
          onClose={closeTagModal}
          onSave={saveTagModal}
        />
      )}

      <StoragePathsModal
        open={storagePathsOpen}
        onClose={() => setStoragePathsOpen(false)}
        edlLibraryAvailable={sessionUserId !== null}
      />

      {gvlSyncModalOpen && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby={
            gvlSyncModalPhase === "queue" ? "gvl-sync-wizard-title" : "gvl-sync-missing-title"
          }
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) handleGvlSyncBackdrop();
          }}
        >
          <div
            className="modal modal--transfer-list-confirm modal--gvl-sync"
            onMouseDown={(e) => e.stopPropagation()}
          >
            {gvlSyncModalPhase === "queue" &&
              gvlSyncWizard &&
              (() => {
                const cur = gvlSyncWizard.items[gvlSyncWizard.index];
                const flags = gvlSyncFieldMismatchFlags(cur.before, cur.after);
                return (
                  <>
                    <h2 id="gvl-sync-wizard-title" className="modal-title">
                      GVL-Abgleich
                    </h2>
                    <p className="modal-lead modal-lead--muted">
                      Änderung {gvlSyncWizard.index + 1} von {gvlSyncWizard.items.length}
                    </p>
                    <p className="gvl-sync-path mono-cell">{cur.displayPath}</p>
                    <p className="gvl-sync-legend modal-lead--muted">
                      Der Abgleich vergleicht nur{" "}
                      <span className="gvl-sync-legend-em">Label</span>,{" "}
                      <span className="gvl-sync-legend-em">Hersteller</span> und{" "}
                      <span className="gvl-sync-legend-em">Rechterückruf</span> mit der GVL — nicht den
                      Labelcode.{" "}
                      <span className="gvl-sync-legend-swatch gvl-sync-legend-swatch--reason" /> rot: davon
                      weicht die Datei ab (wird bei „Übernehmen“ gesetzt).{" "}
                      <span className="gvl-sync-legend-swatch gvl-sync-legend-swatch--labelcode" /> gelb: nur
                      unterschiedliche Schreibweise des Labelcodes (z.&nbsp;B. „LC …“), ohne Einfluss auf den
                      Abgleich.
                    </p>
                    <table className="gvl-sync-compare-table">
                      <thead>
                        <tr>
                          <th>Feld</th>
                          <th>Vorher</th>
                          <th>Nachher</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(
                          [
                            ["Labelcode", "labelcode"],
                            ["Label", "label"],
                            ["Hersteller", "hersteller"],
                            ["Rechterückruf", "gvlRechte"],
                          ] as const
                        ).map(([label, key]) => {
                          const b = cur.before[key];
                          const a = cur.after[key];
                          const mismatch = flags[key];
                          const rowClass =
                            mismatch && key === "labelcode"
                              ? "gvl-sync-diff--labelcode-display"
                              : mismatch
                                ? "gvl-sync-diff--reason"
                                : undefined;
                          const rowTitle = mismatch
                            ? key === "labelcode"
                              ? "Nur Schreibweise — der Abgleich betrifft Label, Hersteller und Rechterückruf."
                              : "Abweichung von der GVL — wird beim Übernehmen aus der GVL übernommen."
                            : undefined;
                          return (
                            <tr key={key} className={rowClass} title={rowTitle}>
                              <td>{label}</td>
                              <td className="mono-cell">{b || "—"}</td>
                              <td className="mono-cell">{a || "—"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    <div className="modal-actions">
                      <button
                        type="button"
                        className="btn-modal"
                        onClick={() => handleGvlSyncQueueDecision(false)}
                      >
                        Änderung nicht übernehmen
                      </button>
                      <button
                        type="button"
                        className="btn-modal primary"
                        onClick={() => handleGvlSyncQueueDecision(true)}
                      >
                        Änderung übernehmen
                      </button>
                    </div>
                  </>
                );
              })()}
            {(gvlSyncModalPhase === "missing" || gvlSyncModalPhase === "missingOnly") && (
              <>
                <h2 id="gvl-sync-missing-title" className="modal-title">
                  Hinweis: Labelcodes nicht in der GVL
                </h2>
                <pre
                  className="modal-lead"
                  style={{ whiteSpace: "pre-wrap", maxHeight: "min(50vh, 24rem)", overflow: "auto" }}
                >
                  {gvlSyncReportText}
                </pre>
                <div className="modal-actions">
                  <button type="button" className="btn-modal primary" onClick={handleGvlSyncMissingOk}>
                    OK
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {systemSettingsOpen && (
        <SystemSettingsModal
          open
          currentDb={gvlLabelDb}
          onClose={() => setSystemSettingsOpen(false)}
          onImportDone={onImportGvlDb}
          onApplyEntryToTag={tagModal ? applyGvlRowToOpenTag : undefined}
        />
      )}

      {userManagementOpen && isAdmin && (
        <UserManagementModal
          open
          onClose={() => setUserManagementOpen(false)}
          users={appUsers}
          onUsersUpdated={setAppUsers}
          currentUserId={currentUser.id}
        />
      )}

      {customersModalOpen && isAdmin && (
        <CustomersModal open onClose={() => setCustomersModalOpen(false)} />
      )}

      {transferCustomerModalOpen && isAdmin && (
        <TransferCustomerModal
          open
          onClose={closeTransferCustomerModal}
          onConfirm={onTransferCustomerConfirmed}
        />
      )}

      {playlistMailPayload && isAdmin && (
        <PlaylistMailModal
          open
          onClose={() => setPlaylistMailPayload(null)}
          attachmentBase64={playlistMailPayload.attachmentBase64}
          attachmentFileName={playlistMailPayload.attachmentFileName}
          defaultSubject={playlistMailPayload.defaultSubject}
          defaultBody={playlistMailPayload.defaultBody}
          mailAssignment={playlistMailPayload.mailAssignment}
          initialCustomerId={playlistMailPayload.initialCustomerId}
          customerMissingHint={playlistMailPayload.customerMissingHint}
        />
      )}

      {transferListConfirmOpen && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="transfer-list-confirm-title"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setTransferListConfirmOpen(false);
          }}
        >
          <div className="modal modal--transfer-list-confirm" onMouseDown={(e) => e.stopPropagation()}>
            <h2 id="transfer-list-confirm-title" className="modal-title">
              Transfer erneut ausführen?
            </h2>
            <p className="modal-lead">
              Die geöffnete Datei ist eine Playlist (<span className="mono-cell">.list</span> /{" "}
              <span className="mono-cell">.egpl</span>) — die MP3-Verknüpfungen sind darin bereits
              gespeichert. Der Export wurde in der Regel schon einmal durchgeführt. Sie können ihn
              wiederholen (z. B. fehlende Dateien, Konflikte).
            </p>
            <div className="modal-actions">
              <button
                type="button"
                className="btn-modal"
                onClick={() => setTransferListConfirmOpen(false)}
              >
                Abbrechen
              </button>
              <button
                type="button"
                className="btn-modal primary"
                onClick={() => {
                  setTransferListConfirmOpen(false);
                  void onExportFakeMp3s();
                }}
              >
                Fortfahren
              </button>
            </div>
          </div>
        </div>
      )}

      {playlistRemoveConfirmIndices && playlistRemoveConfirmIndices.length > 0 && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="playlist-remove-confirm-title"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setPlaylistRemoveConfirmIndices(null);
          }}
        >
          <div className="modal modal--transfer-list-confirm" onMouseDown={(e) => e.stopPropagation()}>
            <h2 id="playlist-remove-confirm-title" className="modal-title">
              {playlistRemoveConfirmIndices.length === 1
                ? "Eintrag aus der Liste entfernen?"
                : `${playlistRemoveConfirmIndices.length} Einträge aus der Liste entfernen?`}
            </h2>
            <p className="modal-lead">
              Die gewählten Zeilen werden aus dieser Playlist entfernt. Verknüpfte MP3-Dateien und
              Einträge in der Musikdatenbank werden nicht gelöscht; nur die Zeilen-Tags dieser Liste
              gehen verloren.
            </p>
            <ul className="modal-delete-mp3-list mono-cell">
              {playlistRemoveConfirmIndices.slice(0, 14).map((idx) => {
                const row = playlist?.[idx];
                const label = row
                  ? row.linkedTrackFileName ?? row.title
                  : `Zeile ${idx + 1}`;
                return <li key={idx}>{label}</li>;
              })}
            </ul>
            {playlistRemoveConfirmIndices.length > 14 && (
              <p className="modal-lead modal-lead--muted">
                … und {playlistRemoveConfirmIndices.length - 14} weitere
              </p>
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="btn-modal"
                onClick={() => setPlaylistRemoveConfirmIndices(null)}
              >
                Abbrechen
              </button>
              <button
                type="button"
                className="btn-modal primary btn-modal--danger"
                onClick={() => {
                  const t = playlistRemoveConfirmIndices;
                  setPlaylistRemoveConfirmIndices(null);
                  if (t?.length) removePlaylistRowsFromList(t);
                }}
              >
                Entfernen
              </button>
            </div>
          </div>
        </div>
      )}

      {mp3RecreateBasenameConfirmPaths && mp3RecreateBasenameConfirmPaths.length > 0 && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="mp3-recreate-basename-title"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setMp3RecreateBasenameConfirmPaths(null);
          }}
        >
          <div className="modal modal--transfer-list-confirm" onMouseDown={(e) => e.stopPropagation()}>
            <h2 id="mp3-recreate-basename-title" className="modal-title">
              MP3(s) auf dem Server anlegen?
            </h2>
            <p className="modal-lead">
              Mindestens ein ausgewählter Eintrag hat nur einen Dateinamen ohne Unterordner im
              gespeicherten Pfad — die Datei wird dann im{" "}
              <strong>Stammordner</strong> der Server-Musikdatenbank angelegt. Einträge mit
              Pfad wie <span className="mono-cell">Projekt/Titel.mp3</span> werden im entsprechenden
              Unterordner erzeugt; fehlende Ordner werden angelegt. Es werden Platzhalter-MP3s mit den
              in der Tabelle angezeigten Tags geschrieben (kein echtes Audio).
            </p>
            <ul className="modal-delete-mp3-list mono-cell">
              {mp3RecreateBasenameConfirmPaths.slice(0, 14).map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
            {mp3RecreateBasenameConfirmPaths.length > 14 && (
              <p className="modal-lead modal-lead--muted">
                … und {mp3RecreateBasenameConfirmPaths.length - 14} weitere
              </p>
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="btn-modal"
                onClick={() => setMp3RecreateBasenameConfirmPaths(null)}
              >
                Abbrechen
              </button>
              <button
                type="button"
                className="btn-modal primary"
                onClick={() => {
                  const paths = mp3RecreateBasenameConfirmPaths;
                  setMp3RecreateBasenameConfirmPaths(null);
                  if (paths?.length) void runRecreatePlaceholderMp3Job(paths);
                }}
              >
                Anlegen
              </button>
            </div>
          </div>
        </div>
      )}

      {musicDbOrphanConfirmPaths && musicDbOrphanConfirmPaths.length > 0 && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="music-db-orphan-confirm-title"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setMusicDbOrphanConfirmPaths(null);
          }}
        >
          <div className="modal modal--transfer-list-confirm" onMouseDown={(e) => e.stopPropagation()}>
            <h2 id="music-db-orphan-confirm-title" className="modal-title">
              {musicDbOrphanConfirmPaths.length === 1
                ? "Einen Eintrag ohne Datei entfernen?"
                : `${musicDbOrphanConfirmPaths.length} Einträge ohne Datei entfernen?`}
            </h2>
            <p className="modal-lead">
              Diese Pfade sind in der Musikdatenbank gespeichert, aber auf dem Server gibt es dazu keine
              MP3-Datei. Die Einträge werden aus der Datenbank entfernt (Index, keine Dateilöschung).
              Playlist-Verknüpfungen bleiben erhalten; betroffene Zeilen erscheinen weiß markiert, solange
              keine MP3 in der DB.
            </p>
            <ul className="modal-delete-mp3-list mono-cell">
              {musicDbOrphanConfirmPaths.slice(0, 14).map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
            {musicDbOrphanConfirmPaths.length > 14 && (
              <p className="modal-lead modal-lead--muted">
                … und {musicDbOrphanConfirmPaths.length - 14} weitere
              </p>
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="btn-modal"
                onClick={() => setMusicDbOrphanConfirmPaths(null)}
              >
                Abbrechen
              </button>
              <button
                type="button"
                className="btn-modal primary"
                onClick={() => {
                  const t = musicDbOrphanConfirmPaths;
                  setMusicDbOrphanConfirmPaths(null);
                  if (!t?.length) return;
                  void purgeMusicDbEntriesFromState(t, "orphan-index");
                  setInfoMessage(
                    t.length === 1
                      ? "Ein Eintrag ohne Datei wurde aus der Musikdatenbank entfernt."
                      : `${t.length} Einträge ohne Datei wurden aus der Musikdatenbank entfernt.`
                  );
                }}
              >
                Aus Datenbank entfernen
              </button>
            </div>
          </div>
        </div>
      )}

      {mp3DeleteConfirmTargets && mp3DeleteConfirmTargets.length > 0 && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="mp3-delete-confirm-title"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setMp3DeleteConfirmTargets(null);
          }}
        >
          <div className="modal modal--transfer-list-confirm" onMouseDown={(e) => e.stopPropagation()}>
            <h2 id="mp3-delete-confirm-title" className="modal-title">
              {mp3DeleteConfirmTargets.length === 1
                ? "MP3-Datei löschen?"
                : `${mp3DeleteConfirmTargets.length} MP3-Dateien löschen?`}
            </h2>
            <p className="modal-lead">
              Die gewählten Dateien werden auf dem Server unwiderruflich gelöscht (nur Administratoren).
              Die Einträge verschwinden aus der Musikdatenbank. Playlist-Zeilen mit Verknüpfung bleiben
              bestehen (weiß markiert, wenn die MP3 nicht mehr in der DB); Metadaten in der Playlist
              bleiben erhalten.
            </p>
            <ul className="modal-delete-mp3-list mono-cell">
              {mp3DeleteConfirmTargets.slice(0, 14).map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
            {mp3DeleteConfirmTargets.length > 14 && (
              <p className="modal-lead modal-lead--muted">
                … und {mp3DeleteConfirmTargets.length - 14} weitere
              </p>
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="btn-modal"
                onClick={() => setMp3DeleteConfirmTargets(null)}
              >
                Abbrechen
              </button>
              <button
                type="button"
                className="btn-modal primary btn-modal--danger"
                onClick={() => {
                  const t = mp3DeleteConfirmTargets;
                  setMp3DeleteConfirmTargets(null);
                  if (t?.length) void confirmMp3DeleteAction(t);
                }}
              >
                Löschen
              </button>
            </div>
          </div>
        </div>
      )}

      {dupModal && (
        <div
          className="modal-backdrop modal-backdrop--dup-wide"
          role="dialog"
          aria-modal="true"
          aria-labelledby="dup-modal-title"
        >
          <div className="modal modal--dup">
            <header className="modal-dup-header">
              <h2 id="dup-modal-title" className="modal-title">
                Datensatz möglicherweise vorhanden
              </h2>
              <span className="modal-dup-header-question" role="note">
                Sind das dieselben Titel?
              </span>
              <p className="modal-lead modal-lead--dup-inline">
                Es existiert bereits eine MP3 mit gleichem oder sehr ähnlichem Namen.
              </p>
            </header>
            <div className="modal-dup-scroll">
              <div className="modal-compare modal-compare--dup modal-dup-split">
                <div className="modal-dup-candidate-block modal-dup-candidate-block--new">
                  <p className="modal-dup-candidate-hint">Neuer / geplanter Dateiname</p>
                  <div className="modal-dup-grid modal-dup-grid--inline">
                    <div className="modal-dup-pathfile-col">
                      <div className="modal-dup-path-filename-line">
                        <span
                          className="modal-dup-dir modal-dup-dir--empty"
                          title="Noch kein Speicherort — die MP3 entsteht erst beim Transfer."
                        >
                          —
                        </span>
                        <span className="modal-dup-filename">{dupModal.proposedFileName}</span>
                      </div>
                    </div>
                    <div className="modal-dup-cell modal-dup-cell--action modal-dup-cell--action-spacer" />
                  </div>
                  <DupModalTagFields
                    fieldIdPrefix="dup-new"
                    tags={dupTagDraftProposed}
                    onTagsChange={setDupTagDraftProposed}
                  />
                </div>

                <p className="modal-dup-section-title modal-dup-hits-title">Treffer in der Musikdatenbank</p>
                {dupModal.candidates.map((c, hitIdx) => {
                  const sp = splitPathForDupModal(c.existingFileName);
                  return (
                    <div className="modal-dup-candidate-block" key={c.existingFileName}>
                      <p className="modal-dup-candidate-hint">
                        {c.kind === "exact"
                          ? "Exakter Dateiname"
                          : "Vermutlich gleicher Titel (ähnlicher Dateiname)"}
                      </p>
                      <div className="modal-dup-grid modal-dup-grid--inline">
                        <div className="modal-dup-pathfile-col">
                          <div className="modal-dup-path-filename-line">
                            <span
                              className="modal-dup-dir"
                              title={sp.dir.trim() ? sp.dir : undefined}
                            >
                              {sp.dir.trim() ? sp.dir : "—"}
                            </span>
                            <span className="modal-dup-filename">
                              {sp.base || basenamePath(c.existingFileName)}
                            </span>
                          </div>
                        </div>
                        <div className="modal-dup-cell modal-dup-cell--action">
                          <button
                            type="button"
                            className="btn-modal primary"
                            onClick={() =>
                              resolveDuplicate({
                                action: "identical",
                                existingFileName: c.existingFileName,
                                proposedTagsEdited: dupDraftFormToPersistedTags(dupTagDraftProposed),
                                existingFileTagsEdited: dupDraftFormToPersistedTags(
                                  dupTagDraftCandidates[c.existingFileName] ?? {}
                                ),
                              })
                            }
                          >
                            Ist identisch
                          </button>
                        </div>
                      </div>
                      <DupModalTagFields
                        fieldIdPrefix={`dup-hit-${hitIdx}`}
                        tags={dupTagDraftCandidates[c.existingFileName] ?? {}}
                        onTagsChange={(next) =>
                          setDupTagDraftCandidates((prev) => ({
                            ...prev,
                            [c.existingFileName]: next,
                          }))
                        }
                        diffBaseline={dupTagDraftProposed}
                      />
                    </div>
                  );
                })}
              </div>
              <label className="dup-apply-all">
                <input
                  type="checkbox"
                  checked={dupApplyAllChecked}
                  onChange={(e) => setDupApplyAllChecked(e.target.checked)}
                />
                <span>Für alle übernehmen</span>
                <span className="dup-apply-all-hint">(nur Testumgebung)</span>
              </label>
            </div>
            <div className="modal-actions modal-actions--dup">
              <button
                type="button"
                className="btn-modal"
                onClick={() =>
                  resolveDuplicate({
                    action: "different",
                    proposedTagsEdited: dupDraftFormToPersistedTags(dupTagDraftProposed),
                  })
                }
              >
                Ist nicht identisch
              </button>
            </div>
          </div>
        </div>
      )}

      {importOverlay && (
        <div
          className="import-progress-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="import-progress-title"
          aria-busy="true"
        >
          <div className="import-progress-dialog">
            <p id="import-progress-title" className="import-progress-label">
              {importOverlay.label}
            </p>
            <div className="import-progress-track" role="progressbar" aria-valuenow={importOverlay.progress} aria-valuemin={0} aria-valuemax={100}>
              <div
                className="import-progress-fill"
                style={{ width: `${importOverlay.progress}%` }}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
