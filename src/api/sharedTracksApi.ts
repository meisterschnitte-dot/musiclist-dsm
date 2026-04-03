import { getUsersApiToken } from "./authToken";

const API = "/api";

async function parseError(res: Response): Promise<string> {
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  return data.error || `Anfrage fehlgeschlagen (${res.status}).`;
}

function authHeaders(): HeadersInit {
  const t = getUsersApiToken();
  if (!t) throw new Error("Nicht angemeldet.");
  return { Authorization: `Bearer ${t}`, "Content-Type": "application/json" };
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

/** Installationsweite Musikdatenbank-Pfade (Server). */
export async function apiSharedMusicDbFetch(): Promise<string[]> {
  const res = await fetch(`${API}/shared/music-db`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error(await parseError(res));
  const data = (await res.json()) as { paths?: string[] };
  return Array.isArray(data.paths) ? data.paths : [];
}

export async function apiSharedMusicDbRegister(paths: string[]): Promise<string[]> {
  const res = await fetch(`${API}/shared/music-db/register`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ paths }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  const data = (await res.json()) as { paths?: string[] };
  return Array.isArray(data.paths) ? data.paths : [];
}

export async function apiSharedMusicDbRemovePaths(paths: string[]): Promise<string[]> {
  const res = await fetch(`${API}/shared/music-db/remove-paths`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ paths }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  const data = (await res.json()) as { paths?: string[] };
  return Array.isArray(data.paths) ? data.paths : [];
}

export async function apiSharedTracksReadBinary(relativePath: string): Promise<ArrayBuffer> {
  const res = await fetch(`${API}/shared/tracks/read-binary`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ relativePath }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  const data = (await res.json()) as { base64?: string };
  const b64 = typeof data.base64 === "string" ? data.base64 : "";
  return base64ToArrayBuffer(b64);
}

export async function apiSharedTracksExists(relativePath: string): Promise<boolean> {
  const res = await fetch(`${API}/shared/tracks/exists`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ relativePath }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  const data = (await res.json()) as { exists?: boolean };
  return data.exists === true;
}

export async function apiSharedTracksWriteBinary(
  relativePath: string,
  data: ArrayBuffer
): Promise<void> {
  const res = await fetch(`${API}/shared/tracks/write-binary`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ relativePath, base64: arrayBufferToBase64(data) }),
  });
  if (!res.ok) throw new Error(await parseError(res));
}

export async function apiSharedTracksDeleteFile(relativePath: string): Promise<void> {
  const res = await fetch(`${API}/shared/tracks/delete-file`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ relativePath }),
  });
  if (!res.ok) throw new Error(await parseError(res));
}
