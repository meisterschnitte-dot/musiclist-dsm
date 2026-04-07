import type { EdlDirEntry } from "../edl/edlLibraryFs";
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

export async function apiEdlList(segments: string[]): Promise<EdlDirEntry[]> {
  const res = await fetch(`${API}/me/edl/list`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ segments }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  const data = (await res.json()) as { entries?: EdlDirEntry[] };
  return Array.isArray(data.entries) ? data.entries : [];
}

export async function apiEdlReadText(segments: string[], fileName: string): Promise<string> {
  const res = await fetch(`${API}/me/edl/read-text`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ segments, fileName }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  const data = (await res.json()) as { text?: string };
  return typeof data.text === "string" ? data.text : "";
}

export async function apiEdlReadBinary(segments: string[], fileName: string): Promise<ArrayBuffer> {
  const res = await fetch(`${API}/me/edl/read-binary`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ segments, fileName }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  const data = (await res.json()) as { base64?: string };
  const b64 = typeof data.base64 === "string" ? data.base64 : "";
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

export async function apiEdlWriteText(
  segments: string[],
  fileName: string,
  text: string
): Promise<void> {
  const res = await fetch(`${API}/me/edl/write-text`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ segments, fileName, text }),
  });
  if (!res.ok) throw new Error(await parseError(res));
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

export async function apiEdlWriteBinary(
  segments: string[],
  fileName: string,
  data: ArrayBuffer
): Promise<void> {
  const res = await fetch(`${API}/me/edl/write-binary`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ segments, fileName, base64: arrayBufferToBase64(data) }),
  });
  if (!res.ok) throw new Error(await parseError(res));
}

export async function apiEdlMkdir(parentSegments: string[], name: string): Promise<void> {
  const res = await fetch(`${API}/me/edl/mkdir`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ parentSegments, name }),
  });
  if (!res.ok) throw new Error(await parseError(res));
}

export async function apiEdlMoveFile(
  fromSegments: string[],
  fileName: string,
  toSegments: string[]
): Promise<void> {
  const res = await fetch(`${API}/me/edl/move-file`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ fromSegments, fileName, toSegments }),
  });
  if (!res.ok) throw new Error(await parseError(res));
}

export async function apiEdlMoveDirectory(
  fromParentSegments: string[],
  folderName: string,
  toParentSegments: string[]
): Promise<void> {
  const res = await fetch(`${API}/me/edl/move-directory`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ fromParentSegments, folderName, toParentSegments }),
  });
  if (!res.ok) throw new Error(await parseError(res));
}

export async function apiEdlDeleteFile(segments: string[], fileName: string): Promise<void> {
  const res = await fetch(`${API}/me/edl/delete-file`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ segments, fileName }),
  });
  if (!res.ok) throw new Error(await parseError(res));
}

export async function apiEdlDeleteDirectory(pathSegments: string[]): Promise<void> {
  const res = await fetch(`${API}/me/edl/delete-directory`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ pathSegments }),
  });
  if (!res.ok) throw new Error(await parseError(res));
}

export async function apiEdlRenameDirectory(
  parentSegments: string[],
  oldName: string,
  newName: string
): Promise<void> {
  const res = await fetch(`${API}/me/edl/rename-directory`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ parentSegments, oldName, newName }),
  });
  if (!res.ok) throw new Error(await parseError(res));
}
