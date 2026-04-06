import type { Worksheet } from "exceljs";
import type { AudioTags } from "../audio/audioTags";
import { getEdlColumnLabel, type EdlTableColumnId } from "../edlTableLayout";
import { basenamePath, sanitizeFilenameStem } from "../tracks/sanitizeFilename";
import { buildEdlRowCellsMap } from "../tableFilters";
import type { PlaylistEntry } from "./types";

/** Kunden-/Fallback-Ansicht: feste GEMA-Reihenfolge. */
export const CUSTOMER_GEMA_COLUMN_IDS: EdlTableColumnId[] = [
  "num",
  "tcIn",
  "tcOut",
  "duration",
  "songTitle",
  "artist",
  "album",
  "composer",
  "comment",
  "isrc",
  "labelcode",
  "label",
  "hersteller",
  "gvlRechte",
];

/** Feste Spaltenreihenfolge wie in der Kundenansicht / Fallback-XLSX. */
export function exportPlaylistColumnIds(_visibleColumnIds: EdlTableColumnId[]): EdlTableColumnId[] {
  return [...CUSTOMER_GEMA_COLUMN_IDS];
}

/** Spaltenbreiten wie in typischen GEMA-Exporten (Referenz: EHZV_Episode100_GEMA_export.xlsx). */
const REF_COL_WIDTHS = [
  4.75, 14.625, 13.6875, 13.8125, 31.625, 30.8125, 23.0625, 53.1875, 21.875, 18.875, 14.1875, 19.3125, 40.75,
  19.375,
];

const BORDER_THIN = {
  top: { style: "thin" as const, color: { argb: "FFBFBFBF" } },
  left: { style: "thin" as const, color: { argb: "FFBFBFBF" } },
  bottom: { style: "thin" as const, color: { argb: "FFBFBFBF" } },
  right: { style: "thin" as const, color: { argb: "FFBFBFBF" } },
};

/** Wie `table-tr-warnung`: Zeile mit aktivierter Warnung (manuell oder R3-Regel). */
const WARN_ROW_FILL = {
  type: "pattern" as const,
  pattern: "solid" as const,
  fgColor: { argb: "FFFFCDD2" },
};

function idxToColLetter(n: number): string {
  let s = "";
  let n1 = n + 1;
  while (n1 > 0) {
    const rem = (n1 - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n1 = Math.floor((n1 - 1) / 26);
  }
  return s;
}

export function suggestedPlaylistExportFileName(loadedFileName: string): string {
  const base = basenamePath(loadedFileName);
  const stem = base.replace(/\.(edl|list|egpl|xls|xlsx)$/i, "") || base;
  const safe = sanitizeFilenameStem(stem);
  return `${safe}_export.xlsx`;
}

function setColumnWidths(ws: Worksheet, numCols: number): void {
  for (let c = 1; c <= numCols; c++) {
    const w = REF_COL_WIDTHS[(c - 1) % REF_COL_WIDTHS.length] ?? 18;
    ws.getColumn(c).width = w;
  }
}

function writeBufferToArrayBuffer(buf: unknown): ArrayBuffer {
  if (buf instanceof ArrayBuffer) return buf;
  if (buf instanceof Uint8Array) {
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  }
  return new Uint8Array(buf as ArrayBufferLike).buffer;
}

/**
 * Baut die XLSX-Datei wie `exportPlaylistViewToXlsx` und liefert Rohdaten (z. B. Mail-Anhang).
 */
export async function buildPlaylistExportXlsxBuffer(
  visibleColumnIds: EdlTableColumnId[],
  sortedRowIndices: number[],
  playlist: PlaylistEntry[],
  playlistMergedTags: AudioTags[],
  loadedFileName: string
): Promise<{ fileName: string; buffer: ArrayBuffer }> {
  const ExcelJS = (await import("exceljs")).default;
  const exportColumnIds = exportPlaylistColumnIds(visibleColumnIds);
  const header = exportColumnIds.map((id) => getEdlColumnLabel(id));
  const dataRows: (string | number)[][] = sortedRowIndices.map((i) => {
    const row = playlist[i]!;
    const merged = playlistMergedTags[i] ?? {};
    const cells = buildEdlRowCellsMap(row, i, merged);
    return exportColumnIds.map((colId) => {
      if (colId === "num") return i + 1;
      return cells[colId] ?? "";
    });
  });
  const dataWarnFlags = sortedRowIndices.map((i) => playlistMergedTags[i]?.warnung === true);

  const numCols = Math.max(exportColumnIds.length, 1);
  const lastLetter = idxToColLetter(numCols - 1);
  const base = basenamePath(loadedFileName);
  const stem = sanitizeFilenameStem(base.replace(/\.(edl|list|egpl|xls|xlsx)$/i, "") || base);
  const outName = suggestedPlaylistExportFileName(loadedFileName);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Playlist", {
    views: [{ zoomScale: 55 }],
  });

  const titleFont = { name: "Arial", size: 18, bold: true, color: { argb: "FF000000" } };
  const labelFont = { name: "Arial", size: 14, color: { argb: "FF000000" } };

  if (numCols >= 2) {
    ws.mergeCells(`A1:B1`);
    ws.getCell("A1").value = "Titel:";
    ws.mergeCells(`C1:${lastLetter}1`);
    ws.getCell("C1").value = stem;
    ws.mergeCells(`A2:B2`);
    ws.getCell("A2").value = "Erstellt am:";
    ws.mergeCells(`C2:${lastLetter}2`);
    const c2 = ws.getCell("C2");
    c2.value = new Date();
    c2.numFmt = "dd.mm.yyyy";
    ws.getCell("A1").font = titleFont;
    ws.getCell("A1").alignment = { vertical: "middle", horizontal: "left" };
    ws.getCell("C1").font = titleFont;
    ws.getCell("C1").alignment = { vertical: "middle", horizontal: "left" };
    ws.getCell("A2").font = labelFont;
    ws.getCell("A2").alignment = { vertical: "middle", horizontal: "left" };
    ws.getCell("C2").font = labelFont;
    ws.getCell("C2").alignment = { vertical: "middle", horizontal: "left" };
  } else {
    ws.getCell("A1").value = `Titel: ${stem}`;
    ws.getCell("A1").font = titleFont;
    ws.getCell("A1").alignment = { vertical: "middle", horizontal: "left" };
    const dateStr = new Intl.DateTimeFormat("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(new Date());
    ws.getCell("A2").value = `Erstellt am: ${dateStr}`;
    ws.getCell("A2").font = labelFont;
    ws.getCell("A2").alignment = { vertical: "middle", horizontal: "left" };
  }

  ws.getRow(1).height = 30;
  ws.getRow(2).height = 23.65;
  ws.getRow(3).height = 15;

  const headerRowIndex = 4;
  const headerRow = ws.getRow(headerRowIndex);
  headerRow.height = 39.75;
  header.forEach((text, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = text;
    cell.font = { name: "Arial", size: 14, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF808080" } };
    cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
    cell.border = BORDER_THIN;
  });

  dataRows.forEach((cells, r) => {
    const row = ws.getRow(headerRowIndex + 1 + r);
    row.height = 25.05;
    const warn = dataWarnFlags[r] === true;
    cells.forEach((val, c) => {
      const cell = row.getCell(c + 1);
      cell.value = val;
      if (typeof val === "number") {
        cell.numFmt = "0";
      }
      cell.font = { name: "Arial", size: 12, color: { argb: "FF000000" } };
      cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
      cell.border = BORDER_THIN;
      if (warn) {
        cell.fill = { ...WARN_ROW_FILL };
      }
    });
  });

  setColumnWidths(ws, numCols);

  const raw = await wb.xlsx.writeBuffer();
  return { fileName: outName, buffer: writeBufferToArrayBuffer(raw) };
}

/**
 * Exportiert die Playlist (Sortierung, Filter wie in der Ansicht; ohne „Titel / Quelle“ und „Jahr“;
 * Spalte # als Zahl; Zeilen mit Warnung pastellrot) im GEMA-/Listen-Stil: Titelleiste, Datum, Kopfzeile, Rahmen.
 */
export async function exportPlaylistViewToXlsx(
  visibleColumnIds: EdlTableColumnId[],
  sortedRowIndices: number[],
  playlist: PlaylistEntry[],
  playlistMergedTags: AudioTags[],
  loadedFileName: string
): Promise<void> {
  const { fileName, buffer } = await buildPlaylistExportXlsxBuffer(
    visibleColumnIds,
    sortedRowIndices,
    playlist,
    playlistMergedTags,
    loadedFileName
  );
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}
