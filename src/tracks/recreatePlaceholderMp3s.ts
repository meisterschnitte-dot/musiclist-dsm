import { embedId3InMp3Blob } from "../audio/embedId3";
import type { AudioTags } from "../audio/audioTags";
import { sanitizeFilenameStem, stripExtension } from "./sanitizeFilename";
import { createFakeMp3Blob } from "./fakeMp3Blob";
import { getFileHandleInTracksRoot, splitTracksRelativePath } from "./tracksFolderPaths";
import type { SharedFakeMp3Sink } from "./exportTracks";

/** Relativer Pfad ohne `..` / leere Segmente — für Schreiben unter dem Speicherort. */
export function isSafeTracksRelativePath(relativePath: string): boolean {
  const parts = splitTracksRelativePath(relativePath);
  if (parts.length === 0) return false;
  return parts.every((seg) => seg !== "." && seg !== ".." && seg.trim() !== "");
}

/** `false` = nur Dateiname → Ziel ist der Stammordner des MP3-Speicherorts. */
export function relativePathHasSubfolder(relativePath: string): boolean {
  return relativePath.replace(/\\/g, "/").includes("/");
}

/**
 * Eingabe aus dem Dialog „Neue MP3“ → relativer Pfad mit Endung `.mp3` unter dem Speicherort.
 * `null` bei leerer/unsicherer Eingabe oder wenn der Pfad nicht zulässig ist.
 */
export function normalizeUserInputToRelativeMp3Path(raw: string): string | null {
  let s = raw.trim();
  if (!s) return null;
  s = s.replace(/\\/g, "/");
  if (s.startsWith("/") || /^[a-zA-Z]:\/?/.test(s)) return null;
  const parts = s.split("/").filter((p) => p.length > 0);
  if (parts.length === 0) return null;
  if (parts.some((p) => p === "." || p === "..")) return null;

  const lastIdx = parts.length - 1;
  const lastRaw = parts[lastIdx]!;
  const lowerLast = lastRaw.toLowerCase();
  const fileStem = lowerLast.endsWith(".mp3") ? stripExtension(lastRaw) : lastRaw;
  const fileBase = `${sanitizeFilenameStem(fileStem)}.mp3`;
  const dirParts = parts.slice(0, lastIdx).map((seg) => sanitizeFilenameStem(seg));
  const rel = [...dirParts, fileBase].join("/");
  if (!isSafeTracksRelativePath(rel)) return null;
  return rel;
}

/** Fester Unterordner für über „Neue MP3“ angelegte Dateien (relativ zum MP3-Speicherort). */
export const SONSTIGE_TRACKS_REL_FOLDER = "Sonstige Tracks";

/**
 * Stellt sicher, dass der Pfad unter {@link SONSTIGE_TRACKS_REL_FOLDER} liegt (Präfix wird gesetzt,
 * wenn die Eingabe nicht schon dort beginnt).
 */
export function ensureUnderSonstigeTracksRelativePath(rel: string): string | null {
  const norm = rel.replace(/\\/g, "/");
  const prefix = `${SONSTIGE_TRACKS_REL_FOLDER}/`;
  const out = norm.toLowerCase().startsWith(prefix.toLowerCase()) ? norm : prefix + norm;
  if (!isSafeTracksRelativePath(out)) return null;
  return out;
}

export type RecreatePlaceholderMp3sResult = {
  written: string[];
  skippedExisting: string[];
  failed: { path: string; message: string }[];
};

/**
 * Legt minimale Platzhalter-MP3s mit ID3-Tags an den in der Musikdatenbank gespeicherten
 * relativen Pfaden an (Unterordner werden angelegt). Bereits vorhandene Dateien werden übersprungen.
 */
export async function recreatePlaceholderMp3sAtRelativePaths(
  root: FileSystemDirectoryHandle,
  relativePaths: readonly string[],
  getTagsForPath: (rel: string) => AudioTags | undefined
): Promise<RecreatePlaceholderMp3sResult> {
  const written: string[] = [];
  const skippedExisting: string[] = [];
  const failed: { path: string; message: string }[] = [];

  for (const rel of relativePaths) {
    if (!isSafeTracksRelativePath(rel)) {
      failed.push({ path: rel, message: "Ungültiger oder unsicherer Pfad." });
      continue;
    }
    try {
      await getFileHandleInTracksRoot(root, rel, { create: false });
      skippedExisting.push(rel);
      continue;
    } catch {
      /* Datei fehlt — anlegen */
    }
    try {
      let blob: Blob = createFakeMp3Blob();
      const tags = getTagsForPath(rel);
      if (tags) blob = await embedId3InMp3Blob(blob, tags);
      const fh = await getFileHandleInTracksRoot(root, rel, { create: true });
      const w = await fh.createWritable();
      await w.write(blob);
      await w.close();
      written.push(rel);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      failed.push({ path: rel, message });
    }
  }

  return { written, skippedExisting, failed };
}

type MinimalSharedSink = Pick<SharedFakeMp3Sink, "fileExists" | "writeMp3Blob">;

/**
 * Platzhalter-MP3s auf dem Server anlegen (`sink` z. B. aus Shared-Tracks-API).
 */
export async function recreatePlaceholderMp3sOnShared(
  sink: MinimalSharedSink,
  relativePaths: readonly string[],
  getTagsForPath: (rel: string) => AudioTags | undefined
): Promise<RecreatePlaceholderMp3sResult> {
  const written: string[] = [];
  const skippedExisting: string[] = [];
  const failed: { path: string; message: string }[] = [];

  for (const rel of relativePaths) {
    if (!isSafeTracksRelativePath(rel)) {
      failed.push({ path: rel, message: "Ungültiger oder unsicherer Pfad." });
      continue;
    }
    try {
      if (await sink.fileExists(rel)) {
        skippedExisting.push(rel);
        continue;
      }
    } catch (e) {
      failed.push({
        path: rel,
        message: e instanceof Error ? e.message : String(e),
      });
      continue;
    }
    try {
      let blob: Blob = createFakeMp3Blob();
      const tags = getTagsForPath(rel);
      if (tags) blob = await embedId3InMp3Blob(blob, tags);
      await sink.writeMp3Blob(rel, blob);
      written.push(rel);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      failed.push({ path: rel, message });
    }
  }

  return { written, skippedExisting, failed };
}
