import { removeFileRelativeToTracksRoot } from "./tracksFolderPaths";

export type DeleteMp3FilesResult = {
  removed: string[];
  failed: { path: string; message: string }[];
};

export async function deleteMp3FilesFromTracksFolder(
  tracksDir: FileSystemDirectoryHandle,
  relativePaths: string[]
): Promise<DeleteMp3FilesResult> {
  const removed: string[] = [];
  const failed: { path: string; message: string }[] = [];
  for (const path of relativePaths) {
    try {
      await removeFileRelativeToTracksRoot(tracksDir, path);
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
