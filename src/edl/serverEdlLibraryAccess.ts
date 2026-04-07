import {
  apiEdlDeleteDirectory,
  apiEdlDeleteFile,
  apiEdlList,
  apiEdlMkdir,
  apiEdlMoveDirectory,
  apiEdlMoveFile,
  apiEdlReadBinary,
  apiEdlReadText,
  apiEdlRenameDirectory,
  apiEdlWriteBinary,
  apiEdlWriteText,
} from "../api/userEdlLibraryApi";
import type { EdlLibraryAccess } from "./edlLibraryAccess";

/** EDL-Bibliothek unter `data/users/<userId>/edl/` auf dem API-Server. */
export function createServerEdlLibraryAccess(): EdlLibraryAccess {
  return {
    label: "Persönliche Bibliothek (Server)",
    async ensureWritableInteractive() {
      return true;
    },
    list: (segments) => apiEdlList(segments),
    readText: (segments, fileName) => apiEdlReadText(segments, fileName),
    readBinary: (segments, fileName) => apiEdlReadBinary(segments, fileName),
    writeText: (segments, fileName, text) => apiEdlWriteText(segments, fileName, text),
    writeBinary: (segments, fileName, data) => apiEdlWriteBinary(segments, fileName, data),
    mkdir: (parentSegments, name) => apiEdlMkdir(parentSegments, name),
    moveFile: (fromSegments, fileName, toSegments) =>
      apiEdlMoveFile(fromSegments, fileName, toSegments),
    moveDirectory: (fromParentSegments, folderName, toParentSegments) =>
      apiEdlMoveDirectory(fromParentSegments, folderName, toParentSegments),
    deleteFile: (segments, fileName) => apiEdlDeleteFile(segments, fileName),
    deleteDirectory: (pathSegments) => apiEdlDeleteDirectory(pathSegments),
    renameDirectory: (parentSegments, oldName, newName) =>
      apiEdlRenameDirectory(parentSegments, oldName, newName),
  };
}
