import type { AudioTags } from "../audio/audioTags";
import { embedId3InMp3Blob } from "../audio/embedId3";
import { titlesLikelySame } from "../edl/similarTitle";
import type { PlaylistEntry } from "../edl/types";
import { createFakeMp3Blob } from "./fakeMp3Blob";
import {
  basenamePath,
  sanitizeFilenameStem,
  stemForProjectFolder,
  stripExtension,
} from "./sanitizeFilename";

/**
 * Ordnername unter dem Speicherort: aus EDL-/Playlist-Dateiname oder Titel-Zeile.
 * Wenn nichts Passt: `undefined` → MP3s liegen direkt im Speicherort (wie bisher).
 */
export function deriveExportProjectFolderName(params: {
  fileName: string | null;
  edlTitle: string | null;
  loadedLibraryFileName: string | null;
}): string | undefined {
  const { fileName, edlTitle, loadedLibraryFileName } = params;
  const primary = loadedLibraryFileName?.trim() || fileName?.trim();
  if (primary) {
    const lower = primary.toLowerCase();
    if (
      lower.endsWith(".edl") ||
      lower.endsWith(".list") ||
      lower.endsWith(".egpl") ||
      lower.endsWith(".xls")
    ) {
      const stem = stemForProjectFolder(primary);
      if (stem) return stem;
    }
  }
  if (fileName?.toLowerCase().endsWith(".edl")) {
    const stem = stemForProjectFolder(fileName);
    if (stem) return stem;
  }
  if (edlTitle?.trim()) {
    const stem = sanitizeFilenameStem(edlTitle);
    if (stem) return stem;
  }
  return undefined;
}

export type DuplicatePrompt = {
  playlistTitle: string;
  proposedFileName: string;
  existingFileName: string;
};

export type DuplicateChoice = "identical" | "different";

/** Alle `.mp3`-Pfade relativ zum Speicherort-Root (rekursiv, Ordnerübergreifend). */
async function listAllMp3RelativePathsUnderRoot(
  root: FileSystemDirectoryHandle,
  prefix = ""
): Promise<string[]> {
  const out: string[] = [];
  for await (const [name, handle] of root.entries()) {
    const rel = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === "file" && name.toLowerCase().endsWith(".mp3")) {
      out.push(rel);
    } else if (handle.kind === "directory") {
      const subDir = await root.getDirectoryHandle(name, { create: false });
      const sub = await listAllMp3RelativePathsUnderRoot(subDir, rel);
      out.push(...sub);
    }
  }
  return out;
}

/**
 * Konflikt mit **bereits vorhandenen** MP3s (typ. Musikdatenbank vor diesem Lauf).
 * Nur Basisname / ähnlicher Titel; kein Ordnerpfad. Nicht für frisch im gleichen Export erzeugte Dateien verwenden.
 */
function findConflictingFile(
  proposedStem: string,
  proposedFileName: string,
  existingRelativePaths: string[]
): { kind: "exact" | "similar"; existingFileName: string } | null {
  const exact = existingRelativePaths.find(
    (p) => basenamePath(p).toLowerCase() === proposedFileName.toLowerCase()
  );
  if (exact) return { kind: "exact", existingFileName: exact };

  for (const rel of existingRelativePaths) {
    const stem = stripExtension(basenamePath(rel));
    if (titlesLikelySame(proposedStem, stem)) {
      return { kind: "similar", existingFileName: rel };
    }
  }
  return null;
}

async function fileExists(dir: FileSystemDirectoryHandle, name: string): Promise<boolean> {
  try {
    await dir.getFileHandle(name, { create: false });
    return true;
  } catch {
    return false;
  }
}

/** `usedBasenamesLower` = alle bereits vergebenen Dateinamen (nur Name, alle Ordner). */
async function nextFreeMp3Name(
  dir: FileSystemDirectoryHandle,
  stem: string,
  usedBasenamesLower: Set<string>
): Promise<string> {
  let candidate = `${stem}.mp3`;
  let n = 2;
  while (
    usedBasenamesLower.has(candidate.toLowerCase()) ||
    (await fileExists(dir, candidate))
  ) {
    candidate = `${stem}_${n}.mp3`;
    n++;
  }
  return candidate;
}

async function writeMp3(dir: FileSystemDirectoryHandle, fileName: string, blob: Blob): Promise<void> {
  const handle = await dir.getFileHandle(fileName, { create: true });
  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
}

export type ExportTracksCallbacks = {
  onDuplicate: (info: DuplicatePrompt) => Promise<DuplicateChoice>;
  /** Optional: ID3-Tags pro Playlist-Zeile (Index). */
  getTagsForIndex?: (index: number) => AudioTags | undefined;
  /**
   * Wenn gesetzt: MP3s landen in `Speicherort/<Name>/…`.
   * `deriveExportProjectFolderName` aus EDL-/Playlist-Dateiname oder Titel.
   */
  projectFolderName?: string;
};

export type ExportTracksResult = {
  updates: { index: number; linkedTrackFileName: string }[];
  /** Playlist-Indizes, bei denen der Nutzer eine bereits vorhandene Datei als identisch gewählt hat (keine neue MP3 geschrieben). */
  identicalChoiceIndices: number[];
};

/**
 * Legt Fake-MP3s im Ordner an. Bei Konflikten wird onDuplicate aufgerufen.
 * `tracksDir` = Handle auf den gewählten Speicherordner (Schreibzugriff).
 */
export async function exportFakeTracksToTracksFolder(
  playlist: PlaylistEntry[],
  tracksDir: FileSystemDirectoryHandle,
  { onDuplicate, getTagsForIndex, projectFolderName }: ExportTracksCallbacks
): Promise<ExportTracksResult> {
  const updates: { index: number; linkedTrackFileName: string }[] = [];
  const identicalChoiceIndices: number[] = [];

  const folderStem =
    projectFolderName?.trim() && projectFolderName.trim().length > 0
      ? sanitizeFilenameStem(projectFolderName.trim()) || "EDL"
      : null;
  const targetDir = folderStem
    ? await tracksDir.getDirectoryHandle(folderStem, { create: true })
    : tracksDir;

  const prefixRel = folderStem ? `${folderStem}/` : "";

  /** Nur Stand vor diesem Export — Vergleich für „bereits vorhanden“ darf nicht Zeilen derselben Transfer-Liste miteinander vergleichen. */
  const existingMp3Paths = await listAllMp3RelativePathsUnderRoot(tracksDir);
  const usedBasenamesLower = new Set(
    existingMp3Paths.map((p) => basenamePath(p).toLowerCase())
  );

  for (let index = 0; index < playlist.length; index++) {
    const row = playlist[index];
    const raw = row.linkedTrackFileName ?? row.title;
    const stem = sanitizeFilenameStem(stripExtension(raw));
    const proposedFileName = `${stem}.mp3`;

    const conflict = findConflictingFile(stem, proposedFileName, existingMp3Paths);

    let storedRelativePath: string;

    if (conflict) {
      const choice = await onDuplicate({
        playlistTitle: row.title,
        proposedFileName,
        existingFileName: conflict.existingFileName,
      });

      if (choice === "identical") {
        /** Bereits relativ zum Speicherort-Root — kein Projekt-Präfix (kann anderer Ordner sein). */
        storedRelativePath = conflict.existingFileName;
        identicalChoiceIndices.push(index);
      } else {
        const newBasename = await nextFreeMp3Name(targetDir, stem, usedBasenamesLower);
        let blob: Blob = createFakeMp3Blob();
        const tagOpt = getTagsForIndex?.(index);
        if (tagOpt) {
          blob = await embedId3InMp3Blob(blob, tagOpt);
        }
        await writeMp3(targetDir, newBasename, blob);
        usedBasenamesLower.add(newBasename.toLowerCase());
        storedRelativePath = prefixRel ? `${prefixRel}${newBasename}` : newBasename;
      }
    } else {
      const newBasename = await nextFreeMp3Name(targetDir, stem, usedBasenamesLower);
      let blob: Blob = createFakeMp3Blob();
      const tagOpt = getTagsForIndex?.(index);
      if (tagOpt) {
        blob = await embedId3InMp3Blob(blob, tagOpt);
      }
      await writeMp3(targetDir, newBasename, blob);
      usedBasenamesLower.add(newBasename.toLowerCase());
      storedRelativePath = prefixRel ? `${prefixRel}${newBasename}` : newBasename;
    }

    updates.push({ index, linkedTrackFileName: storedRelativePath });
  }

  return { updates, identicalChoiceIndices };
}

/** Server-Speicher (installationsweit): list/exists/write per Callback. */
export type SharedFakeMp3Sink = {
  listAllMp3RelativePaths: () => Promise<string[]>;
  fileExists: (relativePath: string) => Promise<boolean>;
  writeMp3Blob: (relativePath: string, blob: Blob) => Promise<void>;
};

async function nextFreeMp3NameShared(
  prefixRel: string,
  stem: string,
  usedBasenamesLower: Set<string>,
  fileExists: (relativePath: string) => Promise<boolean>
): Promise<string> {
  const rel = (name: string) => (prefixRel ? `${prefixRel}${name}` : name);
  let candidate = `${stem}.mp3`;
  let n = 2;
  while (
    usedBasenamesLower.has(candidate.toLowerCase()) ||
    (await fileExists(rel(candidate)))
  ) {
    candidate = `${stem}_${n}.mp3`;
    n++;
  }
  return candidate;
}

/**
 * Wie `exportFakeTracksToTracksFolder`, aber über `SharedFakeMp3Sink` (API-Server).
 */
export async function exportFakeTracksToSharedStorage(
  playlist: PlaylistEntry[],
  sink: SharedFakeMp3Sink,
  { onDuplicate, getTagsForIndex, projectFolderName }: ExportTracksCallbacks
): Promise<ExportTracksResult> {
  const updates: { index: number; linkedTrackFileName: string }[] = [];
  const identicalChoiceIndices: number[] = [];

  const folderStem =
    projectFolderName?.trim() && projectFolderName.trim().length > 0
      ? sanitizeFilenameStem(projectFolderName.trim()) || "EDL"
      : null;

  const prefixRel = folderStem ? `${folderStem}/` : "";

  const existingMp3Paths = await sink.listAllMp3RelativePaths();
  const usedBasenamesLower = new Set(
    existingMp3Paths.map((p) => basenamePath(p).toLowerCase())
  );

  for (let index = 0; index < playlist.length; index++) {
    const row = playlist[index];
    const raw = row.linkedTrackFileName ?? row.title;
    const stem = sanitizeFilenameStem(stripExtension(raw));
    const proposedFileName = `${stem}.mp3`;

    const conflict = findConflictingFile(stem, proposedFileName, existingMp3Paths);

    let storedRelativePath: string;

    if (conflict) {
      const choice = await onDuplicate({
        playlistTitle: row.title,
        proposedFileName,
        existingFileName: conflict.existingFileName,
      });

      if (choice === "identical") {
        storedRelativePath = conflict.existingFileName;
        identicalChoiceIndices.push(index);
      } else {
        const newBasename = await nextFreeMp3NameShared(
          prefixRel,
          stem,
          usedBasenamesLower,
          sink.fileExists
        );
        let blob: Blob = createFakeMp3Blob();
        const tagOpt = getTagsForIndex?.(index);
        if (tagOpt) {
          blob = await embedId3InMp3Blob(blob, tagOpt);
        }
        storedRelativePath = prefixRel ? `${prefixRel}${newBasename}` : newBasename;
        await sink.writeMp3Blob(storedRelativePath, blob);
        usedBasenamesLower.add(newBasename.toLowerCase());
        existingMp3Paths.push(storedRelativePath);
      }
    } else {
      const newBasename = await nextFreeMp3NameShared(
        prefixRel,
        stem,
        usedBasenamesLower,
        sink.fileExists
      );
      let blob: Blob = createFakeMp3Blob();
      const tagOpt = getTagsForIndex?.(index);
      if (tagOpt) {
        blob = await embedId3InMp3Blob(blob, tagOpt);
      }
      storedRelativePath = prefixRel ? `${prefixRel}${newBasename}` : newBasename;
      await sink.writeMp3Blob(storedRelativePath, blob);
      usedBasenamesLower.add(newBasename.toLowerCase());
      existingMp3Paths.push(storedRelativePath);
    }

    updates.push({ index, linkedTrackFileName: storedRelativePath });
  }

  return { updates, identicalChoiceIndices };
}

