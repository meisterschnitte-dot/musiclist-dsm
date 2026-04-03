import { embedId3InMp3Blob } from "./embedId3";
import type { AudioTags } from "./audioTags";
import { getFileHandleInTracksRoot } from "../tracks/tracksFolderPaths";

/**
 * Schreibt die übergebenen Tags als ID3 in die bestehende MP3-Datei im Tracks-Ordner.
 * `relativePath` z. B. `Unterordner/track.mp3` oder `track.mp3`.
 * @throws Wenn die Datei fehlt oder nicht beschrieben werden kann.
 */
export async function writeAudioTagsToMp3File(
  tracksDir: FileSystemDirectoryHandle,
  relativePath: string,
  tags: AudioTags
): Promise<void> {
  const handle = await getFileHandleInTracksRoot(tracksDir, relativePath, { create: false });
  const file = await handle.getFile();
  const blob = await embedId3InMp3Blob(file, tags);
  const writable = await handle.createWritable();
  try {
    await writable.write(blob);
  } finally {
    await writable.close();
  }
}
