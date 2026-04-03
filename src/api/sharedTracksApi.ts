import { getUsersApiToken } from "./authToken";
import { parseGvlLabelDbJson, type GvlLabelDb } from "../storage/gvlLabelStore";

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

export type MusicDbFileMeta = { createdAt: string; updatedAt: string };

export type MusicDbState = { paths: string[]; metadata: Record<string, MusicDbFileMeta> };

function parseMusicDbState(data: unknown): MusicDbState {
  const o = data as { paths?: unknown; metadata?: unknown };
  const paths = Array.isArray(o.paths) ? o.paths.filter((x): x is string => typeof x === "string") : [];
  const metadata: Record<string, MusicDbFileMeta> = {};
  if (o.metadata && typeof o.metadata === "object" && o.metadata !== null) {
    for (const [k, v] of Object.entries(o.metadata as Record<string, unknown>)) {
      if (!v || typeof v !== "object") continue;
      const e = v as { createdAt?: unknown; updatedAt?: unknown };
      if (typeof e.createdAt === "string" && typeof e.updatedAt === "string") {
        metadata[k] = { createdAt: e.createdAt, updatedAt: e.updatedAt };
      }
    }
  }
  return { paths, metadata };
}

/** Installationsweite Musikdatenbank: Pfade und Zeitstempel (Server). */
export async function apiSharedMusicDbFetch(): Promise<MusicDbState> {
  const res = await fetch(`${API}/shared/music-db`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return parseMusicDbState(await res.json());
}

export async function apiSharedMusicDbRegister(paths: string[]): Promise<MusicDbState> {
  const res = await fetch(`${API}/shared/music-db/register`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ paths }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return parseMusicDbState(await res.json());
}

export async function apiSharedMusicDbRemovePaths(paths: string[]): Promise<MusicDbState> {
  const res = await fetch(`${API}/shared/music-db/remove-paths`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ paths }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return parseMusicDbState(await res.json());
}

export async function apiSharedMusicDbTouchTagEdited(relativePath: string): Promise<MusicDbFileMeta> {
  const res = await fetch(`${API}/shared/music-db/touch-tag-edited`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ relativePath }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  const data = (await res.json()) as { entry?: unknown };
  const e = data.entry as { createdAt?: unknown; updatedAt?: unknown } | undefined;
  if (!e || typeof e.createdAt !== "string" || typeof e.updatedAt !== "string") {
    throw new Error("Ungültige Server-Antwort.");
  }
  return { createdAt: e.createdAt, updatedAt: e.updatedAt };
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

/** Installationsweite GVL-Label-Liste (Server); `null` wenn noch keine Datei existiert. */
export async function apiSharedGvlLabelDbFetch(): Promise<GvlLabelDb | null> {
  const res = await fetch(`${API}/shared/gvl-label-db`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error(await parseError(res));
  const data = (await res.json()) as { db?: unknown };
  if (data.db == null) return null;
  return parseGvlLabelDbJson(data.db);
}

/** Speichert die GVL-Liste serverseitig (nur Administratoren). */
export async function apiSharedGvlLabelDbSave(db: GvlLabelDb): Promise<void> {
  const res = await fetch(`${API}/shared/gvl-label-db/save`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ db }),
  });
  if (!res.ok) throw new Error(await parseError(res));
}
