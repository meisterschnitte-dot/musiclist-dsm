import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { getPlayerArchiveRoot } from "./playerCatalogSettings";
import { getDataDir } from "./userStore";

export const PLAYER_TRACK_TAGS_VER = 3;

export type PlayerTrackTags = {
  title: string;
  artist: string;
  album: string;
  year: string;
  genre: string;
  writer: string;
  publisher: string;
  label: string;
  labelcode: string;
  gvlRights: string;
  comment: string;
  isrc: string;
};

export type PlayerTrackRow = PlayerTrackTags & {
  id: number;
  relPath: string;
  fileName: string;
  folder: string;
  durationSec: number | null;
  fileSize: number;
  mtimeMs: number;
  tagsVer: number;
  ingestAt: string;
};

export type PlayerPlaylistRow = {
  id: number;
  userId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  trackCount: number;
};

export type PlayerTrackUpsert = PlayerTrackTags & {
  relPath: string;
  fileName: string;
  folder: string;
  durationSec: number | null;
  fileSize: number;
  mtimeMs: number;
};

const DB_DIR = () => path.join(getDataDir(), "player");
const DB_FILE = () => path.join(DB_DIR(), "catalog.sqlite");

let dbSingleton: Database.Database | null = null;

function columnString(row: Record<string, unknown>, key: string): string {
  const v = row[key];
  return typeof v === "string" ? v : "";
}

function mapTrack(row: Record<string, unknown>): PlayerTrackRow {
  const dur = row.duration_sec;
  return {
    id: Number(row.id),
    relPath: columnString(row, "rel_path"),
    fileName: columnString(row, "file_name"),
    folder: columnString(row, "folder"),
    title: columnString(row, "title"),
    artist: columnString(row, "artist"),
    album: columnString(row, "album"),
    year: columnString(row, "year"),
    genre: columnString(row, "genre"),
    writer: columnString(row, "writer"),
    publisher: columnString(row, "publisher"),
    label: columnString(row, "label"),
    labelcode: columnString(row, "labelcode"),
    gvlRights: columnString(row, "gvl_rights"),
    comment: columnString(row, "comment"),
    isrc: columnString(row, "isrc"),
    durationSec: typeof dur === "number" && Number.isFinite(dur) ? dur : null,
    fileSize: Number(row.file_size) || 0,
    mtimeMs: Number(row.mtime_ms) || 0,
    tagsVer: Number(row.tags_ver) || 0,
    ingestAt: columnString(row, "indexed_at"),
  };
}

function ensureTrackExtraColumns(db: Database.Database): void {
  const cols = new Set(
    (db.prepare("PRAGMA table_info(tracks)").all() as Array<{ name: string }>).map((c) => c.name)
  );
  const add: Array<[string, string]> = [
    ["writer", "TEXT NOT NULL DEFAULT ''"],
    ["publisher", "TEXT NOT NULL DEFAULT ''"],
    ["label", "TEXT NOT NULL DEFAULT ''"],
    ["labelcode", "TEXT NOT NULL DEFAULT ''"],
    ["gvl_rights", "TEXT NOT NULL DEFAULT ''"],
    ["comment", "TEXT NOT NULL DEFAULT ''"],
    ["isrc", "TEXT NOT NULL DEFAULT ''"],
    ["tags_ver", "INTEGER NOT NULL DEFAULT 0"],
  ];
  for (const [name, decl] of add) {
    if (cols.has(name)) continue;
    db.exec(`ALTER TABLE tracks ADD COLUMN ${name} ${decl}`);
  }
}

function migrateRelativePathsToAbsolute(db: Database.Database): void {
  const root = getPlayerArchiveRoot();
  if (!root) return;
  const rows = db.prepare("SELECT id, rel_path FROM tracks").all() as Array<{ id: number; rel_path: string }>;
  const upd = db.prepare("UPDATE tracks SET rel_path = ?, folder = ? WHERE id = ?");
  for (const row of rows) {
    if (path.isAbsolute(row.rel_path)) continue;
    try {
      const abs = path.resolve(root, row.rel_path);
      upd.run(abs, path.dirname(abs), row.id);
    } catch {
      /* skip */
    }
  }
}

function ftsInsertSql(): string {
  return `INSERT INTO tracks_fts(rowid, file_name, folder, title, artist, album, genre, writer, publisher, label, comment)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
}

function ftsBind(id: number, t: PlayerTrackTags & { fileName: string; folder: string }): unknown[] {
  return [id, t.fileName, t.folder, t.title, t.artist, t.album, t.genre, t.writer, t.publisher, t.label, t.comment];
}

export function getPlayerCatalogDb(): Database.Database {
  if (dbSingleton) return dbSingleton;
  fs.mkdirSync(DB_DIR(), { recursive: true });
  const db = new Database(DB_FILE());
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS tracks (
      id INTEGER PRIMARY KEY,
      rel_path TEXT NOT NULL UNIQUE,
      file_name TEXT NOT NULL,
      folder TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      artist TEXT NOT NULL DEFAULT '',
      album TEXT NOT NULL DEFAULT '',
      year TEXT NOT NULL DEFAULT '',
      genre TEXT NOT NULL DEFAULT '',
      duration_sec REAL,
      file_size INTEGER NOT NULL DEFAULT 0,
      mtime_ms INTEGER NOT NULL DEFAULT 0,
      indexed_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tracks_file_name ON tracks(file_name);
    CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks(artist);
    CREATE TABLE IF NOT EXISTS playlists (
      id INTEGER PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_playlists_user ON playlists(user_id);
    CREATE TABLE IF NOT EXISTS playlist_tracks (
      playlist_id INTEGER NOT NULL,
      pos INTEGER NOT NULL,
      track_id INTEGER NOT NULL,
      PRIMARY KEY (playlist_id, pos),
      FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
      FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS musiclist_links (
      shared_path TEXT NOT NULL PRIMARY KEY COLLATE NOCASE,
      track_id INTEGER NOT NULL,
      linked_at TEXT NOT NULL,
      FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_musiclist_links_track ON musiclist_links(track_id);
  `);
  ensureTrackExtraColumns(db);
  migrateRelativePathsToAbsolute(db);
  const ftsSql = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'tracks_fts'").get() as { sql?: string } | undefined;
  if (ftsSql?.sql?.includes("content=") || (ftsSql?.sql && !ftsSql.sql.includes("writer"))) {
    db.exec("DROP TABLE IF EXISTS tracks_fts");
  }
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS tracks_fts USING fts5(
      file_name, folder, title, artist, album, genre, writer, publisher, label, comment,
      tokenize='unicode61'
    );
  `);
  dbSingleton = db;
  const trackN = db.prepare("SELECT COUNT(*) AS n FROM tracks").get() as { n: number };
  const ftsN = db.prepare("SELECT COUNT(*) AS n FROM tracks_fts").get() as { n: number };
  if (Number(trackN.n) !== Number(ftsN.n)) {
    db.exec("DELETE FROM tracks_fts");
    db.exec(`
      INSERT INTO tracks_fts(rowid, file_name, folder, title, artist, album, genre, writer, publisher, label, comment)
      SELECT id, file_name, folder, title, artist, album, genre, writer, publisher, label, comment FROM tracks
    `);
  }
  return db;
}

export function playerCatalogTrackCount(): number {
  const row = getPlayerCatalogDb().prepare("SELECT COUNT(*) AS n FROM tracks").get() as { n: number };
  return Number(row.n) || 0;
}

export function playerCatalogGetById(id: number): PlayerTrackRow | null {
  const row = getPlayerCatalogDb().prepare("SELECT * FROM tracks WHERE id = ?").get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? mapTrack(row) : null;
}

export function playerCatalogExistingStat(
  relPath: string
): { id: number; fileSize: number; mtimeMs: number; tagsVer: number; fileName: string; title: string } | null {
  const row = getPlayerCatalogDb()
    .prepare("SELECT id, file_size, mtime_ms, tags_ver, file_name, title FROM tracks WHERE rel_path = ?")
    .get(relPath) as
    | { id: number; file_size: number; mtime_ms: number; tags_ver: number; file_name: string; title: string }
    | undefined;
  if (!row) return null;
  return {
    id: Number(row.id),
    fileSize: Number(row.file_size) || 0,
    mtimeMs: Number(row.mtime_ms) || 0,
    tagsVer: Number(row.tags_ver) || 0,
    fileName: String(row.file_name ?? ""),
    title: String(row.title ?? ""),
  };
}

export function playerCatalogExistingPathSet(relPaths: string[]): Set<string> {
  const found = new Set<string>();
  if (!relPaths.length) return found;
  const db = getPlayerCatalogDb();
  const chunkSize = 400;
  for (let i = 0; i < relPaths.length; i += chunkSize) {
    const chunk = relPaths.slice(i, i + chunkSize);
    const placeholders = chunk.map(() => "?").join(", ");
    const rows = db.prepare(`SELECT rel_path FROM tracks WHERE rel_path IN (${placeholders})`).all(...chunk) as Array<{
      rel_path: string;
    }>;
    for (const row of rows) found.add(row.rel_path);
  }
  return found;
}

export function playerCatalogUpsertTrack(t: PlayerTrackUpsert): number {
  const db = getPlayerCatalogDb();
  const now = new Date().toISOString();
  const info = db
    .prepare(
      `INSERT INTO tracks (
        rel_path, file_name, folder, title, artist, album, year, genre,
        writer, publisher, label, labelcode, gvl_rights, comment, isrc,
        duration_sec, file_size, mtime_ms, indexed_at, tags_ver
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(rel_path) DO UPDATE SET
        file_name = excluded.file_name,
        folder = excluded.folder,
        title = excluded.title,
        artist = excluded.artist,
        album = excluded.album,
        year = excluded.year,
        genre = excluded.genre,
        writer = excluded.writer,
        publisher = excluded.publisher,
        label = excluded.label,
        labelcode = excluded.labelcode,
        gvl_rights = excluded.gvl_rights,
        comment = excluded.comment,
        isrc = excluded.isrc,
        duration_sec = excluded.duration_sec,
        file_size = excluded.file_size,
        mtime_ms = excluded.mtime_ms,
        tags_ver = excluded.tags_ver`
    )
    .run(
      t.relPath,
      t.fileName,
      t.folder,
      t.title,
      t.artist,
      t.album,
      t.year,
      t.genre,
      t.writer,
      t.publisher,
      t.label,
      t.labelcode,
      t.gvlRights,
      t.comment,
      t.isrc,
      t.durationSec,
      t.fileSize,
      t.mtimeMs,
      now,
      PLAYER_TRACK_TAGS_VER
    );
  const id =
    info.lastInsertRowid && Number(info.lastInsertRowid) > 0
      ? Number(info.lastInsertRowid)
      : playerCatalogExistingStat(t.relPath)?.id ?? 0;
  db.prepare("DELETE FROM tracks_fts WHERE rowid = ?").run(id);
  db.prepare(ftsInsertSql()).run(...ftsBind(id, t));
  return id;
}

export function playerCatalogWriteTags(id: number, tags: PlayerTrackTags): PlayerTrackRow | null {
  const db = getPlayerCatalogDb();
  const info = db
    .prepare(
      `UPDATE tracks SET
        title = ?, artist = ?, album = ?, year = ?, genre = ?,
        writer = ?, publisher = ?, label = ?, labelcode = ?, gvl_rights = ?, comment = ?, isrc = ?,
        tags_ver = ?
       WHERE id = ?`
    )
    .run(
      tags.title,
      tags.artist,
      tags.album,
      tags.year,
      tags.genre,
      tags.writer,
      tags.publisher,
      tags.label,
      tags.labelcode,
      tags.gvlRights,
      tags.comment,
      tags.isrc,
      PLAYER_TRACK_TAGS_VER,
      id
    );
  if (info.changes === 0) return null;
  const row = playerCatalogGetById(id);
  if (!row) return null;
  db.prepare("DELETE FROM tracks_fts WHERE rowid = ?").run(id);
  db.prepare(ftsInsertSql()).run(...ftsBind(id, row));
  return row;
}

export function playerCatalogRebuildFtsIfNeeded(): void {
  const db = getPlayerCatalogDb();
  const tracks = db.prepare("SELECT COUNT(*) AS n FROM tracks").get() as { n: number };
  const fts = db.prepare("SELECT COUNT(*) AS n FROM tracks_fts").get() as { n: number };
  if (Number(tracks.n) === Number(fts.n)) return;
  db.exec("DELETE FROM tracks_fts");
  db.exec(`
    INSERT INTO tracks_fts(rowid, file_name, folder, title, artist, album, genre, writer, publisher, label, comment)
    SELECT id, file_name, folder, title, artist, album, genre, writer, publisher, label, comment FROM tracks
  `);
}

export function playerCatalogDeleteById(id: number): boolean {
  const db = getPlayerCatalogDb();
  if (!db.prepare("SELECT id FROM tracks WHERE id = ?").get(id)) return false;
  const playlistIds = (
    db.prepare("SELECT DISTINCT playlist_id FROM playlist_tracks WHERE track_id = ?").all(id) as Array<{
      playlist_id: number;
    }>
  ).map((row) => row.playlist_id);
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM playlist_tracks WHERE track_id = ?").run(id);
    const ins = db.prepare("INSERT INTO playlist_tracks (playlist_id, pos, track_id) VALUES (?, ?, ?)");
    for (const playlistId of playlistIds) {
      const rest = db
        .prepare("SELECT pos, track_id FROM playlist_tracks WHERE playlist_id = ? ORDER BY pos")
        .all(playlistId) as Array<{ pos: number; track_id: number }>;
      db.prepare("DELETE FROM playlist_tracks WHERE playlist_id = ?").run(playlistId);
      rest.forEach((row, i) => ins.run(playlistId, i, row.track_id));
      db.prepare("UPDATE playlists SET updated_at = ? WHERE id = ?").run(new Date().toISOString(), playlistId);
    }
    db.prepare("DELETE FROM tracks_fts WHERE rowid = ?").run(id);
    db.prepare("DELETE FROM tracks WHERE id = ?").run(id);
  });
  tx();
  return true;
}

export function playerCatalogNullDurationRows(limit = 100): Array<{ id: number; relPath: string; fileName: string; title: string }> {
  const rows = getPlayerCatalogDb()
    .prepare(
      `SELECT id, rel_path, file_name, title FROM tracks WHERE duration_sec IS NULL LIMIT ?`
    )
    .all(limit) as Array<{ id: number; rel_path: string; file_name: string; title: string }>;
  return rows.map((row) => ({
    id: Number(row.id),
    relPath: String(row.rel_path ?? ""),
    fileName: String(row.file_name ?? ""),
    title: String(row.title ?? ""),
  }));
}

export function playerCatalogDeleteMissing(keepRelPaths: Set<string>): number {
  const db = getPlayerCatalogDb();
  const rows = db.prepare("SELECT id, rel_path FROM tracks").all() as Array<{ id: number; rel_path: string }>;
  const del = db.prepare("DELETE FROM tracks WHERE id = ?");
  const delFts = db.prepare("DELETE FROM tracks_fts WHERE rowid = ?");
  let n = 0;
  const tx = db.transaction(() => {
    for (const row of rows) {
      if (keepRelPaths.has(row.rel_path)) continue;
      delFts.run(row.id);
      del.run(row.id);
      n += 1;
    }
  });
  tx();
  return n;
}

function normSharedPath(p: string): string {
  return p.replace(/\\/g, "/").trim();
}

export function playerLinkSharedPath(sharedPath: string, trackId: number): boolean {
  const p = normSharedPath(sharedPath);
  if (!p) return false;
  const db = getPlayerCatalogDb();
  if (!db.prepare("SELECT id FROM tracks WHERE id = ?").get(trackId)) return false;
  db.prepare(
    `INSERT INTO musiclist_links (shared_path, track_id, linked_at) VALUES (?, ?, ?)
     ON CONFLICT(shared_path) DO UPDATE SET track_id = excluded.track_id, linked_at = excluded.linked_at`
  ).run(p, trackId, new Date().toISOString());
  return true;
}

export function playerLinkedTrackIdForSharedPath(sharedPath: string): number | null {
  const row = getPlayerCatalogDb()
    .prepare("SELECT track_id FROM musiclist_links WHERE shared_path = ?")
    .get(normSharedPath(sharedPath)) as { track_id: number } | undefined;
  return row ? Number(row.track_id) : null;
}

export function playerLinkedSharedPathsForTracks(trackIds: number[]): Record<number, string[]> {
  const out: Record<number, string[]> = {};
  if (!trackIds.length) return out;
  const db = getPlayerCatalogDb();
  const placeholders = trackIds.map(() => "?").join(", ");
  const rows = db
    .prepare(`SELECT track_id, shared_path FROM musiclist_links WHERE track_id IN (${placeholders})`)
    .all(...trackIds) as Array<{ track_id: number; shared_path: string }>;
  for (const row of rows) {
    (out[Number(row.track_id)] ??= []).push(String(row.shared_path));
  }
  return out;
}

/** Kandidaten für den Musiclist-Abgleich: FTS über Dateiname/Titel mit den ersten Wörtern des Stamms. */
export function playerCatalogMatchCandidates(stem: string, limit = 40): PlayerTrackRow[] {
  const tokens = stem
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 0)
    .slice(0, 3);
  if (!tokens.length) return [];
  const match = `{file_name title} : (${tokens.map((t) => `"${t}"*`).join(" AND ")})`;
  const rows = getPlayerCatalogDb()
    .prepare(
      `SELECT t.* FROM tracks_fts JOIN tracks t ON t.id = tracks_fts.rowid
       WHERE tracks_fts MATCH ? LIMIT ?`
    )
    .all(match, limit) as Array<Record<string, unknown>>;
  return rows.map(mapTrack);
}

function ftsMatchQuery(q: string): string | null {
  const tokens = q
    .trim()
    .split(/\s+/)
    .map((t) => t.replace(/["'^:*()]/g, ""))
    .filter((t) => t.length > 0);
  if (!tokens.length) return null;
  return tokens.map((t) => `${t}*`).join(" AND ");
}

export const PLAYER_CATALOG_FILTER_KEYS = [
  "file",
  "songTitle",
  "artist",
  "album",
  "year",
  "composer",
  "comment",
  "isrc",
  "labelcode",
  "label",
  "hersteller",
  "gvlRechte",
  "duration",
  "ingestAt",
] as const;

export type PlayerCatalogFilterKey = (typeof PLAYER_CATALOG_FILTER_KEYS)[number];

export type PlayerCatalogSearchOpts = {
  filters?: Partial<Record<PlayerCatalogFilterKey, string>>;
  sort?: { column: PlayerCatalogFilterKey; direction: "asc" | "desc" };
};

const INGEST_DISPLAY_SQL = `CASE
  WHEN t.indexed_at IS NULL OR t.indexed_at = '' THEN '—'
  ELSE substr(t.indexed_at, 9, 2) || '.' || substr(t.indexed_at, 6, 2) || '.' || substr(t.indexed_at, 1, 4) || ' ' || substr(t.indexed_at, 12, 5)
END`;

const FILTER_TEXT_COL: Record<Exclude<PlayerCatalogFilterKey, "duration" | "ingestAt">, string> = {
  file: "rel_path",
  songTitle: "title",
  artist: "artist",
  album: "album",
  year: "year",
  composer: "writer",
  comment: "comment",
  isrc: "isrc",
  labelcode: "labelcode",
  label: "label",
  hersteller: "publisher",
  gvlRechte: "gvl_rights",
};

const DURATION_DISPLAY_SQL = `CASE
  WHEN t.duration_sec IS NULL OR t.duration_sec < 0 THEN '—'
  ELSE (CAST(t.duration_sec AS INTEGER) / 60) || ':' || printf('%02d', CAST(t.duration_sec AS INTEGER) % 60)
END`;

function likeNeedle(raw: string): string {
  return `%${raw.trim().replace(/[%_]/g, "")}%`;
}

function filterSql(
  filters: Partial<Record<PlayerCatalogFilterKey, string>> | undefined
): { sql: string; params: string[] } {
  const parts: string[] = [];
  const params: string[] = [];
  if (!filters) return { sql: "", params };
  for (const key of PLAYER_CATALOG_FILTER_KEYS) {
    const raw = filters[key];
    if (!raw?.trim()) continue;
    const needle = likeNeedle(raw);
    if (key === "duration") {
      parts.push(`${DURATION_DISPLAY_SQL} LIKE ? COLLATE NOCASE`);
      params.push(needle);
    } else if (key === "ingestAt") {
      parts.push(`(${INGEST_DISPLAY_SQL} LIKE ? COLLATE NOCASE OR t.indexed_at LIKE ? COLLATE NOCASE)`);
      params.push(needle, needle);
    } else {
      parts.push(`t.${FILTER_TEXT_COL[key]} LIKE ? COLLATE NOCASE`);
      params.push(needle);
    }
  }
  return { sql: parts.join(" AND "), params };
}

function orderSql(
  sort: PlayerCatalogSearchOpts["sort"],
  ftsRank: boolean
): string {
  const dir = sort?.direction === "desc" ? "DESC" : "ASC";
  if (sort?.column === "duration") {
    return `ORDER BY CASE WHEN t.duration_sec IS NULL THEN 1 ELSE 0 END ${dir}, t.duration_sec ${dir}`;
  }
  if (sort?.column === "ingestAt") {
    return `ORDER BY t.indexed_at ${dir}, t.file_name COLLATE NOCASE ${dir}`;
  }
  if (sort?.column && sort.column !== "duration" && sort.column !== "ingestAt") {
    const col = FILTER_TEXT_COL[sort.column];
    if (col) return `ORDER BY t.${col} COLLATE NOCASE ${dir}, t.file_name COLLATE NOCASE ${dir}`;
  }
  if (ftsRank) return "ORDER BY rank";
  return "ORDER BY t.file_name COLLATE NOCASE";
}

const Q_LIKE_SQL = `(t.file_name LIKE ? COLLATE NOCASE
  OR t.rel_path LIKE ? COLLATE NOCASE
  OR t.title LIKE ? COLLATE NOCASE
  OR t.artist LIKE ? COLLATE NOCASE
  OR t.album LIKE ? COLLATE NOCASE
  OR t.folder LIKE ? COLLATE NOCASE
  OR t.genre LIKE ? COLLATE NOCASE
  OR t.writer LIKE ? COLLATE NOCASE
  OR t.publisher LIKE ? COLLATE NOCASE
  OR t.label LIKE ? COLLATE NOCASE
  OR t.labelcode LIKE ? COLLATE NOCASE
  OR t.comment LIKE ? COLLATE NOCASE
  OR t.isrc LIKE ? COLLATE NOCASE)`;

export function playerCatalogSearch(
  q: string,
  limit: number,
  offset: number,
  opts: PlayerCatalogSearchOpts = {}
): { total: number; tracks: PlayerTrackRow[] } {
  const db = getPlayerCatalogDb();
  const lim = Math.min(200, Math.max(1, limit));
  const off = Math.max(0, offset);
  const match = ftsMatchQuery(q);
  const filters = filterSql(opts.filters);
  const order = orderSql(opts.sort, Boolean(match));
  const andFilters = filters.sql ? ` AND ${filters.sql}` : "";

  const run = (sqlCount: string, sqlRows: string, params: unknown[]): { total: number; tracks: PlayerTrackRow[] } => {
    const totalRow = db.prepare(sqlCount).get(...params) as { n: number };
    const rows = db.prepare(sqlRows).all(...params, lim, off) as Record<string, unknown>[];
    return { total: Number(totalRow.n) || 0, tracks: rows.map(mapTrack) };
  };

  if (!match && !filters.sql) {
    const rows = db
      .prepare(`SELECT t.* FROM tracks t ${order} LIMIT ? OFFSET ?`)
      .all(lim, off) as Record<string, unknown>[];
    return { total: playerCatalogTrackCount(), tracks: rows.map(mapTrack) };
  }

  if (match) {
    try {
      const result = run(
        `SELECT COUNT(*) AS n FROM tracks t
         JOIN tracks_fts ON tracks_fts.rowid = t.id
         WHERE tracks_fts MATCH ?${andFilters}`,
        `SELECT t.* FROM tracks t
         JOIN tracks_fts ON tracks_fts.rowid = t.id
         WHERE tracks_fts MATCH ?${andFilters}
         ${order}
         LIMIT ? OFFSET ?`,
        [match, ...filters.params]
      );
      if (result.total > 0 || !q.trim()) return result;
    } catch {
      /* FTS ungültig — LIKE */
    }
  }

  const like = likeNeedle(q);
  const qParams = q.trim() ? Array.from({ length: 13 }, () => like) : [];
  const whereQ = q.trim() ? Q_LIKE_SQL : "1=1";
  return run(
    `SELECT COUNT(*) AS n FROM tracks t WHERE ${whereQ}${q.trim() ? andFilters : filters.sql ? ` AND ${filters.sql}` : ""}`,
    `SELECT t.* FROM tracks t WHERE ${whereQ}${q.trim() ? andFilters : filters.sql ? ` AND ${filters.sql}` : ""}
     ${orderSql(opts.sort, false)}
     LIMIT ? OFFSET ?`,
    [...qParams, ...filters.params]
  );
}

export function playerPlaylistList(userId: string): PlayerPlaylistRow[] {
  const rows = getPlayerCatalogDb()
    .prepare(
      `SELECT p.*, (SELECT COUNT(*) FROM playlist_tracks i WHERE i.playlist_id = p.id) AS track_count
       FROM playlists p WHERE p.user_id = ? ORDER BY p.updated_at DESC, p.id DESC`
    )
    .all(userId) as Record<string, unknown>[];
  return rows.map((row) => ({
    id: Number(row.id),
    userId: columnString(row, "user_id"),
    name: columnString(row, "name"),
    createdAt: columnString(row, "created_at"),
    updatedAt: columnString(row, "updated_at"),
    trackCount: Number(row.track_count) || 0,
  }));
}

export function playerPlaylistGet(
  userId: string,
  playlistId: number
): { playlist: PlayerPlaylistRow; tracks: PlayerTrackRow[] } | null {
  const list = playerPlaylistList(userId).find((p) => p.id === playlistId);
  if (!list) return null;
  const rows = getPlayerCatalogDb()
    .prepare(
      `SELECT t.* FROM playlist_tracks i
       JOIN tracks t ON t.id = i.track_id
       WHERE i.playlist_id = ?
       ORDER BY i.pos`
    )
    .all(playlistId) as Record<string, unknown>[];
  return { playlist: list, tracks: rows.map(mapTrack) };
}

export function playerPlaylistCreate(userId: string, name: string): PlayerPlaylistRow {
  const now = new Date().toISOString();
  const info = getPlayerCatalogDb()
    .prepare("INSERT INTO playlists (user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?)")
    .run(userId, name.trim() || "Playlist", now, now);
  const id = Number(info.lastInsertRowid);
  return {
    id,
    userId,
    name: name.trim() || "Playlist",
    createdAt: now,
    updatedAt: now,
    trackCount: 0,
  };
}

export function playerPlaylistRename(userId: string, playlistId: number, name: string): boolean {
  const now = new Date().toISOString();
  const info = getPlayerCatalogDb()
    .prepare("UPDATE playlists SET name = ?, updated_at = ? WHERE id = ? AND user_id = ?")
    .run(name.trim() || "Playlist", now, playlistId, userId);
  return info.changes > 0;
}

export function playerPlaylistDelete(userId: string, playlistId: number): boolean {
  const db = getPlayerCatalogDb();
  const owned = db.prepare("SELECT id FROM playlists WHERE id = ? AND user_id = ?").get(playlistId, userId);
  if (!owned) return false;
  db.prepare("DELETE FROM playlist_tracks WHERE playlist_id = ?").run(playlistId);
  db.prepare("DELETE FROM playlists WHERE id = ?").run(playlistId);
  return true;
}

export function playerPlaylistAddTrack(userId: string, playlistId: number, trackId: number): boolean {
  const db = getPlayerCatalogDb();
  const owned = db.prepare("SELECT id FROM playlists WHERE id = ? AND user_id = ?").get(playlistId, userId);
  if (!owned) return false;
  if (!playerCatalogGetById(trackId)) return false;
  const posRow = db
    .prepare("SELECT COALESCE(MAX(pos), -1) + 1 AS n FROM playlist_tracks WHERE playlist_id = ?")
    .get(playlistId) as { n: number };
  db.prepare("INSERT INTO playlist_tracks (playlist_id, pos, track_id) VALUES (?, ?, ?)").run(
    playlistId,
    Number(posRow.n) || 0,
    trackId
  );
  db.prepare("UPDATE playlists SET updated_at = ? WHERE id = ?").run(new Date().toISOString(), playlistId);
  return true;
}

export function playerPlaylistRemoveAt(userId: string, playlistId: number, pos: number): boolean {
  const db = getPlayerCatalogDb();
  const owned = db.prepare("SELECT id FROM playlists WHERE id = ? AND user_id = ?").get(playlistId, userId);
  if (!owned) return false;
  const info = db.prepare("DELETE FROM playlist_tracks WHERE playlist_id = ? AND pos = ?").run(playlistId, pos);
  if (info.changes === 0) return false;
  const rest = db
    .prepare("SELECT pos, track_id FROM playlist_tracks WHERE playlist_id = ? ORDER BY pos")
    .all(playlistId) as Array<{ pos: number; track_id: number }>;
  db.prepare("DELETE FROM playlist_tracks WHERE playlist_id = ?").run(playlistId);
  const ins = db.prepare("INSERT INTO playlist_tracks (playlist_id, pos, track_id) VALUES (?, ?, ?)");
  rest.forEach((row, i) => ins.run(playlistId, i, row.track_id));
  db.prepare("UPDATE playlists SET updated_at = ? WHERE id = ?").run(new Date().toISOString(), playlistId);
  return true;
}
