import { getUsersApiToken } from "./authToken";

const API = "/api";

export type ServerStoragePaths = {
  dataDir: string;
  sharedDir: string;
  tracksDir: string;
  edlLibraryDir: string;
};

async function parseError(res: Response): Promise<string> {
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  return data.error || `Anfrage fehlgeschlagen (${res.status}).`;
}

/** Auf dem Server aufgelöste Verzeichnisse (nur mit Bearer-Session). */
export async function apiStoragePathsFetch(): Promise<ServerStoragePaths> {
  const t = getUsersApiToken();
  if (!t) throw new Error("Nicht angemeldet.");
  const res = await fetch(`${API}/storage-paths`, {
    headers: { Authorization: `Bearer ${t}` },
  });
  if (!res.ok) throw new Error(await parseError(res));
  const data = (await res.json()) as ServerStoragePaths;
  if (
    typeof data.dataDir !== "string" ||
    typeof data.sharedDir !== "string" ||
    typeof data.tracksDir !== "string" ||
    typeof data.edlLibraryDir !== "string"
  ) {
    throw new Error("Ungültige Antwort vom Server.");
  }
  return data;
}
