import { getUsersApiToken } from "./authToken";
import type { MusikverlagId } from "../musikverlage/musikverlageCatalog";
import type { WcpmTagPayload } from "../musikverlage/wcpmTable";

const API = "/api";

async function parseError(res: Response): Promise<string> {
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  return data.error || `Anfrage fehlgeschlagen (${res.status}).`;
}

export type MusikverlageCatalogRow = {
  id: MusikverlagId;
  label: string;
  hint: string;
};

export type MusikverlageEntryDto = {
  apiBaseUrl: string;
  xlsxFileName: string | null;
  xlsxUploadedAtIso: string | null;
  xlsxFileCount: number;
  xlsxFileNames: string[];
  hasFile: boolean;
  /** SQLite-Zuordnungstabelle aus der Excel (nur bei hochgeladener Datei). */
  hasTableDb: boolean;
  tableDbRowCount: number | null;
};

export type MusikverlageStateResponse = {
  catalog: MusikverlageCatalogRow[];
  entries: Record<string, MusikverlageEntryDto>;
};

export async function fetchMusikverlageState(): Promise<MusikverlageStateResponse> {
  const t = getUsersApiToken();
  if (!t) throw new Error("Nicht angemeldet.");
  const res = await fetch(`${API}/admin/musikverlage`, {
    headers: { Authorization: `Bearer ${t}` },
  });
  if (!res.ok) throw new Error(await parseError(res));
  return (await res.json()) as MusikverlageStateResponse;
}

export async function putMusikverlageEntries(
  entries: Partial<Record<MusikverlagId, { apiBaseUrl: string }>>
): Promise<void> {
  const t = getUsersApiToken();
  if (!t) throw new Error("Nicht angemeldet.");
  const res = await fetch(`${API}/admin/musikverlage`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
    body: JSON.stringify({ entries }),
  });
  if (!res.ok) throw new Error(await parseError(res));
}

export async function uploadMusikverlageXlsx(
  id: MusikverlagId,
  file: File
): Promise<{
  xlsxFileName: string | null | undefined;
  xlsxUploadedAtIso: string;
  xlsxFileCount?: number;
  tableIndexedRowCount?: number;
}> {
  return uploadMusikverlageXlsxByMode(id, file, "replace");
}

export async function appendMusikverlageXlsx(
  id: MusikverlagId,
  file: File
): Promise<{
  xlsxFileName: string | null | undefined;
  xlsxUploadedAtIso: string;
  xlsxFileCount?: number;
  tableIndexedRowCount?: number;
}> {
  return uploadMusikverlageXlsxByMode(id, file, "append");
}

async function uploadMusikverlageXlsxByMode(
  id: MusikverlagId,
  file: File,
  mode: "replace" | "append"
): Promise<{
  xlsxFileName: string | null | undefined;
  xlsxUploadedAtIso: string;
  xlsxFileCount?: number;
  tableIndexedRowCount?: number;
}> {
  const t = getUsersApiToken();
  if (!t) throw new Error("Nicht angemeldet.");
  const fd = new FormData();
  fd.append("file", file);
  const route = mode === "append" ? "upload-append" : "upload";
  const res = await fetch(`${API}/admin/musikverlage/${encodeURIComponent(id)}/${route}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${t}` },
    body: fd,
  });
  if (!res.ok) throw new Error(await parseError(res));
  return (await res.json()) as {
    xlsxFileName: string | null | undefined;
    xlsxUploadedAtIso: string;
    xlsxFileCount?: number;
    tableIndexedRowCount?: number;
  };
}

export async function deleteMusikverlageXlsx(id: MusikverlagId): Promise<void> {
  const t = getUsersApiToken();
  if (!t) throw new Error("Nicht angemeldet.");
  const res = await fetch(`${API}/admin/musikverlage/${encodeURIComponent(id)}/upload`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${t}` },
  });
  if (!res.ok) throw new Error(await parseError(res));
}

export type WcpmDbRowDto = {
  filenameStem: string;
  payload: WcpmTagPayload;
};

export type WcpmDbFilters = {
  filenameStem: string;
  songTitle: string;
  artist: string;
  album: string;
  composer: string;
  isrc: string;
  labelcode: string;
  warnung: "" | "1" | "0";
};

export async function fetchMusikverlagDatabaseRows(
  id: MusikverlagId,
  filters: WcpmDbFilters
): Promise<{ rows: WcpmDbRowDto[]; total: number; filtered: boolean }> {
  const t = getUsersApiToken();
  if (!t) throw new Error("Nicht angemeldet.");
  const q = new URLSearchParams();
  if (filters.filenameStem.trim()) q.set("filenameStem", filters.filenameStem.trim());
  if (filters.songTitle.trim()) q.set("songTitle", filters.songTitle.trim());
  if (filters.artist.trim()) q.set("artist", filters.artist.trim());
  if (filters.album.trim()) q.set("album", filters.album.trim());
  if (filters.composer.trim()) q.set("composer", filters.composer.trim());
  if (filters.isrc.trim()) q.set("isrc", filters.isrc.trim());
  if (filters.labelcode.trim()) q.set("labelcode", filters.labelcode.trim());
  if (filters.warnung) q.set("warnung", filters.warnung);
  const res = await fetch(`${API}/admin/musikverlage/${encodeURIComponent(id)}/database?${q.toString()}`, {
    headers: { Authorization: `Bearer ${t}` },
  });
  if (!res.ok) throw new Error(await parseError(res));
  return (await res.json()) as { rows: WcpmDbRowDto[]; total: number; filtered: boolean };
}

export async function updateMusikverlagDatabaseRow(
  id: MusikverlagId,
  rowKey: string,
  payload: WcpmTagPayload
): Promise<WcpmTagPayload> {
  const t = getUsersApiToken();
  if (!t) throw new Error("Nicht angemeldet.");
  const res = await fetch(
    `${API}/admin/musikverlage/${encodeURIComponent(id)}/database/${encodeURIComponent(rowKey)}`,
    {
      method: "PATCH",
      headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );
  if (!res.ok) throw new Error(await parseError(res));
  const data = (await res.json()) as { payload?: WcpmTagPayload };
  return data.payload ?? payload;
}

/** Zeile aus der hochgeladenen WCPM-Excel per Dateiname (Server liest `data/musikverlage/uploads/wcpm.*`). */
export async function lookupWcpmTags(fileName: string): Promise<WcpmTagPayload> {
  const t = getUsersApiToken();
  if (!t) throw new Error("Nicht angemeldet.");
  const res = await fetch(`${API}/musikverlage/wcpm/lookup`, {
    method: "POST",
    headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
    body: JSON.stringify({ fileName }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    payload?: WcpmTagPayload;
    error?: string;
  };
  if (!res.ok) throw new Error(data.error || `Anfrage fehlgeschlagen (${res.status}).`);
  if (!data.ok || !data.payload) throw new Error(data.error || "Unbekannte Antwort.");
  return data.payload;
}
