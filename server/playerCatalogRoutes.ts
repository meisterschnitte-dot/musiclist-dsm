import fs from "node:fs";
import type { Request, Response } from "express";
import { Router } from "express";
import { bearerAuth, requireAdmin, requirePlayerAccess } from "./authMiddleware";
import { hasPlayerAccess } from "./userTypes";
import { verifyUserToken } from "./authToken";
import { findById, isUserActive, listUsers } from "./userStore";
import {
  PLAYER_CATALOG_FILTER_KEYS,
  playerCatalogDeleteById,
  playerCatalogGetById,
  playerCatalogSearch,
  playerCatalogWriteTags,
  playerCatalogMatchCandidates,
  playerLinkSharedPath,
  playerLinkedSharedPathsForTracks,
  playerLinkedTrackIdForSharedPath,
  type PlayerTrackRow,
  type PlayerTrackTags,
  playerCatalogTrackCount,
  type PlayerCatalogFilterKey,
  type PlayerCatalogSearchOpts,
  playerPlaylistAddTrack,
  playerPlaylistCreate,
  playerPlaylistDelete,
  playerPlaylistGet,
  playerPlaylistList,
  playerPlaylistRemoveAt,
  playerPlaylistRename,
} from "./playerCatalogSqlite";
import { getPlayerScanStatus, refreshStalePlayerTrackTags, startPlayerCatalogImport } from "./playerCatalogScan";
import { browsePlayerFilesystem, defaultPlayerBrowsePath } from "./playerCatalogBrowse";
import { resolveStoredTrackPath } from "./playerCatalogSettings";

function intParam(raw: string | string[] | undefined): number | null {
  const s = Array.isArray(raw) ? raw[0] : raw;
  if (!s || !/^\d+$/.test(s)) return null;
  return Number(s);
}

function tagsFromBody(b: Record<string, unknown>, existing: PlayerTrackTags): PlayerTrackTags {
  const field = (key: keyof PlayerTrackTags): string =>
    typeof b[key] === "string" ? (b[key] as string) : existing[key];
  return {
    title: field("title"),
    artist: field("artist"),
    album: field("album"),
    year: field("year"),
    genre: field("genre"),
    writer: field("writer"),
    publisher: field("publisher"),
    label: field("label"),
    labelcode: field("labelcode"),
    gvlRights: field("gvlRights"),
    comment: field("comment"),
    isrc: field("isrc"),
  };
}

function playerMediaAuth(req: Request, res: Response, next: () => void): void {
  const tokenQ = req.query.access ?? req.query.token;
  const q = Array.isArray(tokenQ) ? tokenQ[0] : tokenQ;
  let qStr = typeof q === "string" ? q.trim() : "";
  if (!qStr) {
    const qs = (req.originalUrl || req.url || "").split("?")[1] || "";
    const p = new URLSearchParams(qs);
    qStr = (p.get("access") || p.get("token") || "").trim();
  }
  const h = req.headers.authorization;
  const m = typeof h === "string" ? h.match(/^Bearer\s+(.+)$/i) : null;
  const raw = (m?.[1] || qStr).trim();
  if (!raw) {
    res.status(401).json({ error: "Nicht angemeldet." });
    return;
  }
  const v = verifyUserToken(raw);
  if (!v) {
    res.status(401).json({ error: "Sitzung ungültig oder abgelaufen." });
    return;
  }
  const u = findById(listUsers(), v.userId);
  if (!u || !isUserActive(u)) {
    res.status(401).json({ error: "Benutzer nicht gefunden oder deaktiviert." });
    return;
  }
  if (!hasPlayerAccess(u)) {
    res.status(403).json({ error: "Kein Zugriff auf den Musicplayer." });
    return;
  }
  req.authUser = u;
  next();
}

async function sendPlaylist(res: Response, data: ReturnType<typeof playerPlaylistGet>): Promise<void> {
  if (!data) {
    res.status(404).json({ error: "Playlist nicht gefunden." });
    return;
  }
  res.json({ ...data, tracks: await refreshStalePlayerTrackTags(data.tracks) });
}

function guessAudioType(fileName: string): string {
  const ext = fileName.toLowerCase();
  if (ext.endsWith(".wav") || ext.endsWith(".wave")) return "audio/wav";
  if (ext.endsWith(".m4a")) return "audio/mp4";
  if (ext.endsWith(".flac")) return "audio/flac";
  if (ext.endsWith(".ogg")) return "audio/ogg";
  return "audio/mpeg";
}

export function createPlayerCatalogRouter(): Router {
  const r = Router();

  r.get("/player/status", bearerAuth, requirePlayerAccess, (_req: Request, res: Response) => {
    const scan = getPlayerScanStatus();
    res.json({
      trackCount: playerCatalogTrackCount(),
      scan,
      browsePath: defaultPlayerBrowsePath(),
    });
  });

  r.get("/player/browse", bearerAuth, requireAdmin, (req: Request, res: Response) => {
    const raw = typeof req.query.path === "string" ? req.query.path : "";
    try {
      res.json(browsePlayerFilesystem(raw));
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : "Ordner nicht lesbar." });
    }
  });

  r.post("/player/import", bearerAuth, requireAdmin, (req: Request, res: Response) => {
    const raw = req.body?.paths;
    const paths = Array.isArray(raw) ? raw.filter((p): p is string => typeof p === "string") : [];
    try {
      const scan = startPlayerCatalogImport(paths);
      res.json({ ok: true, scan });
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : "Import nicht gestartet." });
    }
  });

  r.get("/player/search", bearerAuth, requirePlayerAccess, (req: Request, res: Response) => {
    const q = typeof req.query.q === "string" ? req.query.q : "";
    const limit = Number(req.query.limit) || 80;
    const offset = Number(req.query.offset) || 0;
    const filters: PlayerCatalogSearchOpts["filters"] = {};
    for (const key of PLAYER_CATALOG_FILTER_KEYS) {
      const raw = req.query[`f_${key}`];
      const v = Array.isArray(raw) ? raw[0] : raw;
      if (typeof v === "string" && v.trim()) filters[key] = v.trim();
    }
    const sortCol = typeof req.query.sort === "string" ? req.query.sort : "";
    const sort: PlayerCatalogSearchOpts["sort"] =
      (PLAYER_CATALOG_FILTER_KEYS as readonly string[]).includes(sortCol)
        ? {
            column: sortCol as PlayerCatalogFilterKey,
            direction: req.query.dir === "desc" ? "desc" : "asc",
          }
        : undefined;
    void (async () => {
      try {
        const result = playerCatalogSearch(q, limit, offset, { filters, sort });
        result.tracks = await refreshStalePlayerTrackTags(result.tracks);
        res.json(result);
      } catch (e) {
        res.status(400).json({ error: e instanceof Error ? e.message : "Suche fehlgeschlagen." });
      }
    })();
  });

  r.post("/player/match", bearerAuth, (req: Request, res: Response) => {
    const raw = (req.body as { stems?: unknown } | undefined)?.stems;
    const stems = Array.isArray(raw)
      ? [...new Set(raw.filter((s): s is string => typeof s === "string" && s.trim().length > 0))].slice(0, 500)
      : [];
    try {
      const results: Record<string, PlayerTrackRow[]> = {};
      const ids = new Set<number>();
      for (const stem of stems) {
        const hits = playerCatalogMatchCandidates(stem);
        results[stem] = hits;
        for (const t of hits) ids.add(t.id);
      }
      res.json({ results, links: playerLinkedSharedPathsForTracks([...ids]) });
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : "Abgleich fehlgeschlagen." });
    }
  });

  r.post("/player/links", bearerAuth, (req: Request, res: Response) => {
    const b = (req.body ?? {}) as { sharedPath?: unknown; trackId?: unknown };
    const sharedPath = typeof b.sharedPath === "string" ? b.sharedPath : "";
    const trackId = typeof b.trackId === "number" && Number.isInteger(b.trackId) ? b.trackId : null;
    if (!sharedPath.trim() || trackId == null) {
      res.status(400).json({ error: "sharedPath und trackId erforderlich." });
      return;
    }
    if (!playerLinkSharedPath(sharedPath, trackId)) {
      res.status(404).json({ error: "Track nicht im Katalog." });
      return;
    }
    res.json({ ok: true });
  });

  /** Musiclist hat Tags einer verknüpften MP3 geändert → Player-Track nachziehen. */
  r.post("/player/links/sync-tags", bearerAuth, (req: Request, res: Response) => {
    const b = (req.body ?? {}) as { sharedPath?: unknown; tags?: unknown };
    const sharedPath = typeof b.sharedPath === "string" ? b.sharedPath : "";
    const trackId = sharedPath ? playerLinkedTrackIdForSharedPath(sharedPath) : null;
    if (trackId == null) {
      res.json({ synced: false });
      return;
    }
    const existing = playerCatalogGetById(trackId);
    if (!existing) {
      res.json({ synced: false });
      return;
    }
    const tags = b.tags && typeof b.tags === "object" ? (b.tags as Record<string, unknown>) : {};
    const written = playerCatalogWriteTags(trackId, tagsFromBody(tags, existing));
    res.json({ synced: written != null, trackId });
  });

  r.patch("/player/tracks/:id", bearerAuth, requirePlayerAccess, (req: Request, res: Response) => {
    const id = intParam(req.params.id);
    if (id == null) {
      res.status(400).json({ error: "Ungültige Track-ID." });
      return;
    }
    const existing = playerCatalogGetById(id);
    if (!existing) {
      res.status(404).json({ error: "Track nicht im Katalog." });
      return;
    }
    const written = playerCatalogWriteTags(id, tagsFromBody((req.body ?? {}) as Record<string, unknown>, existing));
    if (!written) {
      res.status(404).json({ error: "Track nicht im Katalog." });
      return;
    }
    res.json({ track: written });
  });

  r.delete("/player/tracks/:id", bearerAuth, requireAdmin, (req: Request, res: Response) => {
    const id = intParam(req.params.id);
    if (id == null) {
      res.status(400).json({ error: "Ungültige Track-ID." });
      return;
    }
    if (!playerCatalogDeleteById(id)) {
      res.status(404).json({ error: "Track nicht im Katalog." });
      return;
    }
    res.json({ ok: true });
  });

  r.get("/player/tracks/:id/stream", playerMediaAuth, (req: Request, res: Response) => {
    const id = intParam(req.params.id);
    if (id == null) {
      res.status(400).json({ error: "Ungültige Track-ID." });
      return;
    }
    const track = playerCatalogGetById(id);
    if (!track) {
      res.status(404).json({ error: "Track nicht im Katalog." });
      return;
    }
    let abs: string;
    try {
      abs = resolveStoredTrackPath(track.relPath);
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : "Pfad ungültig." });
      return;
    }
    let st: fs.Stats;
    try {
      st = fs.statSync(abs);
    } catch {
      res.status(404).json({ error: "Datei nicht gefunden." });
      return;
    }
    const size = st.size;
    const type = guessAudioType(track.fileName);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Content-Type", type);
    res.setHeader("Cache-Control", "private, max-age=120");
    const range = req.headers.range;
    if (range) {
      const m = range.match(/^bytes=(\d*)-(\d*)$/);
      if (!m) {
        res.status(416).end();
        return;
      }
      const start = m[1] ? Number(m[1]) : 0;
      const end = m[2] ? Number(m[2]) : size - 1;
      if (start > end || start >= size) {
        res.status(416).setHeader("Content-Range", `bytes */${size}`).end();
        return;
      }
      const to = Math.min(end, size - 1);
      res.status(206);
      res.setHeader("Content-Range", `bytes ${start}-${to}/${size}`);
      res.setHeader("Content-Length", String(to - start + 1));
      fs.createReadStream(abs, { start, end: to }).pipe(res);
      return;
    }
    res.setHeader("Content-Length", String(size));
    fs.createReadStream(abs).pipe(res);
  });

  r.get("/player/playlists", bearerAuth, requirePlayerAccess, (req: Request, res: Response) => {
    const uid = req.authUser?.id;
    if (!uid) {
      res.status(401).json({ error: "Nicht angemeldet." });
      return;
    }
    res.json({ playlists: playerPlaylistList(uid) });
  });

  r.post("/player/playlists", bearerAuth, requirePlayerAccess, (req: Request, res: Response) => {
    const uid = req.authUser?.id;
    if (!uid) {
      res.status(401).json({ error: "Nicht angemeldet." });
      return;
    }
    const name = typeof req.body?.name === "string" ? req.body.name : "Playlist";
    res.json({ playlist: playerPlaylistCreate(uid, name) });
  });

  r.get("/player/playlists/:id", bearerAuth, requirePlayerAccess, (req: Request, res: Response) => {
    const uid = req.authUser?.id;
    const id = intParam(req.params.id);
    if (!uid || id == null) {
      res.status(400).json({ error: "Ungültige Anfrage." });
      return;
    }
    void sendPlaylist(res, playerPlaylistGet(uid, id));
  });

  r.patch("/player/playlists/:id", bearerAuth, requirePlayerAccess, (req: Request, res: Response) => {
    const uid = req.authUser?.id;
    const id = intParam(req.params.id);
    const name = typeof req.body?.name === "string" ? req.body.name : "";
    if (!uid || id == null) {
      res.status(400).json({ error: "Ungültige Anfrage." });
      return;
    }
    if (!playerPlaylistRename(uid, id, name)) {
      res.status(404).json({ error: "Playlist nicht gefunden." });
      return;
    }
    void sendPlaylist(res, playerPlaylistGet(uid, id));
  });

  r.delete("/player/playlists/:id", bearerAuth, requirePlayerAccess, (req: Request, res: Response) => {
    const uid = req.authUser?.id;
    const id = intParam(req.params.id);
    if (!uid || id == null) {
      res.status(400).json({ error: "Ungültige Anfrage." });
      return;
    }
    if (!playerPlaylistDelete(uid, id)) {
      res.status(404).json({ error: "Playlist nicht gefunden." });
      return;
    }
    res.json({ ok: true });
  });

  r.post("/player/playlists/:id/tracks", bearerAuth, requirePlayerAccess, (req: Request, res: Response) => {
    const uid = req.authUser?.id;
    const id = intParam(req.params.id);
    const trackId = Number(req.body?.trackId);
    if (!uid || id == null || !Number.isFinite(trackId)) {
      res.status(400).json({ error: "Ungültige Anfrage." });
      return;
    }
    if (!playerPlaylistAddTrack(uid, id, trackId)) {
      res.status(400).json({ error: "Track konnte nicht ergänzt werden." });
      return;
    }
    void sendPlaylist(res, playerPlaylistGet(uid, id));
  });

  r.delete("/player/playlists/:id/tracks/:pos", bearerAuth, requirePlayerAccess, (req: Request, res: Response) => {
    const uid = req.authUser?.id;
    const id = intParam(req.params.id);
    const pos = intParam(req.params.pos);
    if (!uid || id == null || pos == null) {
      res.status(400).json({ error: "Ungültige Anfrage." });
      return;
    }
    if (!playerPlaylistRemoveAt(uid, id, pos)) {
      res.status(404).json({ error: "Eintrag nicht gefunden." });
      return;
    }
    void sendPlaylist(res, playerPlaylistGet(uid, id));
  });

  return r;
}
