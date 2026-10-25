import fs from "node:fs";
import path from "node:path";
import { getDataDir } from "./userStore";

type PlayerSettings = { archiveRoot: string; lastBrowsePath: string };

const SETTINGS_FILE = () => path.join(getDataDir(), "player", "settings.json");

function readSettings(): PlayerSettings {
  let archiveRoot = process.env.MUSICLIST_PLAYER_ARCHIVE_ROOT?.trim() || "";
  let lastBrowsePath = "";
  try {
    const raw = fs.readFileSync(SETTINGS_FILE(), "utf8");
    const o = JSON.parse(raw) as { archiveRoot?: unknown; lastBrowsePath?: unknown };
    if (typeof o.archiveRoot === "string" && o.archiveRoot.trim()) archiveRoot = o.archiveRoot.trim();
    if (typeof o.lastBrowsePath === "string" && o.lastBrowsePath.trim()) lastBrowsePath = o.lastBrowsePath.trim();
  } catch {
    /* missing or invalid */
  }
  return { archiveRoot, lastBrowsePath };
}

function writeSettings(next: PlayerSettings): void {
  const dir = path.dirname(SETTINGS_FILE());
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(SETTINGS_FILE(), JSON.stringify(next, null, 2), "utf8");
}

export function getPlayerArchiveRoot(): string {
  return readSettings().archiveRoot;
}

export function getPlayerLastBrowsePath(): string {
  return readSettings().lastBrowsePath;
}

export function setPlayerLastBrowsePath(raw: string): string {
  const resolved = path.resolve(raw.trim());
  const prev = readSettings();
  writeSettings({ ...prev, lastBrowsePath: resolved });
  return resolved;
}

export function resolveStoredTrackPath(stored: string, archiveRoot = getPlayerArchiveRoot()): string {
  const raw = stored.replace(/\0/g, "").trim();
  if (!raw) throw new Error("Ungültiger Track-Pfad.");
  if (path.isAbsolute(raw)) return path.resolve(raw);
  if (!archiveRoot) throw new Error("Datei nicht gefunden.");
  const norm = raw.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!norm || norm.split("/").some((p) => p === ".." || p === ".")) {
    throw new Error("Ungültiger Track-Pfad.");
  }
  return path.resolve(archiveRoot, ...norm.split("/").filter(Boolean));
}

/** @deprecated Use resolveStoredTrackPath */
export function resolvePlayerTrackAbsolute(relPath: string, archiveRoot = getPlayerArchiveRoot()): string {
  return resolveStoredTrackPath(relPath, archiveRoot);
}
