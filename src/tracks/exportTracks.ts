import { hasAnyAudioTagValue, mergeWarnungForDisplay, type AudioTags } from "../audio/audioTags";
import { embedId3InMp3Blob } from "../audio/embedId3";
import { readAudioTagsFromBlob } from "../audio/readId3Tags";
import { writeAudioTagsToSharedMp3 } from "../audio/writeAudioTagsToSharedMp3";
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
  /** Index der aktuellen Playlist-Zeile im Export (UI: Tag-Entwürfe zuordnen). */
  playlistIndex: number;
  /** Mindestens ein Eintrag — Reihenfolge: exakte Namen zuerst, dann ähnliche Titel. */
  candidates: DuplicateCandidate[];
  /** Geplante Tags für die neue Datei (wie beim Schreiben). */
  proposedTags: AudioTags;
  /** ID3 aus den Kandidaten-Dateien auf dem Server / Speicherort — nur Musikdatenbank, keine App-Overlays. */
  candidateTagsByPath: Record<string, AudioTags>;
  /**
   * Tag-Editor „Suche in Datenbank“: welche Zeile bzw. Datei die „Neu“-Tags erhält.
   * Beim Export immer unset (nur `playlistIndex`).
   */
  tagEditorTarget?:
    | { kind: "playlist"; index: number }
    | { kind: "file"; fileName: string };
};

export type DuplicateChoice =
  | { action: "different"; proposedTagsEdited: AudioTags }
  | {
      action: "identical";
      existingFileName: string;
      /** Tags für die Playlist-Zeile („Neu“) — wie im Dialog bearbeitet. */
      proposedTagsEdited: AudioTags;
      /** Tags für die bestehende MP3 — wie im Dialog bearbeitet (ID3 wird aktualisiert). */
      existingFileTagsEdited: AudioTags;
    }
  | {
      /** Bestehende Datei(en) am gleichen Pfad durch neue Fake-MP3 + Tags aus „Neu“ ersetzen. */
      action: "overwrite";
      relativePaths: string[];
      proposedTagsEdited: AudioTags;
    };

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
 * Gleiche Logik wie beim Transfer zu MP3 (`exportFakeTracksToSharedStorage`).
 */
export function findDuplicateCandidatesInMusicDbPaths(
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

/** ID3 der Kandidaten-Pfade (Server-Musikdatenbank), für Duplikat-Dialog. */
export async function loadCandidateTagsFromSharedMusicDb(
  paths: string[]
): Promise<Record<string, AudioTags>> {
  const candidateTagsByPath: Record<string, AudioTags> = {};
  for (const p of paths) {
    candidateTagsByPath[p] = await readTagsFromSharedMp3Path(p);
  }
  return candidateTagsByPath;
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

async function rewriteLocalMp3Id3(
  rootDir: FileSystemDirectoryHandle,
  relativePath: string,
  tags: AudioTags
): Promise<void> {
  const parts = relativePath.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.length === 0) return;
  let dir = rootDir;
  for (let i = 0; i < parts.length - 1; i++) {
    dir = await dir.getDirectoryHandle(parts[i]!, { create: false });
  }
  const fh = await dir.getFileHandle(parts[parts.length - 1]!, { create: false });
  const file = await fh.getFile();
  const blob = await embedId3InMp3Blob(file, mergeWarnungForDisplay(tags));
  const writable = await fh.createWritable();
  await writable.write(await blob.arrayBuffer());
  await writable.close();
}

/** Schreibt eine komplette MP3-Blob an einen relativen Pfad unter `rootDir` (überschreibt die Datei). */
async function writeBlobToRelativeMp3Path(
  rootDir: FileSystemDirectoryHandle,
  relativePath: string,
  blob: Blob
): Promise<void> {
  const parts = relativePath.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.length === 0) return;
  let dir = rootDir;
  for (let i = 0; i < parts.length - 1; i++) {
    dir = await dir.getDirectoryHandle(parts[i]!, { create: false });
  }
  const fh = await dir.getFileHandle(parts[parts.length - 1]!, { create: true });
  const writable = await fh.createWritable();
  await writable.write(await blob.arrayBuffer());
  await writable.close();
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
  /** Tag-Stand „Neu“ aus dem Duplikat-Dialog (Playlist-Overlay). */
  duplicateProposedTagsByIndex?: Record<number, AudioTags>;
  /** Bei „identisch“: bestehende Datei — ID3 wurde geschrieben; f:-Overlay nachziehen. */
  duplicateIdenticalFileTagsByIndex?: Record<number, { relativePath: string; tags: AudioTags }>;
  /** Bei „Überschreiben“: überschriebene Pfade + Tag-Stand (f:-Overlay). */
  duplicateOverwriteFileTagsByIndex?: Record<
    number,
    { relativePaths: string[]; tags: AudioTags }
  >;
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
  const duplicateProposedTagsByIndex: Record<number, AudioTags> = {};
  const duplicateIdenticalFileTagsByIndex: Record<
    number,
    { relativePath: string; tags: AudioTags }
  > = {};
  const duplicateOverwriteFileTagsByIndex: Record<
    number,
    { relativePaths: string[]; tags: AudioTags }
  > = {};

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

    const conflicts = findDuplicateCandidatesInMusicDbPaths(stem, proposedFileName, existingMp3Paths);

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
        playlistIndex: index,
        candidates: conflicts,
        proposedTags,
        candidateTagsByPath,
      });

      const propMerged = mergeWarnungForDisplay(choice.proposedTagsEdited);
      duplicateProposedTagsByIndex[index] = propMerged;

      if (choice.action === "identical") {
        /** Bereits relativ zum Speicherort-Root — kein Projekt-Präfix (kann anderer Ordner sein). */
        storedRelativePath = choice.existingFileName;
        identicalChoiceIndices.push(index);
        const exMerged = mergeWarnungForDisplay(choice.existingFileTagsEdited);
        duplicateIdenticalFileTagsByIndex[index] = {
          relativePath: choice.existingFileName,
          tags: exMerged,
        };
        await rewriteLocalMp3Id3(tracksDir, choice.existingFileName, choice.existingFileTagsEdited);
      } else if (choice.action === "overwrite") {
        const paths = choice.relativePaths;
        let blob: Blob = createFakeMp3Blob();
        if (hasAnyAudioTagValue(propMerged)) {
          blob = await embedId3InMp3Blob(blob, propMerged);
        }
        for (const rel of paths) {
          await writeBlobToRelativeMp3Path(tracksDir, rel, blob);
          usedBasenamesLower.add(basenamePath(rel).toLowerCase());
        }
        duplicateOverwriteFileTagsByIndex[index] = { relativePaths: [...paths], tags: propMerged };
        storedRelativePath = paths[0]!;
      } else {
        const newBasename = await nextFreeMp3Name(targetDir, stem, usedBasenamesLower);
        let blob: Blob = createFakeMp3Blob();
        if (hasAnyAudioTagValue(propMerged)) {
          blob = await embedId3InMp3Blob(blob, propMerged);
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

  return {
    updates,
    identicalChoiceIndices,
    duplicateProposedTagsByIndex:
      Object.keys(duplicateProposedTagsByIndex).length > 0 ? duplicateProposedTagsByIndex : undefined,
    duplicateIdenticalFileTagsByIndex:
      Object.keys(duplicateIdenticalFileTagsByIndex).length > 0
        ? duplicateIdenticalFileTagsByIndex
        : undefined,
    duplicateOverwriteFileTagsByIndex:
      Object.keys(duplicateOverwriteFileTagsByIndex).length > 0
        ? duplicateOverwriteFileTagsByIndex
        : undefined,
  };
}

/** Server-Speicher (installationsweit): list/exists/write per Callback. */
export type SharedFakeMp3Sink = {
  listAllMp3RelativePaths: () => Promise<string[]>;
  fileExists: (relativePath: string) => Promise<boolean>;
  writeMp3Blob: (relativePath: string, blob: Blob) => Promise<void>;
};

/** „Überschreibe alten Datensatz“ — wie im Transfer, nur Schreiben auf den Server. */
export async function applyDuplicateOverwriteToSharedStorage(
  choice: Extract<DuplicateChoice, { action: "overwrite" }>,
  sink: SharedFakeMp3Sink
): Promise<void> {
  const propMerged = mergeWarnungForDisplay(choice.proposedTagsEdited);
  let blob: Blob = createFakeMp3Blob();
  if (hasAnyAudioTagValue(propMerged)) {
    blob = await embedId3InMp3Blob(blob, propMerged);
  }
  for (const rel of choice.relativePaths) {
    await sink.writeMp3Blob(rel, blob);
  }
}

async function rewriteSharedMp3Id3(
  relativePath: string,
  tags: AudioTags,
  sink: SharedFakeMp3Sink
): Promise<void> {
  await writeAudioTagsToSharedMp3(
    apiSharedTracksReadBinary,
    async (rel, data) => {
      await sink.writeMp3Blob(rel, new Blob([data], { type: "audio/mpeg" }));
    },
    relativePath,
    tags
  );
}

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
  const duplicateProposedTagsByIndex: Record<number, AudioTags> = {};
  const duplicateIdenticalFileTagsByIndex: Record<
    number,
    { relativePath: string; tags: AudioTags }
  > = {};
  const duplicateOverwriteFileTagsByIndex: Record<
    number,
    { relativePaths: string[]; tags: AudioTags }
  > = {};

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

    const conflicts = findDuplicateCandidatesInMusicDbPaths(stem, proposedFileName, existingMp3Paths);

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
        playlistIndex: index,
        candidates: conflicts,
        proposedTags,
        candidateTagsByPath,
      });

      const propMerged = mergeWarnungForDisplay(choice.proposedTagsEdited);
      duplicateProposedTagsByIndex[index] = propMerged;

      if (choice.action === "identical") {
        storedRelativePath = choice.existingFileName;
        identicalChoiceIndices.push(index);
        const exMerged = mergeWarnungForDisplay(choice.existingFileTagsEdited);
        duplicateIdenticalFileTagsByIndex[index] = {
          relativePath: choice.existingFileName,
          tags: exMerged,
        };
        await rewriteSharedMp3Id3(choice.existingFileName, choice.existingFileTagsEdited, sink);
      } else if (choice.action === "overwrite") {
        const paths = choice.relativePaths;
        let blob: Blob = createFakeMp3Blob();
        if (hasAnyAudioTagValue(propMerged)) {
          blob = await embedId3InMp3Blob(blob, propMerged);
        }
        for (const rel of paths) {
          await sink.writeMp3Blob(rel, blob);
          usedBasenamesLower.add(basenamePath(rel).toLowerCase());
        }
        duplicateOverwriteFileTagsByIndex[index] = { relativePaths: [...paths], tags: propMerged };
        storedRelativePath = paths[0]!;
      } else {
        const newBasename = await nextFreeMp3NameShared(
          prefixRel,
          stem,
          usedBasenamesLower,
          sink.fileExists
        );
        let blob: Blob = createFakeMp3Blob();
        if (hasAnyAudioTagValue(propMerged)) {
          blob = await embedId3InMp3Blob(blob, propMerged);
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

  return {
    updates,
    identicalChoiceIndices,
    duplicateProposedTagsByIndex:
      Object.keys(duplicateProposedTagsByIndex).length > 0 ? duplicateProposedTagsByIndex : undefined,
    duplicateIdenticalFileTagsByIndex:
      Object.keys(duplicateIdenticalFileTagsByIndex).length > 0
        ? duplicateIdenticalFileTagsByIndex
        : undefined,
    duplicateOverwriteFileTagsByIndex:
      Object.keys(duplicateOverwriteFileTagsByIndex).length > 0
        ? duplicateOverwriteFileTagsByIndex
        : undefined,
  };
}

