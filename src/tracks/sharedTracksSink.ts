import {
  apiSharedMusicDbFetch,
  apiSharedTracksExists,
  apiSharedTracksWriteBinary,
} from "../api/sharedTracksApi";
import type { SharedFakeMp3Sink } from "./exportTracks";

export function createSharedFakeMp3Sink(): SharedFakeMp3Sink {
  return {
    listAllMp3RelativePaths: async () => (await apiSharedMusicDbFetch()).paths,
    fileExists: (relativePath) => apiSharedTracksExists(relativePath),
    writeMp3Blob: async (relativePath, blob) => {
      const ab = await blob.arrayBuffer();
      await apiSharedTracksWriteBinary(relativePath, ab);
    },
  };
}
