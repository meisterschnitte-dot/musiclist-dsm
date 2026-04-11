import {
  apiCustomerEdlDeleteFile,
  apiCustomerEdlList,
  apiCustomerEdlReadBinary,
  apiCustomerEdlReadText,
} from "../api/customerEdlLibraryApi";
import type { EdlLibraryAccess } from "./edlLibraryAccess";

/** Nur freigegebene Playlists (nach Mail) — gleiche Ordnerstruktur wie die Bibliothek des Admins. */
export function createCustomerServerEdlLibraryAccess(): EdlLibraryAccess {
  const ro = async () => {
    throw new Error("Nur Lesezugriff.");
  };
  return {
    label: "Freigegebene Playlists",
    /** Lesen ist erlaubt; Schreibzugriffe scheitern in den write*-Methoden. */
    ensureWritableInteractive: async () => true,
    list: (segments) => apiCustomerEdlList(segments),
    readText: (segments, fileName) => apiCustomerEdlReadText(segments, fileName),
    readBinary: (segments, fileName) => apiCustomerEdlReadBinary(segments, fileName),
    /** Im Kundenkonto bedeutet „Löschen“ nur: Freigabe ausblenden (Assignment entfernen). */
    deleteFile: (segments, fileName) => apiCustomerEdlDeleteFile(segments, fileName),
    writeText: ro,
    writeBinary: ro,
    mkdir: ro,
    moveFile: ro,
    moveDirectory: ro,
    deleteDirectory: ro,
    renameDirectory: ro,
    renameFile: ro,
  };
}
