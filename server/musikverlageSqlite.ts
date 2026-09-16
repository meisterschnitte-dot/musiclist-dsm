import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import Database from "better-sqlite3";
import type { MusikverlagId } from "../src/musikverlage/musikverlageCatalog";
import {
  bmgpmRowKeyFromRow,
  bmgpmRowToTagPayload,
  extractBmgpmCatalogCodeFromFileName,
  findBmgpmHeaderRowIndex,
  formatBmgpmHeaderPreview,
  parseBmgpmHeaderRow,
  parseBmgpmReleaseDate,
  type BmgpmHeaderMap,
} from "../src/musikverlage/bmgpmTable";
import {
  parseWcpmHeaderRow,
  wcpmFilenameStem,
  wcpmFilenameStemAlnumKey,
  wcpmFilenameStemMatchKey,
  wcpmRowToTagPayload,
  type WcpmTagPayload,
} from "../src/musikverlage/wcpmTable";

export type RebuildMusikverlagDbOptions = {
  uploadMode?: "replace" | "append";
  /** Bei append: nur diese Datei einlesen (inkrementell nach Release-Datum). */
  appendSourcePath?: string;
};
import { getDataDir } from "./userStore";

const requireXlsx = createRequire(import.meta.url);
const XLSX = requireXlsx("xlsx") as typeof import("xlsx");
const ExcelJS = requireXlsx("exceljs") as typeof import("exceljs");

const DB_DIR = () => path.join(getDataDir(), "musikverlage", "db");

/** Eine SQLite-Datei pro Musikverlag mit hochgeladener Excel-Tabelle. */
export function sqlitePathForMusikverlag(id: MusikverlagId): string {
  return path.join(DB_DIR(), `${id}.sqlite`);
}

function sqliteSidecarPaths(id: MusikverlagId): string[] {
  const p = sqlitePathForMusikverlag(id);
  return [p, `${p}-wal`, `${p}-shm`];
}

export function removeMusikverlagSqliteDb(id: MusikverlagId): void {
  for (const p of sqliteSidecarPaths(id)) {
    try {
      fs.unlinkSync(p);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  }
}

export function musikverlagSqliteExists(id: MusikverlagId): boolean {
  const p = sqlitePathForMusikverlag(id);
  try {
    const st = fs.statSync(p);
    if (st.isFile() && st.size > 0) return true;
  } catch {
    /* continue */
  }
  try {
    return fs.statSync(`${p}-wal`).isFile();
  } catch {
    return false;
  }
}

function checkpointAndClose(db: InstanceType<typeof Database>): void {
  try {
    db.pragma("wal_checkpoint(TRUNCATE)");
  } catch {
    /* ignore */
  }
  try {
    db.close();
  } catch {
    /* bereits geschlossen */
  }
}

export function countRowsInMusikverlagDb(id: MusikverlagId): number | null {
  if (!musikverlagSqliteExists(id)) return null;
  try {
    // Nicht readonly: WAL muss eingespielt werden, sonst wirkt die DB leer.
    const db = new Database(sqlitePathForMusikverlag(id));
    try {
      const fmt = db.prepare("SELECT v FROM meta WHERE k = ?").get("format") as { v: string } | undefined;
      if (fmt?.v === "wcpm_v1") {
        const r = db.prepare("SELECT COUNT(*) AS c FROM wcpm_tracks").get() as { c: number };
        return Number(r.c) || 0;
      }
      if (fmt?.v === "bmgpm_v1") {
        const r = db.prepare("SELECT COUNT(*) AS c FROM bmgpm_tracks").get() as { c: number };
        return Number(r.c) || 0;
      }
      if (fmt?.v === "generic_excel_v1") {
        const r = db.prepare("SELECT COUNT(*) AS c FROM sheet_rows").get() as { c: number };
        return Number(r.c) || 0;
      }
      return null;
    } finally {
      db.close();
    }
  } catch (e) {
    console.error("[musikverlage] countRows", id, e);
    return null;
  }
}

export type RebuildMusikverlagDbResult = { rowCount: number };

/**
 * Liest die Excel-Datei ein und legt/ersetzt die SQLite-Zuordnung für diesen Verlag.
 * WCPM: indizierte Suchtabelle; sonst: Rohzeilen der ersten Tabelle für spätere Auswertung.
 */
export async function rebuildMusikverlagTableDb(
  id: MusikverlagId,
  excelPathOrPaths: string | string[],
  options?: RebuildMusikverlagDbOptions
): Promise<RebuildMusikverlagDbResult> {
  const excelPaths = Array.isArray(excelPathOrPaths) ? excelPathOrPaths : [excelPathOrPaths];
  if (excelPaths.length === 0) throw new Error("Keine Excel-Datei angegeben.");
  fs.mkdirSync(DB_DIR(), { recursive: true });
  const uploadMode = options?.uploadMode ?? "replace";
  if (id === "bmgpm" && uploadMode === "append" && musikverlagSqliteExists(id)) {
    const appendPath = options?.appendSourcePath ?? excelPaths[excelPaths.length - 1];
    if (!appendPath) throw new Error("Keine Excel-Datei für Ergänzen angegeben.");
    return appendBmgpmFromExcel(appendPath);
  }
  removeMusikverlagSqliteDb(id);
  try {
    if (id === "wcpm") {
      return rebuildWcpmDb(excelPaths, id);
    }
    if (id === "bmgpm") {
      return await rebuildBmgpmDb(excelPaths, id);
    }
    return rebuildGenericExcelDb(excelPaths, id);
  } catch (e) {
    removeMusikverlagSqliteDb(id);
    throw e;
  }
}

function readFirstSheetRows(excelPath: string): { sheetName: string; rows: unknown[][] } {
  const ext = path.extname(excelPath).toLowerCase();
  if (ext === ".csv") {
    return { sheetName: path.basename(excelPath), rows: readCsvRows(excelPath) };
  }
  const wb = XLSX.readFile(excelPath, { cellDates: true });
  let sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error("Excel-Datei enthält keine Tabelle.");
  let bestRows: unknown[][] = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, {
      header: 1,
      defval: "",
      raw: false,
    }) as unknown[][];
    if (rows.length > bestRows.length) {
      bestRows = rows;
      sheetName = name;
    }
  }
  if (!bestRows.length) {
    throw new Error(
      `Excel-Datei enthält keine lesbaren Zeilen (${path.basename(excelPath)}). ` +
        "Sehr große .xlsx-Dateien bitte als BMGPM-Katalog hochladen (Streaming-Import)."
    );
  }
  return { sheetName, rows: bestRows };
}

function parseCsvSemicolonLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === ";" && !inQuotes) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function readCsvRows(csvPath: string): unknown[][] {
  const raw = fs.readFileSync(csvPath, "utf8");
  const lines = raw.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  const rows = lines.map((ln) => parseCsvSemicolonLine(ln));
  if (rows[0]?.[0]?.charCodeAt(0) === 0xfeff) {
    rows[0][0] = rows[0][0].slice(1);
  }
  return rows;
}

function rebuildWcpmDb(excelPaths: string[], id: MusikverlagId): RebuildMusikverlagDbResult {
  const dbPath = sqlitePathForMusikverlag(id);
  const db = new Database(dbPath);
  try {
    db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE meta (
        k TEXT PRIMARY KEY NOT NULL,
        v TEXT NOT NULL
      );
      INSERT INTO meta (k, v) VALUES ('format', 'wcpm_v1');
      CREATE TABLE wcpm_tracks (
        filename_stem TEXT NOT NULL PRIMARY KEY,
        payload_json TEXT NOT NULL
      );
      CREATE INDEX idx_wcpm_filename_stem ON wcpm_tracks(filename_stem);
    `);
    const ins = db.prepare(
      `INSERT OR REPLACE INTO wcpm_tracks (filename_stem, payload_json) VALUES (?, ?)`
    );
    const insertAll = db.transaction((): number => {
      let n = 0;
      for (const excelPath of excelPaths) {
        const { rows } = readFirstSheetRows(excelPath);
        if (!rows.length) {
          throw new Error(`WCPM-Tabelle ist leer: ${path.basename(excelPath)}`);
        }
        const headerMap = parseWcpmHeaderRow(rows[0]!);
        if (!headerMap) {
          throw new Error(`Unerwartete Kopfzeile in der WCPM-Tabelle: ${path.basename(excelPath)}`);
        }
        for (let r = 1; r < rows.length; r++) {
          const row = rows[r];
          if (!Array.isArray(row) || row.length === 0) continue;
          const stem = wcpmFilenameStem(String(row[headerMap.filenameCol] ?? ""));
          if (!stem) continue;
          const payload = wcpmRowToTagPayload(row, headerMap);
          if (!payload) continue;
          ins.run(stem, JSON.stringify(payload));
          n++;
        }
      }
      return n;
    });
    const rowCount = insertAll();
    return { rowCount };
  } finally {
    checkpointAndClose(db);
  }
}

function createBmgpmDbSchema(db: InstanceType<typeof Database>): void {
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE meta (
      k TEXT PRIMARY KEY NOT NULL,
      v TEXT NOT NULL
    );
    INSERT INTO meta (k, v) VALUES ('format', 'bmgpm_v1');
    CREATE TABLE bmgpm_tracks (
      row_key TEXT NOT NULL PRIMARY KEY,
      release_date TEXT,
      payload_json TEXT NOT NULL
    );
    CREATE INDEX idx_bmgpm_release ON bmgpm_tracks(release_date);
  `);
}

type BmgpmInsertBatchItem = { rowKey: string; release: string | null; payloadJson: string };

function exceljsCellToUnknown(v: unknown): unknown {
  if (v == null) return "";
  if (v instanceof Date) return v;
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "string") return v;
  if (typeof v === "object") {
    const o = v as {
      text?: string;
      richText?: { text?: string }[];
      result?: unknown;
      hyperlink?: string;
    };
    if (typeof o.text === "string") return o.text;
    if (Array.isArray(o.richText)) return o.richText.map((x) => x.text ?? "").join("");
    if (o.result != null) return exceljsCellToUnknown(o.result);
    if (typeof o.hyperlink === "string") return o.hyperlink;
  }
  return String(v);
}

function exceljsRowToArray(row: { values: unknown }): unknown[] {
  const vals = row.values;
  if (!Array.isArray(vals)) return [];
  const out: unknown[] = [];
  for (let i = 1; i < vals.length; i++) {
    out[i - 1] = exceljsCellToUnknown(vals[i]);
  }
  return out;
}

function bmgpmRowToInsertItem(
  headerMap: BmgpmHeaderMap,
  row: unknown[],
  minReleaseExclusive: string | null
): BmgpmInsertBatchItem | null {
  if (!Array.isArray(row) || row.length === 0) return null;
  const rowKey = bmgpmRowKeyFromRow(headerMap, row);
  if (!rowKey) return null;
  const payload = bmgpmRowToTagPayload(headerMap, row);
  if (!payload) return null;
  const release =
    payload.releaseDate ??
    (headerMap.albumReleaseDateIdx != null ? parseBmgpmReleaseDate(row[headerMap.albumReleaseDateIdx]) : null);
  if (release) payload.releaseDate = release;
  if (minReleaseExclusive && release) {
    if (release <= minReleaseExclusive) return null;
  } else if (minReleaseExclusive && !release) {
    return null;
  }
  return { rowKey: rowKey.toLowerCase(), release: release ?? null, payloadJson: JSON.stringify(payload) };
}

function ingestBmgpmRowsArray(
  rows: unknown[][],
  excelPath: string,
  onItem: (item: BmgpmInsertBatchItem) => void,
  minReleaseExclusive: string | null
): number {
  if (!rows.length) {
    throw new Error(`BMGPM-Tabelle ist leer: ${path.basename(excelPath)}`);
  }
  const headerRowIdx = findBmgpmHeaderRowIndex(rows);
  if (headerRowIdx == null) {
    const preview = rows
      .slice(0, 3)
      .map((row, i) => `Zeile ${i + 1}: ${formatBmgpmHeaderPreview(Array.isArray(row) ? row : [])}`)
      .join(" · ");
    throw new Error(
      `BMGPM-Kopfzeile nicht erkannt (${path.basename(excelPath)}). Erwartet u. a. „Track: Audio Filename“ oder „Album: Code“. ${preview}`
    );
  }
  const headerMap = parseBmgpmHeaderRow(rows[headerRowIdx]!)!;
  let n = 0;
  for (let r = headerRowIdx + 1; r < rows.length; r++) {
    const item = bmgpmRowToInsertItem(headerMap, rows[r]!, minReleaseExclusive);
    if (!item) continue;
    onItem(item);
    n++;
  }
  if (n === 0 && !minReleaseExclusive) {
    const dataRows = rows.length - headerRowIdx - 1;
    throw new Error(
      `BMGPM: 0 Zeilen importiert (${path.basename(excelPath)}, ${dataRows.toLocaleString("de-DE")} Datenzeilen unter der Kopfzeile). Spalten „Track: Audio Filename“ / „Album: Code“ prüfen.`
    );
  }
  return n;
}

async function ingestBmgpmExcelPathStreaming(
  excelPath: string,
  onItem: (item: BmgpmInsertBatchItem) => void,
  minReleaseExclusive: string | null
): Promise<number> {
  const ext = path.extname(excelPath).toLowerCase();
  if (ext === ".csv") {
    return ingestBmgpmRowsArray(readCsvRows(excelPath), excelPath, onItem, minReleaseExclusive);
  }

  const stream = fs.createReadStream(excelPath);
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(stream, {
    entries: "emit",
    sharedStrings: "cache",
    hyperlinks: "ignore",
    styles: "ignore",
    worksheets: "emit",
  });

  let headerMap: BmgpmHeaderMap | null = null;
  const headerBuffer: unknown[][] = [];
  let n = 0;
  let dataRows = 0;
  let sheets = 0;

  try {
    for await (const worksheetReader of reader) {
      sheets++;
      if (sheets > 1) break;
      for await (const excelRow of worksheetReader) {
        const row = exceljsRowToArray(excelRow);
        if (!headerMap) {
          headerBuffer.push(row);
          const idx = findBmgpmHeaderRowIndex(headerBuffer);
          if (idx != null) {
            headerMap = parseBmgpmHeaderRow(headerBuffer[idx]!)!;
            for (let r = idx + 1; r < headerBuffer.length; r++) {
              const item = bmgpmRowToInsertItem(headerMap, headerBuffer[r]!, minReleaseExclusive);
              if (!item) continue;
              onItem(item);
              n++;
              dataRows++;
            }
            headerBuffer.length = 0;
          } else if (headerBuffer.length >= 120) {
            const preview = headerBuffer
              .slice(0, 3)
              .map((h, i) => `Zeile ${i + 1}: ${formatBmgpmHeaderPreview(h)}`)
              .join(" · ");
            throw new Error(
              `BMGPM-Kopfzeile nicht erkannt (${path.basename(excelPath)}). Erwartet u. a. „Track: Audio Filename“ oder „Album: Code“. ${preview}`
            );
          }
          continue;
        }
        dataRows++;
        const item = bmgpmRowToInsertItem(headerMap, row, minReleaseExclusive);
        if (!item) continue;
        onItem(item);
        n++;
      }
    }
  } finally {
    stream.destroy();
  }

  if (!headerMap) {
    const preview = headerBuffer
      .slice(0, 3)
      .map((h, i) => `Zeile ${i + 1}: ${formatBmgpmHeaderPreview(h)}`)
      .join(" · ");
    throw new Error(
      `BMGPM-Kopfzeile nicht erkannt (${path.basename(excelPath)}, ${dataRows.toLocaleString("de-DE")} Zeilen gelesen). ${preview || "Datei leer oder nicht lesbar."}`
    );
  }
  if (n === 0 && !minReleaseExclusive) {
    throw new Error(
      `BMGPM: 0 Zeilen importiert (${path.basename(excelPath)}, ${dataRows.toLocaleString("de-DE")} Datenzeilen). Spalten „Track: Audio Filename“ / „Album: Code“ prüfen.`
    );
  }
  return n;
}

function createBmgpmInserter(db: InstanceType<typeof Database>): {
  push: (item: BmgpmInsertBatchItem) => void;
  flush: () => void;
} {
  const ins = db.prepare(
    `INSERT OR REPLACE INTO bmgpm_tracks (row_key, release_date, payload_json) VALUES (?, ?, ?)`
  );
  const insertBatch = db.transaction((batch: BmgpmInsertBatchItem[]) => {
    for (const item of batch) {
      ins.run(item.rowKey, item.release, item.payloadJson);
    }
  });
  let batch: BmgpmInsertBatchItem[] = [];
  return {
    push(item) {
      batch.push(item);
      if (batch.length >= 2000) {
        insertBatch(batch);
        batch = [];
      }
    },
    flush() {
      if (batch.length) {
        insertBatch(batch);
        batch = [];
      }
    },
  };
}

async function rebuildBmgpmDb(excelPaths: string[], id: MusikverlagId): Promise<RebuildMusikverlagDbResult> {
  const dbPath = sqlitePathForMusikverlag(id);
  const db = new Database(dbPath);
  try {
    createBmgpmDbSchema(db);
    db.pragma("synchronous = NORMAL");
    const inserter = createBmgpmInserter(db);
    let n = 0;
    for (const excelPath of excelPaths) {
      n += await ingestBmgpmExcelPathStreaming(excelPath, (item) => inserter.push(item), null);
    }
    inserter.flush();
    return { rowCount: n };
  } finally {
    checkpointAndClose(db);
  }
}

function maxBmgpmReleaseDateInDb(db: InstanceType<typeof Database>): string | null {
  const row = db
    .prepare(
      `SELECT MAX(release_date) AS m FROM bmgpm_tracks WHERE release_date IS NOT NULL AND TRIM(release_date) != ''`
    )
    .get() as { m: string | null } | undefined;
  return row?.m?.trim() || null;
}

async function appendBmgpmFromExcel(excelPath: string): Promise<RebuildMusikverlagDbResult> {
  const id: MusikverlagId = "bmgpm";
  const dbPath = sqlitePathForMusikverlag(id);
  const db = new Database(dbPath);
  let handedOff = false;
  try {
    const fmt = db.prepare("SELECT v FROM meta WHERE k = ?").get("format") as { v: string } | undefined;
    if (fmt?.v !== "bmgpm_v1") {
      checkpointAndClose(db);
      handedOff = true;
      removeMusikverlagSqliteDb(id);
      return rebuildBmgpmDb([excelPath], id);
    }
    const maxDate = maxBmgpmReleaseDateInDb(db);
    const inserter = createBmgpmInserter(db);
    const rowCount = await ingestBmgpmExcelPathStreaming(
      excelPath,
      (item) => inserter.push(item),
      maxDate
    );
    inserter.flush();
    return { rowCount };
  } finally {
    if (!handedOff) checkpointAndClose(db);
  }
}

function rebuildGenericExcelDb(excelPaths: string[], id: MusikverlagId): RebuildMusikverlagDbResult {
  const first = readFirstSheetRows(excelPaths[0]!);
  const sheetName = first.sheetName;
  const dbPath = sqlitePathForMusikverlag(id);
  const db = new Database(dbPath);
  try {
    db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE meta (
        k TEXT PRIMARY KEY NOT NULL,
        v TEXT NOT NULL
      );
      CREATE TABLE sheet_rows (
        row_idx INTEGER NOT NULL PRIMARY KEY,
        cells_json TEXT NOT NULL
      );
    `);
    const insMeta = db.prepare(`INSERT INTO meta (k, v) VALUES (?, ?)`);
    insMeta.run("format", "generic_excel_v1");
    insMeta.run("sheet_name", sheetName);

    const ins = db.prepare(`INSERT INTO sheet_rows (row_idx, cells_json) VALUES (?, ?)`);
    const insertAll = db.transaction((): number => {
      let rowIdx = 0;
      for (const excelPath of excelPaths) {
        const { rows } = readFirstSheetRows(excelPath);
        for (let i = 0; i < rows.length; i++) {
          ins.run(rowIdx, JSON.stringify(rows[i] ?? []));
          rowIdx++;
        }
      }
      return rowIdx;
    });
    const rowCount = insertAll();
    return { rowCount };
  } finally {
    checkpointAndClose(db);
  }
}

/** BMGPM-Katalog: Treffer über Audio-Dateiname, Album-Code oder Display-Titel. */
export function lookupBmgpmPayloadFromDb(fileName: string): WcpmTagPayload | null {
  const id: MusikverlagId = "bmgpm";
  if (!musikverlagSqliteExists(id)) return null;
  const stem = wcpmFilenameStem(fileName);
  const matchKey = wcpmFilenameStemMatchKey(fileName);
  const alnumKey = wcpmFilenameStemAlnumKey(fileName);
  const catalogCode = extractBmgpmCatalogCodeFromFileName(fileName);
  const db = new Database(sqlitePathForMusikverlag(id), { readonly: true });
  try {
    const fmt = db.prepare("SELECT v FROM meta WHERE k = ?").get("format") as { v: string } | undefined;
    if (fmt?.v !== "bmgpm_v1") return null;
    if (stem) {
      const exact = db
        .prepare("SELECT payload_json FROM bmgpm_tracks WHERE row_key = ?")
        .get(stem) as { payload_json: string } | undefined;
      if (exact?.payload_json) return JSON.parse(exact.payload_json) as WcpmTagPayload;
    }
    if (matchKey) {
      db.function("wcpm_stem_match_key", (x: string | null) => {
        if (x == null) return null;
        return wcpmFilenameStemMatchKey(String(x));
      });
      const fuzzy = db
        .prepare(
          `SELECT payload_json FROM bmgpm_tracks
           WHERE wcpm_stem_match_key(json_extract(payload_json, '$.trackAudioFilename')) = ?
           LIMIT 1`
        )
        .get(matchKey) as { payload_json: string } | undefined;
      if (fuzzy?.payload_json) return JSON.parse(fuzzy.payload_json) as WcpmTagPayload;
    }
    if (catalogCode) {
      const code = catalogCode.toLowerCase();
      const byCode = db
        .prepare(
          `SELECT payload_json FROM bmgpm_tracks
           WHERE LOWER(COALESCE(json_extract(payload_json, '$.albumCode'), '')) = ?
           ORDER BY release_date DESC
           LIMIT 1`
        )
        .get(code) as { payload_json: string } | undefined;
      if (byCode?.payload_json) return JSON.parse(byCode.payload_json) as WcpmTagPayload;
    }
    if (alnumKey.length >= 8) {
      db.function("wcpm_stem_alnum_key", (x: string | null) => {
        if (x == null) return null;
        return wcpmFilenameStemAlnumKey(String(x));
      });
      const alnum = db
        .prepare(
          `SELECT payload_json FROM bmgpm_tracks
           WHERE wcpm_stem_alnum_key(json_extract(payload_json, '$.trackAudioFilename')) = ?
           LIMIT 1`
        )
        .get(alnumKey) as { payload_json: string } | undefined;
      if (alnum?.payload_json) return JSON.parse(alnum.payload_json) as WcpmTagPayload;
    }
    return null;
  } finally {
    db.close();
  }
}

/** WCPM-Suche: Treffer über normalisierten Dateinamen-Stamm (wie bisher). */
export function lookupWcpmPayloadFromDb(fileName: string): WcpmTagPayload | null {
  const id: MusikverlagId = "wcpm";
  if (!musikverlagSqliteExists(id)) return null;
  const stem = wcpmFilenameStem(fileName);
  const matchKey = wcpmFilenameStemMatchKey(fileName);
  const alnumKey = wcpmFilenameStemAlnumKey(fileName);
  if (!stem) return null;
  const db = new Database(sqlitePathForMusikverlag(id), { readonly: true });
  try {
    const fmt = db.prepare("SELECT v FROM meta WHERE k = ?").get("format") as { v: string } | undefined;
    if (fmt?.v !== "wcpm_v1") return null;
    /** Gleiche Logik wie im Client; reines SQL REPLACE() deckt z. B. `CAR439 014` vs. `car439_014` unzuverlässig ab. */
    db.function("wcpm_stem_match_key", (x: string | null) => {
      if (x == null) return null;
      return wcpmFilenameStemMatchKey(String(x));
    });
    db.function("wcpm_stem_alnum_key", (x: string | null) => {
      if (x == null) return null;
      return wcpmFilenameStemAlnumKey(String(x));
    });
    const rowExact = db
      .prepare("SELECT payload_json FROM wcpm_tracks WHERE filename_stem = ?")
      .get(stem) as { payload_json: string } | undefined;
    if (rowExact?.payload_json) {
      return JSON.parse(rowExact.payload_json) as WcpmTagPayload;
    }
    if (matchKey) {
      const rowFuzzy = db
        .prepare(
          "SELECT payload_json FROM wcpm_tracks WHERE wcpm_stem_match_key(filename_stem) = ? LIMIT 1"
        )
        .get(matchKey) as { payload_json: string } | undefined;
      if (rowFuzzy?.payload_json) {
        return JSON.parse(rowFuzzy.payload_json) as WcpmTagPayload;
      }
    }
    if (alnumKey.length >= 8) {
      const rowAlnum = db
        .prepare(
          "SELECT payload_json FROM wcpm_tracks WHERE wcpm_stem_alnum_key(filename_stem) = ? LIMIT 1"
        )
        .get(alnumKey) as { payload_json: string } | undefined;
      if (rowAlnum?.payload_json) {
        return JSON.parse(rowAlnum.payload_json) as WcpmTagPayload;
      }
    }
    return null;
  } finally {
    db.close();
  }
}

export type WcpmDbFilters = {
  filenameStem?: string;
  songTitle?: string;
  artist?: string;
  album?: string;
  composer?: string;
  isrc?: string;
  labelcode?: string;
  label?: string;
  warnung?: boolean | null;
};

export type WcpmDbBrowserRow = {
  filenameStem: string;
  payload: WcpmTagPayload;
};

function buildCatalogWhere(filters: WcpmDbFilters, rowKeyColumn: string): {
  where: string;
  params: (string | number)[];
} {
  const clauses: string[] = [];
  const params: (string | number)[] = [];
  const addLike = (jsonPathOrColumn: string, value: string, isColumn = false) => {
    const v = value.trim().toLowerCase();
    if (!v) return;
    clauses.push(
      isColumn
        ? `LOWER(${jsonPathOrColumn}) LIKE ?`
        : `LOWER(COALESCE(json_extract(payload_json, '${jsonPathOrColumn}'), '')) LIKE ?`
    );
    params.push(`%${v}%`);
  };
  addLike(rowKeyColumn, filters.filenameStem ?? "", true);
  addLike("$.songTitle", filters.songTitle ?? "");
  addLike("$.artist", filters.artist ?? "");
  addLike("$.album", filters.album ?? "");
  addLike("$.composer", filters.composer ?? "");
  addLike("$.isrc", filters.isrc ?? "");
  addLike("$.labelcode", filters.labelcode ?? "");
  addLike("$.label", filters.label ?? "");
  if (filters.warnung === true) clauses.push(`json_extract(payload_json, '$.warnung') = 1`);
  else if (filters.warnung === false) {
    clauses.push(
      `(json_extract(payload_json, '$.warnung') IS NULL OR json_extract(payload_json, '$.warnung') = 0)`
    );
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return { where, params };
}

export function listWcpmDbRows(
  id: MusikverlagId,
  filters: WcpmDbFilters,
  limit: number = 500
): { rows: WcpmDbBrowserRow[]; total: number } {
  if (!musikverlagSqliteExists(id)) return { rows: [], total: 0 };
  const db = new Database(sqlitePathForMusikverlag(id), { readonly: true });
  try {
    const fmt = db.prepare("SELECT v FROM meta WHERE k = ?").get("format") as { v: string } | undefined;
    if (fmt?.v === "bmgpm_v1") {
      const { where, params } = buildCatalogWhere(filters, "row_key");
      const totalRow = db.prepare(`SELECT COUNT(*) AS c FROM bmgpm_tracks ${where}`).get(...params) as {
        c: number;
      };
      const listRows = db
        .prepare(
          `SELECT row_key, payload_json FROM bmgpm_tracks ${where} ORDER BY row_key ASC LIMIT ?`
        )
        .all(...params, Math.max(1, Math.min(5000, limit))) as {
        row_key: string;
        payload_json: string;
      }[];
      const rows = listRows.map((r) => parseBrowserRow(r.row_key, r.payload_json));
      return { rows, total: totalRow.c };
    }
    if (fmt?.v !== "wcpm_v1") {
      throw new Error("Datenbankansicht ist für diesen Musikverlag nicht verfügbar.");
    }
    const { where, params } = buildCatalogWhere(filters, "filename_stem");
    const totalRow = db.prepare(`SELECT COUNT(*) AS c FROM wcpm_tracks ${where}`).get(...params) as {
      c: number;
    };
    const listRows = db
      .prepare(
        `SELECT filename_stem, payload_json FROM wcpm_tracks ${where} ORDER BY filename_stem ASC LIMIT ?`
      )
      .all(...params, Math.max(1, Math.min(5000, limit))) as {
      filename_stem: string;
      payload_json: string;
    }[];
    const rows = listRows.map((r) => parseBrowserRow(r.filename_stem, r.payload_json));
    return { rows, total: totalRow.c };
  } finally {
    db.close();
  }
}

function parseBrowserRow(rowKey: string, payloadJson: string): WcpmDbBrowserRow {
  try {
    const payload = JSON.parse(payloadJson) as WcpmTagPayload;
    return { filenameStem: rowKey, payload };
  } catch {
    return {
      filenameStem: rowKey,
      payload: { songTitle: "", artist: "", album: "", composer: "", isrc: "", labelcode: "" },
    };
  }
}

export function listMusikverlagDbRowKeys(
  id: MusikverlagId,
  filters: WcpmDbFilters,
  limit: number = 5000
): string[] {
  if (!musikverlagSqliteExists(id)) return [];
  const db = new Database(sqlitePathForMusikverlag(id), { readonly: true });
  try {
    const fmt = db.prepare("SELECT v FROM meta WHERE k = ?").get("format") as { v: string } | undefined;
    if (fmt?.v === "bmgpm_v1") {
      const { where, params } = buildCatalogWhere(filters, "row_key");
      const listRows = db
        .prepare(`SELECT row_key FROM bmgpm_tracks ${where} ORDER BY row_key ASC LIMIT ?`)
        .all(...params, Math.max(1, Math.min(5000, limit))) as { row_key: string }[];
      return listRows.map((r) => r.row_key);
    }
    if (fmt?.v === "wcpm_v1") {
      const { where, params } = buildCatalogWhere(filters, "filename_stem");
      const listRows = db
        .prepare(`SELECT filename_stem FROM wcpm_tracks ${where} ORDER BY filename_stem ASC LIMIT ?`)
        .all(...params, Math.max(1, Math.min(5000, limit))) as { filename_stem: string }[];
      return listRows.map((r) => r.filename_stem);
    }
    return [];
  } finally {
    db.close();
  }
}

function applyPayloadPatch(prev: WcpmTagPayload, patch: Partial<WcpmTagPayload>): WcpmTagPayload {
  const next: WcpmTagPayload = { ...prev };
  const stringKeys: (keyof Omit<WcpmTagPayload, "warnung">)[] = [
    "songTitle",
    "artist",
    "album",
    "composer",
    "isrc",
    "labelcode",
    "label",
    "hersteller",
  ];
  for (const k of stringKeys) {
    if (!(k in patch)) continue;
    const raw = patch[k];
    const v = typeof raw === "string" ? raw.trim() : "";
    next[k] = v;
  }
  if ("warnung" in patch) {
    next.warnung = patch.warnung === true ? true : false;
  }
  return next;
}

export function updateWcpmDbRow(
  id: MusikverlagId,
  filenameStem: string,
  patch: Partial<WcpmTagPayload>
): WcpmTagPayload {
  if (!musikverlagSqliteExists(id)) throw new Error("Keine Datenbank vorhanden.");
  const key = filenameStem.trim().toLowerCase();
  if (!key) throw new Error("Dateiname (Stamm) fehlt.");
  const db = new Database(sqlitePathForMusikverlag(id));
  try {
    const fmt = db.prepare("SELECT v FROM meta WHERE k = ?").get("format") as { v: string } | undefined;
    if (fmt?.v === "bmgpm_v1") {
      const row = db
        .prepare("SELECT payload_json FROM bmgpm_tracks WHERE row_key = ?")
        .get(key) as { payload_json: string } | undefined;
      if (!row?.payload_json) throw new Error("Eintrag nicht gefunden.");
      const next = applyPayloadPatch(JSON.parse(row.payload_json) as WcpmTagPayload, patch);
      db.prepare(
        "UPDATE bmgpm_tracks SET payload_json = ? WHERE row_key = ?"
      ).run(JSON.stringify(next), key);
      return next;
    }
    if (fmt?.v !== "wcpm_v1") {
      throw new Error("Datenbankbearbeitung ist für diesen Musikverlag nicht verfügbar.");
    }
    const row = db
      .prepare("SELECT payload_json FROM wcpm_tracks WHERE filename_stem = ?")
      .get(key) as { payload_json: string } | undefined;
    if (!row?.payload_json) throw new Error("Eintrag nicht gefunden.");
    const next = applyPayloadPatch(JSON.parse(row.payload_json) as WcpmTagPayload, patch);
    db.prepare("INSERT OR REPLACE INTO wcpm_tracks (filename_stem, payload_json) VALUES (?, ?)").run(
      key,
      JSON.stringify(next)
    );
    return next;
  } finally {
    db.close();
  }
}

export function deleteMusikverlagDbRows(id: MusikverlagId, rowKeys: string[]): number {
  if (!musikverlagSqliteExists(id)) throw new Error("Keine Datenbank vorhanden.");
  const keys = [...new Set(rowKeys.map((k) => k.trim().toLowerCase()).filter(Boolean))];
  if (keys.length === 0) return 0;
  const db = new Database(sqlitePathForMusikverlag(id));
  try {
    const fmt = db.prepare("SELECT v FROM meta WHERE k = ?").get("format") as { v: string } | undefined;
    const table =
      fmt?.v === "bmgpm_v1" ? "bmgpm_tracks" : fmt?.v === "wcpm_v1" ? "wcpm_tracks" : null;
    const col = fmt?.v === "bmgpm_v1" ? "row_key" : "filename_stem";
    if (!table) throw new Error("Löschen für diesen Musikverlag nicht verfügbar.");
    const del = db.prepare(`DELETE FROM ${table} WHERE ${col} = ?`);
    const run = db.transaction(() => {
      let n = 0;
      for (const k of keys) {
        n += del.run(k).changes;
      }
      return n;
    });
    return run();
  } finally {
    db.close();
  }
}

export type MusikverlagBulkPatch = {
  labelcode?: string;
  label?: string;
  hersteller?: string;
  warnung?: boolean | null;
};

export function bulkPatchMusikverlagDbRows(
  id: MusikverlagId,
  rowKeys: string[],
  patch: MusikverlagBulkPatch
): number {
  if (!musikverlagSqliteExists(id)) throw new Error("Keine Datenbank vorhanden.");
  const keys = [...new Set(rowKeys.map((k) => k.trim().toLowerCase()).filter(Boolean))];
  if (keys.length === 0) return 0;
  const db = new Database(sqlitePathForMusikverlag(id));
  try {
    const fmt = db.prepare("SELECT v FROM meta WHERE k = ?").get("format") as { v: string } | undefined;
    if (fmt?.v !== "wcpm_v1" && fmt?.v !== "bmgpm_v1") {
      throw new Error("Massenbearbeitung für diesen Musikverlag nicht verfügbar.");
    }
    const isBmgpm = fmt.v === "bmgpm_v1";
    const selectSql = isBmgpm
      ? "SELECT payload_json FROM bmgpm_tracks WHERE row_key = ?"
      : "SELECT payload_json FROM wcpm_tracks WHERE filename_stem = ?";
    const updateSql = isBmgpm
      ? "UPDATE bmgpm_tracks SET payload_json = ? WHERE row_key = ?"
      : "UPDATE wcpm_tracks SET payload_json = ? WHERE filename_stem = ?";
    const sel = db.prepare(selectSql);
    const upd = db.prepare(updateSql);
    const partial: Partial<WcpmTagPayload> = {};
    if ("labelcode" in patch && typeof patch.labelcode === "string") partial.labelcode = patch.labelcode;
    if ("label" in patch && typeof patch.label === "string") partial.label = patch.label;
    if ("hersteller" in patch && typeof patch.hersteller === "string") partial.hersteller = patch.hersteller;
    if ("warnung" in patch) partial.warnung = patch.warnung === true ? true : patch.warnung === false ? false : undefined;
    const run = db.transaction(() => {
      let n = 0;
      for (const k of keys) {
        const row = sel.get(k) as { payload_json: string } | undefined;
        if (!row?.payload_json) continue;
        const prev = JSON.parse(row.payload_json) as WcpmTagPayload;
        const next = applyPayloadPatch(prev, partial);
        if ("warnung" in patch && patch.warnung === null) {
          delete next.warnung;
        }
        upd.run(JSON.stringify(next), k);
        n++;
      }
      return n;
    });
    return run();
  } finally {
    db.close();
  }
}
