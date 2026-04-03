import { embedId3InMp3Blob } from "../audio/embedId3";
import type { AudioTags } from "../audio/audioTags";
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
