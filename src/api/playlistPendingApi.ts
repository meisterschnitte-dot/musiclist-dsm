import { getUsersApiToken } from "./authToken";

const API = "/api";

async function parseError(res: Response): Promise<string> {
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  return data.error || `Anfrage fehlgeschlagen (${res.status}).`;
}

export async function registerPlaylistPendingRequest(params: {
  customerId: string;
  libraryOwnerUserId: string;
  parentSegments: string[];
  playlistFileName: string;
}): Promise<void> {
  const t = getUsersApiToken();
  if (!t) throw new Error("Nicht angemeldet.");
  const res = await fetch(`${API}/playlist-pending/register`, {
    method: "POST",
    headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      customerId: params.customerId.trim(),
      libraryOwnerUserId: params.libraryOwnerUserId.trim(),
      parentSegments: params.parentSegments,
      fileName: params.playlistFileName.trim(),
    }),
  });
  if (!res.ok) throw new Error(await parseError(res));
}

/** Admin: .list einem Kunden zuweisen (freigegebene Ansicht); vorherige Zuweisung derselben Datei wird ersetzt. */
export async function setPlaylistCustomerAssignmentRequest(params: {
  customerId: string;
  libraryOwnerUserId: string;
  parentSegments: string[];
  fileName: string;
}): Promise<void> {
  const t = getUsersApiToken();
  if (!t) throw new Error("Nicht angemeldet.");
  const res = await fetch(`${API}/playlist-assignment/set`, {
    method: "POST",
    headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      customerId: params.customerId.trim(),
      libraryOwnerUserId: params.libraryOwnerUserId.trim(),
      parentSegments: params.parentSegments,
      fileName: params.fileName.trim(),
    }),
  });
  if (!res.ok) throw new Error(await parseError(res));
}

export async function lookupPlaylistPendingCustomerRequest(params: {
  libraryOwnerUserId: string;
  parentSegments: string[];
  playlistFileName: string;
}): Promise<string | null> {
  const t = getUsersApiToken();
  if (!t) throw new Error("Nicht angemeldet.");
  const res = await fetch(`${API}/playlist-pending/lookup`, {
    method: "POST",
    headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      libraryOwnerUserId: params.libraryOwnerUserId.trim(),
      parentSegments: params.parentSegments,
      fileName: params.playlistFileName.trim(),
    }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  const data = (await res.json()) as { customerId?: string | null };
  const id = data.customerId;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}
