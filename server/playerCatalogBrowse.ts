import fs from "node:fs";
import path from "node:path";
import { getPlayerLastBrowsePath, setPlayerLastBrowsePath } from "./playerCatalogSettings";
import { playerCatalogExistingPathSet } from "./playerCatalogSqlite";

const AUDIO_EXT = new Set([".mp3", ".wav", ".wave", ".m4a", ".flac", ".ogg"]);
const SKIP_DIR = new Set(["$recycle.bin", "system volume information", ".git", "node_modules"]);

export type PlayerBrowseEntry = {
  name: string;
  path: string;
  kind: "dir" | "file";
  ingested: boolean;
};

export type PlayerBrowseResult = {
  path: string;
  parent: string | null;
  entries: PlayerBrowseEntry[];
  focusPath: string | null;
};

function stripCopiedPath(raw: string): string {
  let s = raw.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

function listWindowsDrives(): PlayerBrowseEntry[] {
  const out: PlayerBrowseEntry[] = [];
  for (let i = 65; i <= 90; i += 1) {
    const letter = String.fromCharCode(i);
    const root = `${letter}:\\`;
    try {
      if (fs.existsSync(root) && fs.statSync(root).isDirectory()) {
        out.push({ name: `${letter}:`, path: path.resolve(root), kind: "dir", ingested: false });
      }
    } catch {
      /* skip */
    }
  }
  return out;
}

function listDirectory(abs: string): PlayerBrowseResult {
  setPlayerLastBrowsePath(abs);
  const parsed = path.parse(abs);
  const parent = parsed.root === abs ? "" : path.dirname(abs);
  let names: string[] = [];
  try {
    names = fs.readdirSync(abs, { encoding: "utf8" });
  } catch {
    throw new Error("Ordner nicht lesbar.");
  }
  const entries: PlayerBrowseEntry[] = [];
  for (const name of names) {
    if (name.startsWith(".") && name !== ".") continue;
    const full = path.join(abs, name);
    let ent: fs.Stats;
    try {
      ent = fs.statSync(full);
    } catch {
      continue;
    }
    if (ent.isDirectory()) {
      if (SKIP_DIR.has(name.toLowerCase())) continue;
      entries.push({ name, path: full, kind: "dir", ingested: false });
      continue;
    }
    if (!ent.isFile()) continue;
    if (!AUDIO_EXT.has(path.extname(name).toLowerCase())) continue;
    entries.push({ name, path: full, kind: "file", ingested: false });
  }
  entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name, "de", { numeric: true, sensitivity: "base" });
  });
  const filePaths = entries.filter((e) => e.kind === "file").map((e) => e.path);
  const existing = playerCatalogExistingPathSet(filePaths);
  for (const entry of entries) {
    if (entry.kind === "file") entry.ingested = existing.has(entry.path);
  }
  return { path: abs, parent, entries, focusPath: null };
}

export function browsePlayerFilesystem(rawPath: string): PlayerBrowseResult {
  const trimmed = stripCopiedPath(rawPath);
  if (!trimmed) {
    return { path: "", parent: null, entries: listWindowsDrives(), focusPath: null };
  }
  const abs = path.resolve(trimmed);
  let st: fs.Stats;
  try {
    st = fs.statSync(abs);
  } catch {
    throw new Error("Pfad nicht gefunden.");
  }
  if (st.isDirectory()) return listDirectory(abs);
  if (!st.isFile()) throw new Error("Pfad ist kein Ordner oder keine Datei.");
  if (!AUDIO_EXT.has(path.extname(abs).toLowerCase())) {
    throw new Error("Keine Audiodatei.");
  }
  const listed = listDirectory(path.dirname(abs));
  return { ...listed, focusPath: abs };
}

export function defaultPlayerBrowsePath(): string {
  const last = getPlayerLastBrowsePath();
  if (last && fs.existsSync(last)) return last;
  return "";
}
