import type { EdlDirEntry } from "./edlLibraryFs";

export type { EdlDirEntry };

/** Inhalt einer Bibliotheksdatei zum Öffnen in der App (EDL-Text, Playlist-JSON oder XLS). */
export type OpenLibraryFilePayload = {
  parentSegments: string[];
  fileName: string;
  text?: string;
  arrayBuffer?: ArrayBuffer;
};

/**
 * Zugriff auf die EDL-/Playlist-Bibliothek — lokal (File System Access) oder Server (`data/users/…/edl`).
 */
export type EdlLibraryAccess = {
  /** Kurzbezeichnung für die UI (z. B. Ordnername oder „Server“). */
  label: string;
  list(segments: string[]): Promise<EdlDirEntry[]>;
  readText(segments: string[], fileName: string): Promise<string>;
  readBinary(segments: string[], fileName: string): Promise<ArrayBuffer>;
  writeText(segments: string[], fileName: string, text: string): Promise<void>;
  writeBinary(segments: string[], fileName: string, data: ArrayBuffer): Promise<void>;
  mkdir(parentSegments: string[], name: string): Promise<void>;
  moveFile(fromSegments: string[], fileName: string, toSegments: string[]): Promise<void>;
  /** Ordner (`fromParent` + `folderName`) unter `toParent` ablegen. */
  moveDirectory(fromParentSegments: string[], folderName: string, toParentSegments: string[]): Promise<void>;
  deleteFile(segments: string[], fileName: string): Promise<void>;
  deleteDirectory(pathSegments: string[]): Promise<void>;
  renameDirectory(parentSegments: string[], oldName: string, newName: string): Promise<void>;
  /** Vor interaktivem Neu-Laden (z. B. Berechtigung) — Server: immer ok wenn angemeldet. */
  ensureWritableInteractive?(): Promise<boolean>;
};
