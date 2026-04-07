import { mergeWarnungForDisplay, type AudioTags } from "../audio/audioTags";
import { embedId3InMp3Blob } from "../audio/embedId3";
import { readAudioTagsFromBlob } from "../audio/readId3Tags";
import { apiSharedTracksReadBinary } from "../api/sharedTracksApi";
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

export type DuplicateCandidateKind = "exact" | "similar";

/** Ein Treffer in der Musikdatenbank (exakter Dateiname oder ähnlicher Titel). */
export type DuplicateCandidate = {
  kind: DuplicateCandidateKind;
  existingFileName: string;
};

export type DuplicatePrompt = {
  playlistTitle: string;
  proposedFileName: string;
  /** Mindestens ein Eintrag — Reihenfolge: exakte Namen zuerst, dann ähnliche Titel. */
  candidates: DuplicateCandidate[];
  /** Geplante Tags für die neue Datei (wie beim Schreiben). */
  proposedTags: AudioTags;
  /** ID3 aus den Kandidaten-Dateien (Pfad wie in der Musikdatenbank). */
  candidateTagsByPath: Record<string, AudioTags>;
};

export type DuplicateChoice =
  | { action: "different" }
  | { action: "identical"; existingFileName: string };

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
 * Alle passenden bestehenden MP3s (Musikdatenbank vor diesem Lauf): zuerst exakt gleicher Basisname,
 * dann ähnlicher Titel — ohne doppelte Pfade.
 */
function findConflictingFiles(
  proposedStem: string,
  proposedFileName: string,
  existingRelativePaths: string[]
): DuplicateCandidate[] {
  const out: DuplicateCandidate[] = [];
  const seen = new Set<string>();
  for (const p of existingRelativePaths) {
    if (basenamePath(p).toLowerCase() === proposedFileName.toLowerCase()) {
      if (!seen.has(p)) {
        seen.add(p);
        out.push({ kind: "exact", existingFileName: p });
      }
    }
  }
  for (const rel of existingRelativePaths) {
    if (seen.has(rel)) continue;
    const stem = stripExtension(basenamePath(rel));
    if (titlesLikelySame(proposedStem, stem)) {
      seen.add(rel);
      out.push({ kind: "similar", existingFileName: rel });
    }
  }
  return out;
}

async function readTagsFromSharedMp3Path(relativePath: string): Promise<AudioTags> {
  try {
    const ab = await apiSharedTracksReadBinary(relativePath);
    const file = new File([ab], basenamePath(relativePath), { type: "audio/mpeg" });
    return mergeWarnungForDisplay(await readAudioTagsFromBlob(file));
  } catch {
    return {};
  }
}

async function readTagsFromLocalMp3Path(
  rootDir: FileSystemDirectoryHandle,
  relativePath: string
): Promise<AudioTags> {
  try {
    const parts = relativePath.replace(/\\/g, "/").split("/").filter(Boolean);
    if (parts.length === 0) return {};
    let dir = rootDir;
    for (let i = 0; i < parts.length - 1; i++) {
      dir = await dir.getDirectoryHandle(parts[i]!, { create: false });
    }
    const fh = await dir.getFileHandle(parts[parts.length - 1]!, { create: false });
    const file = await fh.getFile();
    return mergeWarnungForDisplay(await readAudioTagsFromBlob(file));
  } catch {
    return {};
  }
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
  /** Nur diese Playlist-Indizes exportieren (z. B. nur „offline“ ohne Eintrag in der Musikdatenbank). */
  onlyIndices?: Set<number>;
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
  { onDuplicate, getTagsForIndex, projectFolderName, onlyIndices }: ExportTracksCallbacks
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

  const stemToPathThisExport = new Map<string, string>();

  for (let index = 0; index < playlist.length; index++) {
    if (onlyIndices && !onlyIndices.has(index)) continue;

    const row = playlist[index];
    const raw = row.linkedTrackFileName ?? row.title;
    const stem = sanitizeFilenameStem(stripExtension(raw));
    const proposedFileName = `${stem}.mp3`;

    const reusedInThisExport = stemToPathThisExport.get(stem);
    if (reusedInThisExport) {
      updates.push({ index, linkedTrackFileName: reusedInThisExport });
      continue;
    }

    const conflicts = findConflictingFiles(stem, proposedFileName, existingMp3Paths);

    let storedRelativePath: string;

    if (conflicts.length > 0) {
      const proposedTags: AudioTags = getTagsForIndex?.(index) ? { ...getTagsForIndex(index)! } : {};
      const candidateTagsByPath: Record<string, AudioTags> = {};
      for (const c of conflicts) {
        candidateTagsByPath[c.existingFileName] = await readTagsFromLocalMp3Path(tracksDir, c.existingFileName);
      }
      const choice = await onDuplicate({
        playlistTitle: row.title,
        proposedFileName,
        candidates: conflicts,
        proposedTags,
        candidateTagsByPath,
      });

      if (choice.action === "identical") {
        /** Bereits relativ zum Speicherort-Root — kein Projekt-Präfix (kann anderer Ordner sein). */
        storedRelativePath = choice.existingFileName;
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

    stemToPathThisExport.set(stem, storedRelativePath);
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
  { onDuplicate, getTagsForIndex, projectFolderName, onlyIndices }: ExportTracksCallbacks
): Promise<ExportTracksResult> {
  const updates: { index: number; linkedTrackFileName: string }[] = [];
  const identicalChoiceIndices: number[] = [];

  const folderStem =
    projectFolderName?.trim() && projectFolderName.trim().length > 0
      ? sanitizeFilenameStem(projectFolderName.trim()) || "EDL"
      : null;

  const prefixRel = folderStem ? `${folderStem}/` : "";

  /**
   * Nur Snapshot vor diesem Lauf — wie bei `exportFakeTracksToTracksFolder`.
   * Nicht nach jedem Schreiben erweitern: sonst würde die nächste Playlist-Zeile
   * die gerade erzeugte MP3 als „bereits vorhanden“ sehen und fälschlich den
   * Duplikat-Dialog auslösen (Vergleich nur mit echter Musikdatenbank / Platte vor Transfer).
   */
  const existingMp3Paths = await sink.listAllMp3RelativePaths();
  const usedBasenamesLower = new Set(
    existingMp3Paths.map((p) => basenamePath(p).toLowerCase())
  );

  const stemToPathThisExport = new Map<string, string>();

  for (let index = 0; index < playlist.length; index++) {
    if (onlyIndices && !onlyIndices.has(index)) continue;

    const row = playlist[index];
    const raw = row.linkedTrackFileName ?? row.title;
    const stem = sanitizeFilenameStem(stripExtension(raw));
    const proposedFileName = `${stem}.mp3`;

    const reusedInThisExport = stemToPathThisExport.get(stem);
    if (reusedInThisExport) {
      updates.push({ index, linkedTrackFileName: reusedInThisExport });
      continue;
    }

    const conflicts = findConflictingFiles(stem, proposedFileName, existingMp3Paths);

    let storedRelativePath: string;

    if (conflicts.length > 0) {
      const proposedTags: AudioTags = getTagsForIndex?.(index) ? { ...getTagsForIndex(index)! } : {};
      const candidateTagsByPath: Record<string, AudioTags> = {};
      for (const c of conflicts) {
        candidateTagsByPath[c.existingFileName] = await readTagsFromSharedMp3Path(c.existingFileName);
      }
      const choice = await onDuplicate({
        playlistTitle: row.title,
        proposedFileName,
        candidates: conflicts,
        proposedTags,
        candidateTagsByPath,
      });

      if (choice.action === "identical") {
        storedRelativePath = choice.existingFileName;
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
    }

    stemToPathThisExport.set(stem, storedRelativePath);
    updates.push({ index, linkedTrackFileName: storedRelativePath });
  }

  return { updates, identicalChoiceIndices };
}

