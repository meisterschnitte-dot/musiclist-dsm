import { apiSharedTracksDeleteFile } from "../api/sharedTracksApi";

export type DeleteMp3FromSharedResult = {
  removed: string[];
  failed: { path: string; message: string }[];
};

export async function deleteMp3FilesFromSharedStorage(
  relativePaths: string[]
): Promise<DeleteMp3FromSharedResult> {
  const removed: string[] = [];
  const failed: { path: string; message: string }[] = [];
  for (const path of relativePaths) {
    try {
      await apiSharedTracksDeleteFile(path);
      removed.push(path);
    } catch (e) {
      failed.push({
        path,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return { removed, failed };
}
