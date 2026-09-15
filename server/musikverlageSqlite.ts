import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import Database from "better-sqlite3";
import type { MusikverlagId } from "../src/musikverlage/musikverlageCatalog";
import {
  bmgpmRowKeyFromRow,
  bmgpmRowToTagPayload,
  extractBmgpmCatalogCodeFromFileName,
  parseBmgpmHeaderRow,
  parseBmgpmReleaseDate,
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

const DB_DIR = () => path.join(getDataDir(), "musikverlage", "db");

/** Eine SQLite-Datei pro Musikverlag mit hochgeladener Excel-Tabelle. */
export function sqlitePathForMusikverlag(id: MusikverlagId): string {
  return path.join(DB_DIR(), `${id}.sqlite`);
}

export function removeMusikverlagSqliteDb(id: MusikverlagId): void {
  const p = sqlitePathForMusikverlag(id);
  try {
    fs.unlinkSync(p);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
}

export function musikverlagSqliteExists(id: MusikverlagId): boolean {
  try {
    return fs.statSync(sqlitePathForMusikverlag(id)).isFile();
  } catch {
    return false;
  }
}

export function countRowsInMusikverlagDb(id: MusikverlagId): number | null {
  if (!musikverlagSqliteExists(id)) return null;
  const db = new Database(sqlitePathForMusikverlag(id), { readonly: true });
  try {
    const fmt = db.prepare("SELECT v FROM meta WHERE k = ?").get("format") as { v: string } | undefined;
    if (fmt?.v === "wcpm_v1") {
      const r = db.prepare("SELECT COUNT(*) AS c FROM wcpm_tracks").get() as { c: number };
      return r.c;
    }
    if (fmt?.v === "bmgpm_v1") {
      const r = db.prepare("SELECT COUNT(*) AS c FROM bmgpm_tracks").get() as { c: number };
      return r.c;
    }
    if (fmt?.v === "generic_excel_v1") {
      const r = db.prepare("SELECT COUNT(*) AS c FROM sheet_rows").get() as { c: number };
      return r.c;
    }
    return null;
  } finally {
    db.close();
  }
}

export type RebuildMusikverlagDbResult = { rowCount: number };

/**
 * Liest die Excel-Datei ein und legt/ersetzt die SQLite-Zuordnung für diesen Verlag.
 * WCPM: indizierte Suchtabelle; sonst: Rohzeilen der ersten Tabelle für spätere Auswertung.
 */
export function rebuildMusikverlagTableDb(
  id: MusikverlagId,
  excelPathOrPaths: string | string[],
  options?: RebuildMusikverlagDbOptions
): RebuildMusikverlagDbResult {
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
      return rebuildBmgpmDb(excelPaths, id);
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
  const wb = XLSX.readFile(excelPath);
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error("Excel-Datei enthält keine Tabelle.");
  const ws = wb.Sheets[sheetName];
  if (!ws) throw new Error("Excel-Datei enthält keine Tabelle.");
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    defval: "",
    raw: false,
  }) as unknown[][];
  return { sheetName, rows };
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
    db.close();
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

function ingestBmgpmExcelPath(
  _db: InstanceType<typeof Database>,
  excelPath: string,
  ins: { run: (...args: unknown[]) => unknown },
  minReleaseExclusive: string | null
): number {
  const { rows } = readFirstSheetRows(excelPath);
  if (!rows.length) {
    throw new Error(`BMGPM-Tabelle ist leer: ${path.basename(excelPath)}`);
  }
  const headerMap = parseBmgpmHeaderRow(rows[0]!);
  if (!headerMap) {
    throw new Error(`Unerwartete Kopfzeile in der BMGPM-Tabelle: ${path.basename(excelPath)}`);
  }
  let n = 0;
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!Array.isArray(row) || row.length === 0) continue;
    const rowKey = bmgpmRowKeyFromRow(headerMap, row);
    if (!rowKey) continue;
    const payload = bmgpmRowToTagPayload(headerMap, row);
    if (!payload) continue;
    const release =
      payload.releaseDate ??
      (headerMap.albumReleaseDateIdx != null
        ? parseBmgpmReleaseDate(row[headerMap.albumReleaseDateIdx])
        : null);
    if (release) payload.releaseDate = release;
    if (minReleaseExclusive && release) {
      if (release <= minReleaseExclusive) continue;
    } else if (minReleaseExclusive && !release) {
      continue;
    }
    ins.run(rowKey.toLowerCase(), release ?? null, JSON.stringify(payload));
    n++;
  }
  return n;
}

function rebuildBmgpmDb(excelPaths: string[], id: MusikverlagId): RebuildMusikverlagDbResult {
  const dbPath = sqlitePathForMusikverlag(id);
  const db = new Database(dbPath);
  try {
    createBmgpmDbSchema(db);
    const ins = db.prepare(
      `INSERT OR REPLACE INTO bmgpm_tracks (row_key, release_date, payload_json) VALUES (?, ?, ?)`
    );
    const insertAll = db.transaction((): number => {
      let n = 0;
      for (const excelPath of excelPaths) {
        n += ingestBmgpmExcelPath(db, excelPath, ins, null);
      }
      return n;
    });
    const rowCount = insertAll();
    return { rowCount };
  } finally {
    db.close();
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

function appendBmgpmFromExcel(excelPath: string): RebuildMusikverlagDbResult {
  const id: MusikverlagId = "bmgpm";
  const dbPath = sqlitePathForMusikverlag(id);
  const db = new Database(dbPath);
  try {
    const fmt = db.prepare("SELECT v FROM meta WHERE k = ?").get("format") as { v: string } | undefined;
    if (fmt?.v !== "bmgpm_v1") {
      db.close();
      removeMusikverlagSqliteDb(id);
      return rebuildBmgpmDb([excelPath], id);
    }
    const maxDate = maxBmgpmReleaseDateInDb(db);
    const ins = db.prepare(
      `INSERT OR REPLACE INTO bmgpm_tracks (row_key, release_date, payload_json) VALUES (?, ?, ?)`
    );
    const rowCount = ingestBmgpmExcelPath(db, excelPath, ins, maxDate);
    return { rowCount };
  } finally {
    db.close();
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
    db.close();
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
