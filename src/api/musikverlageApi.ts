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
  tableIndexedRowCount?: number;
}> {
  const t = getUsersApiToken();
  if (!t) throw new Error("Nicht angemeldet.");
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch(`${API}/admin/musikverlage/${encodeURIComponent(id)}/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${t}` },
    body: fd,
  });
  if (!res.ok) throw new Error(await parseError(res));
  return (await res.json()) as {
    xlsxFileName: string | null | undefined;
    xlsxUploadedAtIso: string;
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
