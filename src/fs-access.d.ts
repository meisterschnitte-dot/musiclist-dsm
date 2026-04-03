/** Ergänzungen für File System Access API (Chrome/Edge). */

interface FileSystemHandle {
  queryPermission(descriptor?: { mode?: "read" | "readwrite" }): Promise<"granted" | "denied" | "prompt">;
  requestPermission(descriptor?: { mode?: "read" | "readwrite" }): Promise<"granted" | "denied" | "prompt">;
}

interface Window {
  showDirectoryPicker?: (options?: {
    id?: string;
    mode?: "read" | "readwrite";
    startIn?: FileSystemHandle | "desktop" | "documents" | "downloads" | "music" | "pictures" | "videos";
  }) => Promise<FileSystemDirectoryHandle>;
  /** Chrome/Edge: Dateiauswahl, oft mit `startIn` = gewählter Speicherordner (kein „Teilen“-Dialog). */
  showOpenFilePicker?: (options?: {
    multiple?: boolean;
    startIn?: FileSystemHandle | "desktop" | "documents" | "downloads" | "music" | "pictures" | "videos";
    types?: Array<{ description?: string; accept: Record<string, string[]> }>;
  }) => Promise<FileSystemFileHandle[]>;
}

interface FileSystemDirectoryHandle {
  entries(): AsyncIterableIterator<[string, FileSystemFileHandle | FileSystemDirectoryHandle]>;
  keys(): AsyncIterableIterator<string>;
  values(): AsyncIterableIterator<FileSystemFileHandle | FileSystemDirectoryHandle>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
}
