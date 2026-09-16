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
  canOpenDatabase?: boolean;
};

export async function rebuildMusikverlagDatabase(
  id: MusikverlagId
): Promise<{ tableIndexedRowCount: number }> {
  const t = getUsersApiToken();
  if (!t) throw new Error("Nicht angemeldet.");
  const res = await fetch(`${API}/admin/musikverlage/${encodeURIComponent(id)}/database/rebuild`, {
    method: "POST",
    headers: { Authorization: `Bearer ${t}` },
  });
  if (!res.ok) throw new Error(await parseError(res));
  const data = (await res.json()) as { tableIndexedRowCount?: number };
  return { tableIndexedRowCount: data.tableIndexedRowCount ?? 0 };
}

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
  file: File,
  onProgress?: (p: MusikverlagUploadProgress) => void
): Promise<MusikverlagUploadResult> {
  return uploadMusikverlageXlsxByMode(id, file, "replace", onProgress);
}

export async function appendMusikverlageXlsx(
  id: MusikverlagId,
  file: File,
  onProgress?: (p: MusikverlagUploadProgress) => void
): Promise<MusikverlagUploadResult> {
  return uploadMusikverlageXlsxByMode(id, file, "append", onProgress);
}

export type MusikverlagUploadProgress = {
  percent: number;
  label: string;
};

type MusikverlagUploadResult = {
  xlsxFileName: string | null | undefined;
  xlsxUploadedAtIso: string;
  xlsxFileCount?: number;
  tableIndexedRowCount?: number;
};

async function uploadMusikverlageXlsxByMode(
  id: MusikverlagId,
  file: File,
  mode: "replace" | "append",
  onProgress?: (p: MusikverlagUploadProgress) => void
): Promise<MusikverlagUploadResult> {
  const t = getUsersApiToken();
  if (!t) throw new Error("Nicht angemeldet.");
  onProgress?.({ percent: 2, label: "Upload wird vorbereitet …" });
  const route = mode === "append" ? "upload-append" : "upload";
  const url = `${API}/admin/musikverlage/${encodeURIComponent(id)}/${route}`;

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.setRequestHeader("Authorization", `Bearer ${t}`);
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable && ev.total > 0) {
        const uploadPct = Math.round((ev.loaded / ev.total) * 70);
        onProgress?.({
          percent: Math.max(3, uploadPct),
          label: `Datei wird hochgeladen … ${Math.round((ev.loaded / ev.total) * 100)} %`,
        });
      } else {
        onProgress?.({ percent: 25, label: "Datei wird hochgeladen …" });
      }
    };
    xhr.upload.onload = () => {
      onProgress?.({ percent: 72, label: "Datenbank wird erzeugt (kann bei großen Katalogen dauern) …" });
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          onProgress?.({ percent: 100, label: "Fertig" });
          resolve(JSON.parse(xhr.responseText) as MusikverlagUploadResult);
        } catch {
          reject(new Error("Ungültige Server-Antwort nach Upload."));
        }
        return;
      }
      try {
        const data = JSON.parse(xhr.responseText) as { error?: string };
        reject(new Error(data.error || `Upload fehlgeschlagen (${xhr.status}).`));
      } catch {
        reject(new Error(`Upload fehlgeschlagen (${xhr.status}).`));
      }
    };
    xhr.onerror = () => reject(new Error("Netzwerkfehler beim Upload."));
    xhr.ontimeout = () => reject(new Error("Upload-Zeitüberschreitung."));
    xhr.timeout = 0;
    const fd = new FormData();
    fd.append("file", file);
    xhr.send(fd);
  });
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
  label: string;
  warnung: "" | "1" | "0";
};

export type MusikverlagBulkPatchDto = {
  labelcode?: string;
  label?: string;
  hersteller?: string;
  warnung?: boolean | null;
};

function filtersToSearchParams(filters: WcpmDbFilters): URLSearchParams {
  const q = new URLSearchParams();
  if (filters.filenameStem.trim()) q.set("filenameStem", filters.filenameStem.trim());
  if (filters.songTitle.trim()) q.set("songTitle", filters.songTitle.trim());
  if (filters.artist.trim()) q.set("artist", filters.artist.trim());
  if (filters.album.trim()) q.set("album", filters.album.trim());
  if (filters.composer.trim()) q.set("composer", filters.composer.trim());
  if (filters.isrc.trim()) q.set("isrc", filters.isrc.trim());
  if (filters.labelcode.trim()) q.set("labelcode", filters.labelcode.trim());
  if (filters.label.trim()) q.set("label", filters.label.trim());
  if (filters.warnung) q.set("warnung", filters.warnung);
  return q;
}

export async function fetchMusikverlagDatabaseRows(
  id: MusikverlagId,
  filters: WcpmDbFilters
): Promise<{ rows: WcpmDbRowDto[]; total: number; filtered: boolean }> {
  const t = getUsersApiToken();
  if (!t) throw new Error("Nicht angemeldet.");
  const q = filtersToSearchParams(filters);
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
export async function fetchMusikverlagDatabaseRowKeys(
  id: MusikverlagId,
  filters: WcpmDbFilters
): Promise<{ keys: string[]; total: number }> {
  const t = getUsersApiToken();
  if (!t) throw new Error("Nicht angemeldet.");
  const q = filtersToSearchParams(filters);
  const res = await fetch(
    `${API}/admin/musikverlage/${encodeURIComponent(id)}/database/keys?${q.toString()}`,
    { headers: { Authorization: `Bearer ${t}` } }
  );
  if (!res.ok) throw new Error(await parseError(res));
  return (await res.json()) as { keys: string[]; total: number };
}

export async function deleteMusikverlagDatabaseRows(
  id: MusikverlagId,
  rowKeys: string[]
): Promise<number> {
  const t = getUsersApiToken();
  if (!t) throw new Error("Nicht angemeldet.");
  const res = await fetch(`${API}/admin/musikverlage/${encodeURIComponent(id)}/database/delete`, {
    method: "POST",
    headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
    body: JSON.stringify({ rowKeys }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  const data = (await res.json()) as { deleted?: number };
  return data.deleted ?? 0;
}

export async function bulkPatchMusikverlagDatabaseRows(
  id: MusikverlagId,
  rowKeys: string[],
  patch: MusikverlagBulkPatchDto
): Promise<number> {
  const t = getUsersApiToken();
  if (!t) throw new Error("Nicht angemeldet.");
  const res = await fetch(`${API}/admin/musikverlage/${encodeURIComponent(id)}/database/bulk-patch`, {
    method: "POST",
    headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
    body: JSON.stringify({ rowKeys, patch }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  const data = (await res.json()) as { updated?: number };
  return data.updated ?? 0;
}

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

export async function lookupBmgpmTags(fileName: string): Promise<WcpmTagPayload> {
  const t = getUsersApiToken();
  if (!t) throw new Error("Nicht angemeldet.");
  const res = await fetch(`${API}/musikverlage/bmgpm/lookup`, {
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
