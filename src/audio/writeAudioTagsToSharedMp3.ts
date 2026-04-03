import { embedId3InMp3Blob } from "./embedId3";
import type { AudioTags } from "./audioTags";
import { createFakeMp3Blob } from "../tracks/fakeMp3Blob";

function isMissingFileReadError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /ENOENT|no such file|ENOTDIR/i.test(msg);
}

/**
 * Liest MP3 vom Server, schreibt ID3, lädt wieder hoch.
 * `readBinary` / `writeBinary` z. B. über `apiSharedTracksReadBinary` / `apiSharedTracksWriteBinary`.
 * Fehlt die Datei (nur Verknüpfung / noch kein Transfer), wird ein minimaler Platzhalter-MP3 erzeugt
 * und mit ID3 beschrieben — wie beim Fake-MP3-Export.
 */
export async function writeAudioTagsToSharedMp3(
  readBinary: (relativePath: string) => Promise<ArrayBuffer>,
  writeBinary: (relativePath: string, data: ArrayBuffer) => Promise<void>,
  relativePath: string,
  tags: AudioTags
): Promise<void> {
  let buf: ArrayBuffer;
  try {
    buf = await readBinary(relativePath);
  } catch (e) {
    if (!isMissingFileReadError(e)) throw e;
    buf = await createFakeMp3Blob().arrayBuffer();
  }
  const blob = new Blob([buf]);
  const out = await embedId3InMp3Blob(blob, tags);
  const ab = await out.arrayBuffer();
  await writeBinary(relativePath, ab);
}
