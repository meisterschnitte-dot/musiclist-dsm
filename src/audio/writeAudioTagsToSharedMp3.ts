import { embedId3InMp3Blob } from "./embedId3";
import type { AudioTags } from "./audioTags";

/**
 * Liest MP3 vom Server, schreibt ID3, lädt wieder hoch.
 * `readBinary` / `writeBinary` z. B. über `apiSharedTracksReadBinary` / `apiSharedTracksWriteBinary`.
 */
export async function writeAudioTagsToSharedMp3(
  readBinary: (relativePath: string) => Promise<ArrayBuffer>,
  writeBinary: (relativePath: string, data: ArrayBuffer) => Promise<void>,
  relativePath: string,
  tags: AudioTags
): Promise<void> {
  const buf = await readBinary(relativePath);
  const blob = new Blob([buf]);
  const out = await embedId3InMp3Blob(blob, tags);
  const ab = await out.arrayBuffer();
  await writeBinary(relativePath, ab);
}
