import type { AudioTags } from "../audio/audioTags";
import { getUsersApiToken } from "./authToken";

const API = "/api";

async function parseError(res: Response): Promise<string> {
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  return data.error || `Anfrage fehlgeschlagen (${res.status}).`;
}

function authHeader(): HeadersInit {
  const t = getUsersApiToken();
  if (!t) throw new Error("Nicht angemeldet.");
  return { Authorization: `Bearer ${t}` };
}

export type PlayerTrack = {
  id: number;
  relPath: string;
  fileName: string;
  folder: string;
  title: string;
  artist: string;
  album: string;
  year: string;
  genre: string;
  writer: string;
  publisher: string;
  label: string;
  labelcode: string;
  gvlRights: string;
  comment: string;
  isrc: string;
  durationSec: number | null;
  fileSize: number;
  mtimeMs: number;
  ingestAt: string;
};

export type PlayerPlaylist = {
  id: number;
  userId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  trackCount: number;
};

export type PlayerScanStatus = {
  running: boolean;
  processed: number;
  upserted: number;
  skipped: number;
  removed: number;
  total: number;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  skippedTracks: string[];
  addedTracks: string[];
  rejected: number;
  rejectedTracks: string[];
};

export type PlayerStatus = {
  trackCount: number;
  scan: PlayerScanStatus;
  browsePath: string;
};

export type PlayerBrowseEntry = {
  name: string;
  path: string;
  kind: "dir" | "file";
  ingested: boolean;
};

export type PlayerBrowseResult = {
  path: string;
  parent: string | null;
  entries: PlayerBrowseEntry[];
  focusPath: string | null;
};

export async function fetchPlayerStatus(): Promise<PlayerStatus> {
  const res = await fetch(`${API}/player/status`, { headers: authHeader() });
  if (!res.ok) throw new Error(await parseError(res));
  return (await res.json()) as PlayerStatus;
}

export async function browsePlayerFilesystem(dirPath: string): Promise<PlayerBrowseResult> {
  const params = new URLSearchParams();
  if (dirPath) params.set("path", dirPath);
  const res = await fetch(`${API}/player/browse?${params}`, { headers: authHeader() });
  if (!res.ok) throw new Error(await parseError(res));
  return (await res.json()) as PlayerBrowseResult;
}

export async function startPlayerImport(paths: string[]): Promise<PlayerScanStatus> {
  const res = await fetch(`${API}/player/import`, {
    method: "POST",
    headers: { ...authHeader(), "Content-Type": "application/json" },
    body: JSON.stringify({ paths }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  const data = (await res.json()) as { scan: PlayerScanStatus };
  return data.scan;
}

export type PlayerCatalogSearchQuery = {
  q: string;
  offset?: number;
  limit?: number;
  filters?: Partial<Record<string, string>>;
  sort?: { columnId: string; direction: "asc" | "desc" } | null;
};

export async function searchPlayerCatalog(
  query: string | PlayerCatalogSearchQuery,
  offset = 0,
  limit = 80
): Promise<{ total: number; tracks: PlayerTrack[] }> {
  const opts: PlayerCatalogSearchQuery = typeof query === "string" ? { q: query, offset, limit } : query;
  const params = new URLSearchParams({
    q: opts.q ?? "",
    offset: String(opts.offset ?? 0),
    limit: String(opts.limit ?? 80),
  });
  if (opts.sort?.columnId) {
    params.set("sort", opts.sort.columnId);
    params.set("dir", opts.sort.direction);
  }
  if (opts.filters) {
    for (const [key, value] of Object.entries(opts.filters)) {
      if (value?.trim()) params.set(`f_${key}`, value.trim());
    }
  }
  const res = await fetch(`${API}/player/search?${params}`, { headers: authHeader() });
  if (!res.ok) throw new Error(await parseError(res));
  return (await res.json()) as { total: number; tracks: PlayerTrack[] };
}

export type PlayerTrackTagPatch = {
  title: string;
  artist: string;
  album: string;
  year: string;
  writer: string;
  publisher: string;
  label: string;
  labelcode: string;
  gvlRights: string;
  comment: string;
  isrc: string;
};

export function playerTrackToAudioTags(track: PlayerTrack): AudioTags {
  return {
    songTitle: track.title,
    artist: track.artist,
    album: track.album,
    year: track.year,
    comment: track.comment,
    composer: track.writer,
    isrc: track.isrc,
    labelcode: track.labelcode,
    label: track.label,
    hersteller: track.publisher,
    gvlRechte: track.gvlRights,
  };
}

export function audioTagsToPlayerPatch(tags: AudioTags): PlayerTrackTagPatch {
  return {
    title: (tags.songTitle ?? "").trim(),
    artist: (tags.artist ?? "").trim(),
    album: (tags.album ?? "").trim(),
    year: (tags.year ?? "").trim(),
    writer: (tags.composer ?? "").trim(),
    publisher: (tags.hersteller ?? "").trim(),
    label: (tags.label ?? "").trim(),
    labelcode: (tags.labelcode ?? "").trim(),
    gvlRights: (tags.gvlRechte ?? "").trim(),
    comment: (tags.comment ?? "").trim(),
    isrc: (tags.isrc ?? "").trim(),
  };
}

export async function patchPlayerTrackTags(id: number, tags: PlayerTrackTagPatch): Promise<PlayerTrack> {
  const res = await fetch(`${API}/player/tracks/${id}`, {
    method: "PATCH",
    headers: { ...authHeader(), "Content-Type": "application/json" },
    body: JSON.stringify(tags),
  });
  if (!res.ok) throw new Error(await parseError(res));
  const data = (await res.json()) as { track: PlayerTrack };
  return data.track;
}

export type PlayerMatchResult = {
  results: Record<string, PlayerTrack[]>;
  /** Track-ID → bereits verknüpfte MP3-Pfade der Musiclist-Musikdatenbank. */
  links: Record<string, string[]>;
};

export async function matchPlayerCatalog(stems: string[]): Promise<PlayerMatchResult> {
  const res = await fetch(`${API}/player/match`, {
    method: "POST",
    headers: { ...authHeader(), "Content-Type": "application/json" },
    body: JSON.stringify({ stems }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return (await res.json()) as PlayerMatchResult;
}

export async function linkSharedPathToPlayerTrack(sharedPath: string, trackId: number): Promise<void> {
  const res = await fetch(`${API}/player/links`, {
    method: "POST",
    headers: { ...authHeader(), "Content-Type": "application/json" },
    body: JSON.stringify({ sharedPath, trackId }),
  });
  if (!res.ok) throw new Error(await parseError(res));
}

export async function syncPlayerTagsForSharedPath(sharedPath: string, tags: AudioTags): Promise<boolean> {
  const res = await fetch(`${API}/player/links/sync-tags`, {
    method: "POST",
    headers: { ...authHeader(), "Content-Type": "application/json" },
    body: JSON.stringify({ sharedPath, tags: audioTagsToPlayerPatch(tags) }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  const data = (await res.json()) as { synced?: boolean };
  return data.synced === true;
}

export async function deletePlayerCatalogTrack(id: number): Promise<void> {
  const res = await fetch(`${API}/player/tracks/${id}`, {
    method: "DELETE",
    headers: authHeader(),
  });
  if (!res.ok) throw new Error(await parseError(res));
}

export function playerTrackStreamUrl(trackId: number): string {
  const t = getUsersApiToken();
  if (!t) throw new Error("Nicht angemeldet.");
  return `${API}/player/tracks/${trackId}/stream?access=${encodeURIComponent(t)}`;
}

export async function fetchPlayerPlaylists(): Promise<PlayerPlaylist[]> {
  const res = await fetch(`${API}/player/playlists`, { headers: authHeader() });
  if (!res.ok) throw new Error(await parseError(res));
  const data = (await res.json()) as { playlists: PlayerPlaylist[] };
  return data.playlists;
}

export async function createPlayerPlaylist(name: string): Promise<PlayerPlaylist> {
  const res = await fetch(`${API}/player/playlists`, {
    method: "POST",
    headers: { ...authHeader(), "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  const data = (await res.json()) as { playlist: PlayerPlaylist };
  return data.playlist;
}

export async function fetchPlayerPlaylist(
  id: number
): Promise<{ playlist: PlayerPlaylist; tracks: PlayerTrack[] }> {
  const res = await fetch(`${API}/player/playlists/${id}`, { headers: authHeader() });
  if (!res.ok) throw new Error(await parseError(res));
  return (await res.json()) as { playlist: PlayerPlaylist; tracks: PlayerTrack[] };
}

export async function renamePlayerPlaylist(
  id: number,
  name: string
): Promise<{ playlist: PlayerPlaylist; tracks: PlayerTrack[] }> {
  const res = await fetch(`${API}/player/playlists/${id}`, {
    method: "PATCH",
    headers: { ...authHeader(), "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return (await res.json()) as { playlist: PlayerPlaylist; tracks: PlayerTrack[] };
}

export async function deletePlayerPlaylist(id: number): Promise<void> {
  const res = await fetch(`${API}/player/playlists/${id}`, {
    method: "DELETE",
    headers: authHeader(),
  });
  if (!res.ok) throw new Error(await parseError(res));
}

export async function addTrackToPlayerPlaylist(
  playlistId: number,
  trackId: number
): Promise<{ playlist: PlayerPlaylist; tracks: PlayerTrack[] }> {
  const res = await fetch(`${API}/player/playlists/${playlistId}/tracks`, {
    method: "POST",
    headers: { ...authHeader(), "Content-Type": "application/json" },
    body: JSON.stringify({ trackId }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return (await res.json()) as { playlist: PlayerPlaylist; tracks: PlayerTrack[] };
}

export async function removePlayerPlaylistTrackAt(
  playlistId: number,
  pos: number
): Promise<{ playlist: PlayerPlaylist; tracks: PlayerTrack[] }> {
  const res = await fetch(`${API}/player/playlists/${playlistId}/tracks/${pos}`, {
    method: "DELETE",
    headers: authHeader(),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return (await res.json()) as { playlist: PlayerPlaylist; tracks: PlayerTrack[] };
}
