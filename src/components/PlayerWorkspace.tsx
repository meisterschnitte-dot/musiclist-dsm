import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import {
  addTrackToPlayerPlaylist,
  audioTagsToPlayerPatch,
  deletePlayerCatalogTrack,
  createPlayerPlaylist,
  deletePlayerPlaylist,
  renamePlayerPlaylist,
  fetchPlayerPlaylist,
  fetchPlayerPlaylists,
  fetchPlayerStatus,
  patchPlayerTrackTags,
  playerTrackStreamUrl,
  playerTrackToAudioTags,
  removePlayerPlaylistTrackAt,
  searchPlayerCatalog,
  startPlayerImport,
  type PlayerPlaylist,
  type PlayerScanStatus,
  type PlayerTrack,
} from "../api/playerCatalogApi";
import { apiSharedGvlLabelDbFetch } from "../api/sharedTracksApi";
import type { AudioTags } from "../audio/audioTags";
import type { GvlLabelDb } from "../storage/gvlLabelStore";
import {
  defaultPlayerCatalogWidths,
  emptyPlayerCatalogFilters,
  getPlayerCatalogColumnLabel,
  loadPlayerCatalogTableLayout,
  PLAYER_CATALOG_FILTER_IDS,
  reorderPlayerCatalogColumns,
  sanitizePlayerCatalogWidths,
  savePlayerCatalogTableLayout,
  type PlayerCatalogColumnId,
} from "../player/playerCatalogTableLayout";
import { hasActiveColumnFiltersRecord } from "../tableFilters";
import { DebouncedSearchInput } from "./DebouncedSearchInput";
import { PlayerImportModal } from "./PlayerImportModal";
import { PLAYER_PLAYLIST_COLS, PlayerTrackTable, playerTrackRowKey } from "./PlayerTrackTable";
import { PlayerWaveform, resumePlayerAudio, type PlayerWaveformHandle } from "./PlayerWaveform";
import { TagEditorModal } from "./TagEditorModal";

type Props = { isAdmin: boolean };

const PAGE = 80;
const SPLIT_KEY = "musiclist-player-split-v1";
const TOP_MIN = 0.22;
const TOP_MAX = 0.78;
const PLAYER_MIN = 0.22;
const PLAYER_MAX = 0.78;

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function loadPlayerSplits(): { topFrac: number; playerFrac: number } {
  try {
    const raw = localStorage.getItem(SPLIT_KEY);
    if (!raw) return { topFrac: 0.42, playerFrac: 0.4 };
    const o = JSON.parse(raw) as { topFrac?: unknown; playerFrac?: unknown };
    return {
      topFrac: typeof o.topFrac === "number" ? clamp(o.topFrac, TOP_MIN, TOP_MAX) : 0.42,
      playerFrac: typeof o.playerFrac === "number" ? clamp(o.playerFrac, PLAYER_MIN, PLAYER_MAX) : 0.4,
    };
  } catch {
    return { topFrac: 0.42, playerFrac: 0.4 };
  }
}

function formatDuration(sec: number | null): string {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return "—";
  const s = Math.round(sec);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

function trackLabel(t: PlayerTrack): string {
  const title = t.title.trim() || t.fileName;
  const artist = t.artist.trim();
  return artist ? `${artist} — ${title}` : title;
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        fill="currentColor"
        d="M5.5 1h5l.5 1H14v1.5H2V2h3l.5-1zM3.5 5h9l-.6 9.2A1.5 1.5 0 0 1 10.4 15.5H5.6a1.5 1.5 0 0 1-1.5-1.3L3.5 5zm2.2 2.2-.2 6h1.5l.2-6H5.7zm3.3 0h-1.5l.2 6h1.5l-.2-6z"
      />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path fill="currentColor" d="M7.25 2.25h1.5v4.5h4.5v1.5h-4.5v4.5h-1.5v-4.5h-4.5v-1.5h4.5z" />
    </svg>
  );
}

function PrevIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path fill="currentColor" d="M3 2.5h1.6v11H3zm2.4 5.5 7.6 4.8V3.2z" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path fill="currentColor" d="M4.2 2.4 13.6 8 4.2 13.6z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path fill="currentColor" d="M3.4 2.4h3.2v11.2H3.4zm6 0h3.2v11.2H9.4z" />
    </svg>
  );
}

function NextIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path fill="currentColor" d="M11.4 2.5H13v11h-1.6zM3 3.2v9.6L10.6 8z" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        fill="currentColor"
        d="M11.6 1.7a1.4 1.4 0 0 1 2 0l.7.7a1.4 1.4 0 0 1 0 2l-8.4 8.4-2.8.8.8-2.8 8.4-8.4zM3.2 13.3h9.6v1.5H2.2v-3.2l1 .3v1.4z"
      />
    </svg>
  );
}

function scanMeta(scan: PlayerScanStatus, trackCount: number): string {
  if (scan.running) {
    return `Import läuft … ${scan.processed} Dateien, ${scan.upserted} neu`;
  }
  if (scan.error) return scan.error;
  if (trackCount === 0) return "Noch keine Titel — über + Ordner oder Dateien hinzufügen";
  return `${trackCount.toLocaleString("de-DE")} Titel in der Datenbank`;
}

export function PlayerWorkspace({ isAdmin }: Props) {
  const [trackCount, setTrackCount] = useState(0);
  const [scan, setScan] = useState<PlayerScanStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importReport, setImportReport] = useState<{
    added: number;
    addedTracks: string[];
    skipped: number;
    skippedTracks: string[];
    rejected: number;
    rejectedTracks: string[];
  } | null>(null);
  const [browsePath, setBrowsePath] = useState("");

  const [query, setQuery] = useState("");
  const [tracks, setTracks] = useState<PlayerTrack[]>([]);
  const [searchTotal, setSearchTotal] = useState(0);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const catalogLayoutInit = useMemo(() => loadPlayerCatalogTableLayout(), []);
  const [catalogOrder, setCatalogOrder] = useState(catalogLayoutInit.order);
  const [catalogHidden, setCatalogHidden] = useState(catalogLayoutInit.hidden);
  const [catalogWidths, setCatalogWidths] = useState(catalogLayoutInit.widths);
  const [catalogFilters, setCatalogFilters] = useState(emptyPlayerCatalogFilters);
  const [catalogSort, setCatalogSort] = useState<{
    columnId: PlayerCatalogColumnId;
    direction: "asc" | "desc";
  } | null>(null);

  const [playlists, setPlaylists] = useState<PlayerPlaylist[]>([]);
  const [activePlaylistId, setActivePlaylistId] = useState<number | null>(null);
  const [playlistDialog, setPlaylistDialog] = useState<null | "create" | "rename">(null);
  const [playlistDialogName, setPlaylistDialogName] = useState("");
  const playlistDialogInputRef = useRef<HTMLInputElement | null>(null);
  const [playlistTracks, setPlaylistTracks] = useState<PlayerTrack[]>([]);
  const [playlistError, setPlaylistError] = useState<string | null>(null);

  const [selected, setSelected] = useState<{
    source: "catalog" | "playlist";
    key: string;
    track: PlayerTrack;
  } | null>(null);
  const [tagEditTrack, setTagEditTrack] = useState<PlayerTrack | null>(null);
  const [gvlLabelDb, setGvlLabelDb] = useState<GvlLabelDb | null>(null);
  const [nowPlaying, setNowPlaying] = useState<PlayerTrack | null>(null);
  const [queue, setQueue] = useState<PlayerTrack[]>([]);
  const [queueIndex, setQueueIndex] = useState(0);
  const [playError, setPlayError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [playTime, setPlayTime] = useState({ current: 0, duration: 0 });
  const waveformRef = useRef<PlayerWaveformHandle | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const topRowRef = useRef<HTMLDivElement | null>(null);
  const [{ topFrac, playerFrac }, setSplits] = useState(loadPlayerSplits);
  const topDragRef = useRef<{ y: number; frac: number } | null>(null);
  const playerDragRef = useRef<{ x: number; frac: number } | null>(null);

  useEffect(() => {
    localStorage.setItem(SPLIT_KEY, JSON.stringify({ topFrac, playerFrac }));
  }, [topFrac, playerFrac]);

  const onTopSplitMouseDown = useCallback(
    (e: ReactMouseEvent) => {
      e.preventDefault();
      topDragRef.current = { y: e.clientY, frac: topFrac };
      const onMove = (ev: MouseEvent) => {
        const start = topDragRef.current;
        const root = rootRef.current;
        if (!start || !root) return;
        const h = root.getBoundingClientRect().height;
        if (h < 1) return;
        setSplits((prev) => ({
          ...prev,
          topFrac: clamp(start.frac + (ev.clientY - start.y) / h, TOP_MIN, TOP_MAX),
        }));
      };
      const onUp = () => {
        topDragRef.current = null;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [topFrac]
  );

  const onPlayerSplitMouseDown = useCallback(
    (e: ReactMouseEvent) => {
      e.preventDefault();
      playerDragRef.current = { x: e.clientX, frac: playerFrac };
      const onMove = (ev: MouseEvent) => {
        const start = playerDragRef.current;
        const row = topRowRef.current;
        if (!start || !row) return;
        const w = row.getBoundingClientRect().width;
        if (w < 1) return;
        setSplits((prev) => ({
          ...prev,
          playerFrac: clamp(start.frac + (ev.clientX - start.x) / w, PLAYER_MIN, PLAYER_MAX),
        }));
      };
      const onUp = () => {
        playerDragRef.current = null;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [playerFrac]
  );

  const setPlayTimeAndPlaying = useCallback(
    (s: { playing: boolean; current: number; duration: number }) => {
      setPlaying(s.playing);
      setPlayTime({ current: s.current, duration: s.duration });
    },
    []
  );

  const streamSrc = useMemo(() => {
    if (!nowPlaying) return "";
    try {
      return playerTrackStreamUrl(nowPlaying.id);
    } catch {
      return "";
    }
  }, [nowPlaying]);

  const refreshStatus = useCallback(async () => {
    const st = await fetchPlayerStatus();
    setTrackCount(st.trackCount);
    setScan(st.scan);
    if (st.browsePath) setBrowsePath(st.browsePath);
    return st;
  }, []);

  const refreshPlaylists = useCallback(async () => {
    const lists = await fetchPlayerPlaylists();
    setPlaylists(lists);
    return lists;
  }, []);

  const catalogVisibleIds = useMemo(
    () => catalogOrder.filter((id) => !catalogHidden.has(id)),
    [catalogOrder, catalogHidden]
  );
  const catalogHiddenSorted = useMemo(
    () =>
      [...catalogHidden].sort((a, b) => catalogOrder.indexOf(a) - catalogOrder.indexOf(b)),
    [catalogHidden, catalogOrder]
  );
  const catalogVisibleWidths = useMemo(() => {
    const def = defaultPlayerCatalogWidths();
    return catalogVisibleIds.map((id) => catalogWidths[id] ?? def[id]);
  }, [catalogVisibleIds, catalogWidths]);

  useEffect(() => {
    savePlayerCatalogTableLayout({
      order: catalogOrder,
      hidden: catalogHidden,
      widths: sanitizePlayerCatalogWidths(catalogWidths),
    });
  }, [catalogOrder, catalogHidden, catalogWidths]);

  const hideCatalogColumn = useCallback((id: PlayerCatalogColumnId) => {
    if (id === "add") return;
    setCatalogHidden((prev) => {
      if (prev.has(id)) return prev;
      const visibleData = PLAYER_CATALOG_FILTER_IDS.filter((c) => !prev.has(c)).length;
      if (visibleData <= 1) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    setCatalogFilters((f) => ({ ...f, [id]: "" }));
  }, []);

  const showCatalogColumn = useCallback((id: PlayerCatalogColumnId) => {
    setCatalogHidden((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const runSearch = useCallback(async (q: string, offset = 0, append = false) => {
    setSearchBusy(true);
    setSearchError(null);
    try {
      const data = await searchPlayerCatalog({
        q,
        offset,
        limit: PAGE,
        filters: catalogFilters,
        sort: catalogSort && catalogSort.columnId !== "add" ? catalogSort : null,
      });
      setTracks((prev) => (append ? [...prev, ...data.tracks] : data.tracks));
      setSearchTotal(data.total);
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : "Suche fehlgeschlagen.");
    } finally {
      setSearchBusy(false);
    }
  }, [catalogFilters, catalogSort]);

  const openPlaylist = useCallback(async (id: number) => {
    setPlaylistError(null);
    setActivePlaylistId(id);
    try {
      const data = await fetchPlayerPlaylist(id);
      setPlaylistTracks(data.tracks);
    } catch (e) {
      setPlaylistTracks([]);
      setPlaylistError(e instanceof Error ? e.message : "Playlist nicht geladen.");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const st = await refreshStatus();
        if (cancelled) return;
        await refreshPlaylists();
        if (!cancelled) await runSearch("");
      } catch (e) {
        if (!cancelled) setStatusError(e instanceof Error ? e.message : "Status nicht geladen.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshPlaylists, refreshStatus, runSearch]);

  const wasScanning = useRef(false);
  useEffect(() => {
    if (scan?.running) {
      wasScanning.current = true;
      const id = window.setInterval(() => {
        void refreshStatus().catch(() => undefined);
      }, 1500);
      return () => window.clearInterval(id);
    }
    if (wasScanning.current) {
      wasScanning.current = false;
      setImportOpen(false);
      void (async () => {
        try {
          const st = await refreshStatus();
          void runSearch(query);
          const added = st.scan.upserted ?? 0;
          const skipped = st.scan.skipped ?? 0;
          const rejected = st.scan.rejected ?? 0;
          if (!st.scan.error && (added > 0 || skipped > 0 || rejected > 0)) {
            setImportReport({
              added,
              addedTracks: st.scan.addedTracks ?? [],
              skipped,
              skippedTracks: st.scan.skippedTracks ?? [],
              rejected,
              rejectedTracks: st.scan.rejectedTracks ?? [],
            });
          }
        } catch {
          void runSearch(query);
        }
      })();
    }
  }, [scan?.running, refreshStatus, runSearch, query]);

  useEffect(() => {
    void runSearch(query);
  }, [query, catalogFilters, catalogSort, runSearch]);

  const playTracks = useCallback((list: PlayerTrack[], index: number) => {
    const track = list[index];
    if (!track) return;
    resumePlayerAudio();
    setPlayError(null);
    setPlaying(true);
    setPlayTime({ current: 0, duration: track.durationSec ?? 0 });
    setQueue(list);
    setQueueIndex(index);
    setNowPlaying(track);
  }, []);

  const playNext = useCallback(() => {
    if (queueIndex + 1 >= queue.length) return;
    playTracks(queue, queueIndex + 1);
  }, [playTracks, queue, queueIndex]);

  const playPrev = useCallback(() => {
    if (queueIndex <= 0) return;
    playTracks(queue, queueIndex - 1);
  }, [playTracks, queue, queueIndex]);

  const togglePlay = useCallback(() => {
    resumePlayerAudio();
    waveformRef.current?.toggle();
  }, []);

  useEffect(() => {
    if (!nowPlaying) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== " " && e.code !== "Space") return;
      if (e.repeat) return;
      if (importOpen || playlistDialog || importReport || tagEditTrack) return;
      const el = e.target instanceof HTMLElement ? e.target : null;
      if (el) {
        const tag = el.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable) return;
      }
      e.preventDefault();
      togglePlay();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [importOpen, importReport, nowPlaying, playlistDialog, tagEditTrack, togglePlay]);

  const applyUpdatedTrack = useCallback((updated: PlayerTrack) => {
    setTracks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
    setPlaylistTracks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
    setQueue((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
    setNowPlaying((cur) => (cur?.id === updated.id ? updated : cur));
    setSelected((cur) => (cur && cur.track.id === updated.id ? { ...cur, track: updated } : cur));
    setTagEditTrack((cur) => (cur?.id === updated.id ? updated : cur));
  }, []);

  const openPlayerTagEditor = useCallback((track: PlayerTrack) => {
    setStatusError(null);
    setTagEditTrack(track);
    void apiSharedGvlLabelDbFetch()
      .then((db) => {
        if (db) setGvlLabelDb(db);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key !== "t" && e.key !== "T") return;
      const ae = document.activeElement;
      if (
        ae instanceof HTMLInputElement ||
        ae instanceof HTMLTextAreaElement ||
        ae instanceof HTMLSelectElement ||
        (ae instanceof HTMLElement && ae.isContentEditable)
      )
        return;
      if (importOpen || playlistDialog || importReport || tagEditTrack) return;
      if (!selected) return;
      e.preventDefault();
      openPlayerTagEditor(selected.track);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [importOpen, importReport, openPlayerTagEditor, playlistDialog, selected, tagEditTrack]);

  const onSavePlayerTags = useCallback(
    async (tags: AudioTags) => {
      if (!tagEditTrack) return;
      try {
        const updated = await patchPlayerTrackTags(tagEditTrack.id, audioTagsToPlayerPatch(tags));
        applyUpdatedTrack(updated);
        setTagEditTrack(null);
      } catch (e) {
        setStatusError(e instanceof Error ? e.message : "Tags konnten nicht gespeichert werden.");
      }
    },
    [applyUpdatedTrack, tagEditTrack]
  );

  const onImportPaths = async (paths: string[]) => {
    setStatusError(null);
    try {
      const next = await startPlayerImport(paths);
      setScan(next);
    } catch (e) {
      setStatusError(e instanceof Error ? e.message : "Import nicht gestartet.");
    }
  };

  const closePlaylistDialog = () => {
    setPlaylistDialog(null);
    setPlaylistDialogName("");
  };

  const onCreatePlaylist = async () => {
    setPlaylistError(null);
    try {
      const created = await createPlayerPlaylist(playlistDialogName.trim() || "Playlist");
      closePlaylistDialog();
      await refreshPlaylists();
      await openPlaylist(created.id);
    } catch (e) {
      setPlaylistError(e instanceof Error ? e.message : "Playlist nicht angelegt.");
    }
  };

  const onRenamePlaylist = async () => {
    if (activePlaylistId == null) return;
    setPlaylistError(null);
    try {
      const data = await renamePlayerPlaylist(activePlaylistId, playlistDialogName.trim() || "Playlist");
      closePlaylistDialog();
      await refreshPlaylists();
      setPlaylistTracks(data.tracks);
    } catch (e) {
      setPlaylistError(e instanceof Error ? e.message : "Playlist nicht umbenannt.");
    }
  };

  useEffect(() => {
    if (!playlistDialog) return;
    playlistDialogInputRef.current?.focus();
    playlistDialogInputRef.current?.select();
  }, [playlistDialog]);

  const onDeletePlaylist = async (id: number) => {
    setPlaylistError(null);
    try {
      await deletePlayerPlaylist(id);
      if (activePlaylistId === id) {
        setActivePlaylistId(null);
        setPlaylistTracks([]);
      }
      await refreshPlaylists();
    } catch (e) {
      setPlaylistError(e instanceof Error ? e.message : "Playlist nicht gelöscht.");
    }
  };

  const onDeleteFromCatalog = async (track: PlayerTrack) => {
    setStatusError(null);
    try {
      await deletePlayerCatalogTrack(track.id);
      if (selected?.track.id === track.id) setSelected(null);
      if (tagEditTrack?.id === track.id) setTagEditTrack(null);
      if (nowPlaying?.id === track.id) {
        waveformRef.current?.pause();
        setNowPlaying(null);
        setQueue([]);
        setQueueIndex(0);
        setPlaying(false);
      } else {
        setQueue((prev) => prev.filter((t) => t.id !== track.id));
      }
      await refreshStatus();
      await runSearch(query);
      await refreshPlaylists();
      if (activePlaylistId != null) await openPlaylist(activePlaylistId);
    } catch (e) {
      setStatusError(e instanceof Error ? e.message : "Track nicht aus der Datenbank entfernt.");
    }
  };

  const onAddToPlaylist = async (track: PlayerTrack) => {
    if (activePlaylistId == null) {
      setPlaylistError("Bitte zuerst eine Playlist wählen oder anlegen.");
      return;
    }
    setPlaylistError(null);
    try {
      const data = await addTrackToPlayerPlaylist(activePlaylistId, track.id);
      setPlaylistTracks(data.tracks);
      await refreshPlaylists();
    } catch (e) {
      setPlaylistError(e instanceof Error ? e.message : "Track nicht ergänzt.");
    }
  };

  const onRemoveFromPlaylist = async (pos: number) => {
    if (activePlaylistId == null) return;
    setPlaylistError(null);
    try {
      const data = await removePlayerPlaylistTrackAt(activePlaylistId, pos);
      setPlaylistTracks(data.tracks);
      await refreshPlaylists();
    } catch (e) {
      setPlaylistError(e instanceof Error ? e.message : "Eintrag nicht entfernt.");
    }
  };

  const activePlaylist = playlists.find((p) => p.id === activePlaylistId) ?? null;
  const pageFrom = tracks.length === 0 ? 0 : 1;
  const shown = tracks.length;

  return (
    <div className="player-workspace" aria-label="Interner Musikplayer" ref={rootRef}>
      <div className="player-workspace__top" ref={topRowRef} style={{ flex: `${topFrac} 1 0` }}>
        <section
          className="panel player-workspace__pane"
          aria-label="Wiedergabe"
          style={{ flex: `${playerFrac} 1 0` }}
        >
          <div className="panel-head">
            <div className="panel-head-title-row player-workspace__play-head">
              <div className="player-workspace__playlist-title">
                <h2 className="panel-title">Wiedergabe</h2>
                <p className="panel-title-meta">{nowPlaying ? trackLabel(nowPlaying) : "Nur im internen Netz"}</p>
              </div>
              <div className="player-workspace__play-toolbar">
                <button
                  type="button"
                  className="btn-cell player-workspace__icon-btn player-workspace__icon-btn--transport"
                  onClick={playPrev}
                  disabled={!nowPlaying || queueIndex <= 0}
                  aria-label="Zurück"
                  title="Zurück"
                >
                  <PrevIcon />
                </button>
                <button
                  type="button"
                  className="btn-cell btn-cell--primary player-workspace__icon-btn player-workspace__icon-btn--transport"
                  onClick={togglePlay}
                  disabled={!nowPlaying}
                  aria-label={playing ? "Pause" : "Play"}
                  title={playing ? "Pause" : "Play"}
                >
                  {playing ? <PauseIcon /> : <PlayIcon />}
                </button>
                <button
                  type="button"
                  className="btn-cell player-workspace__icon-btn player-workspace__icon-btn--transport"
                  onClick={playNext}
                  disabled={!nowPlaying || queueIndex + 1 >= queue.length}
                  aria-label="Weiter"
                  title="Weiter"
                >
                  <NextIcon />
                </button>
                <span className="player-workspace__time">
                  {nowPlaying
                    ? `${formatDuration(playTime.current)} / ${formatDuration(playTime.duration || nowPlaying.durationSec)}`
                    : "— / —"}
                </span>
              </div>
            </div>
          </div>
          <div className="panel-body player-workspace__player">
            {playError ? <p className="err">{playError}</p> : null}
            {nowPlaying ? (
              <>
                {streamSrc ? (
                  <PlayerWaveform
                    src={streamSrc}
                    trackId={nowPlaying.id}
                    waveformRef={waveformRef}
                    onEnded={playNext}
                    onState={setPlayTimeAndPlaying}
                    onError={setPlayError}
                  />
                ) : null}
              </>
            ) : (
              <p className="player-workspace__hint">
                Zeile anklicken zum Auswählen, doppelklicken zum Abspielen. Audio kommt direkt von der Datei (HTTP Range).
              </p>
            )}
          </div>
        </section>

        <div
          className="split-panes-resizer split-panes-resizer--col"
          role="separator"
          aria-orientation="vertical"
          aria-label="Breite Wiedergabe und Playlists"
          tabIndex={0}
          onMouseDown={onPlayerSplitMouseDown}
          onKeyDown={(e) => {
            if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
            e.preventDefault();
            const step = 0.03;
            setSplits((prev) => ({
              ...prev,
              playerFrac: clamp(prev.playerFrac + (e.key === "ArrowRight" ? step : -step), PLAYER_MIN, PLAYER_MAX),
            }));
          }}
        />

        <section
          className="panel player-workspace__pane"
          aria-label="Playlists"
          style={{ flex: `${1 - playerFrac} 1 0` }}
        >
          <div className="panel-head">
            <div className="panel-head-title-row player-workspace__playlist-head">
              <div className="player-workspace__playlist-title">
                <h2 className="panel-title">Playlists</h2>
              </div>
              <div className="player-workspace__playlist-toolbar">
                <select
                  className="player-workspace__input player-workspace__select"
                  value={activePlaylistId ?? ""}
                  aria-label="Playlist wählen"
                  onChange={(e) => {
                    const id = Number(e.target.value);
                    if (!Number.isFinite(id) || id <= 0) {
                      setActivePlaylistId(null);
                      setPlaylistTracks([]);
                      return;
                    }
                    void openPlaylist(id);
                  }}
                >
                  <option value="">Playlist</option>
                  {playlists.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.trackCount})
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn-cell player-workspace__icon-btn"
                  onClick={() => {
                    setPlaylistError(null);
                    setPlaylistDialogName("");
                    setPlaylistDialog("create");
                  }}
                  aria-label="Neue Playlist"
                  title="Neue Playlist"
                >
                  <PlusIcon />
                </button>
                <button
                  type="button"
                  className="btn-cell player-workspace__icon-btn"
                  disabled={activePlaylistId == null}
                  onClick={() => {
                    if (!activePlaylist) return;
                    setPlaylistError(null);
                    setPlaylistDialogName(activePlaylist.name);
                    setPlaylistDialog("rename");
                  }}
                  aria-label={activePlaylist ? `${activePlaylist.name} umbenennen` : "Playlist umbenennen"}
                  title="Playlist umbenennen"
                >
                  <PencilIcon />
                </button>
                <button
                  type="button"
                  className="btn-cell btn-cell--danger player-workspace__icon-btn"
                  disabled={activePlaylistId == null}
                  onClick={() => {
                    if (activePlaylistId != null) void onDeletePlaylist(activePlaylistId);
                  }}
                  aria-label={activePlaylist ? `${activePlaylist.name} löschen` : "Playlist löschen"}
                  title="Playlist löschen"
                >
                  <TrashIcon />
                </button>
              </div>
            </div>
            {playlistError ? <p className="err">{playlistError}</p> : null}
          </div>
          <div className="panel-body">
            <div className="player-workspace__playlist-tracks panel-scroll">
              {activePlaylistId == null ? (
                <p className="player-workspace__hint">Eine Playlist wählen, dann Titel aus der Musikdatenbank ergänzen.</p>
              ) : playlistTracks.length === 0 ? (
                <p className="player-workspace__hint">Diese Playlist ist leer.</p>
              ) : (
                <PlayerTrackTable
                  columns={PLAYER_PLAYLIST_COLS}
                  tracks={playlistTracks}
                  storageKey="musiclist-player-playlist-cols-v2"
                  nowPlayingId={nowPlaying?.id}
                  formatDuration={formatDuration}
                  selectedKey={selected?.source === "playlist" ? selected.key : null}
                  onSelect={(t, i) => setSelected({ source: "playlist", key: playerTrackRowKey(t, i), track: t })}
                  onPlay={(_t, i) => playTracks(playlistTracks, i)}
                  removeControl={(t, i) => (
                    <button
                      type="button"
                      className="btn-cell btn-cell--danger player-workspace__icon-btn"
                      onClick={() => void onRemoveFromPlaylist(i)}
                      aria-label={`${t.title.trim() || t.fileName} entfernen`}
                      title="Aus Playlist entfernen"
                    >
                      <TrashIcon />
                    </button>
                  )}
                />
              )}
            </div>
          </div>
        </section>
      </div>

      <div
        className="split-panes-resizer"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Höhe Wiedergabe/Playlists und Musikdatenbank"
        tabIndex={0}
        onMouseDown={onTopSplitMouseDown}
        onKeyDown={(e) => {
          if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
          e.preventDefault();
          const step = 0.03;
          setSplits((prev) => ({
            ...prev,
            topFrac: clamp(prev.topFrac + (e.key === "ArrowUp" ? -step : step), TOP_MIN, TOP_MAX),
          }));
        }}
      />

      <section
        className="panel player-workspace__pane"
        aria-label="Musikdatenbank"
        style={{ flex: `${1 - topFrac} 1 0` }}
      >
        <div className="panel-head">
          <div className="panel-head-title-row player-workspace__catalog-head">
            <div className="player-workspace__playlist-title">
              <div className="player-workspace__db-title-row">
                <div className="player-workspace__db-heading">
                  <h2 className="panel-title">Musikdatenbank</h2>
                  <p className="panel-title-meta">{scan ? scanMeta(scan, trackCount) : "Internes Archiv"}</p>
                </div>
                {isAdmin ? (
                  <button
                    type="button"
                    className="btn-cell btn-cell--primary player-workspace__icon-btn player-workspace__icon-btn--catalog-add"
                    onClick={() => setImportOpen(true)}
                    disabled={scan?.running === true}
                    aria-label="Ordner oder Titel hinzufügen"
                    title="Ordner oder Titel hinzufügen"
                  >
                    <PlusIcon />
                  </button>
                ) : null}
                <DebouncedSearchInput
                  className="player-workspace__input player-workspace__input--wide player-workspace__catalog-search"
                  value={query}
                  onChange={setQuery}
                  debounceMs={280}
                  commitOnEnter={false}
                  placeholder="Suche (Datei, Songtitel, Interpret, Albumtitel, Komponist, Label, ISRC)"
                  aria-label="Suche in der Musikdatenbank"
                />
                <span className="player-workspace__count">
                  {searchBusy ? "Suche…" : `${shown.toLocaleString("de-DE")} / ${searchTotal.toLocaleString("de-DE")}`}
                </span>
              </div>
              {catalogHiddenSorted.length > 0 ? (
                <div className="player-workspace__db-meta-row">
                  <div className="panel-mp3-hidden-cols" role="group" aria-label="Ausgeblendete Spalten wieder anzeigen">
                    {catalogHiddenSorted.map((hid) => (
                      <button
                        key={hid}
                        type="button"
                        className="btn-mp3-col-restore"
                        onClick={() => showCatalogColumn(hid)}
                      >
                        {getPlayerCatalogColumnLabel(hid)}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
            {hasActiveColumnFiltersRecord(catalogFilters) ? (
              <button
                type="button"
                className="btn-filter-clear-global"
                onClick={() => setCatalogFilters(emptyPlayerCatalogFilters())}
              >
                Alle Filter zurücksetzen
              </button>
            ) : null}
          </div>
        </div>
        <div className="panel-body">
          {statusError ? <p className="err">{statusError}</p> : null}
          {searchError ? <p className="err">{searchError}</p> : null}
          <div className="panel-scroll">
            {tracks.length === 0 ? (
              <p className="player-workspace__hint">
                {pageFrom === 0 && !searchBusy
                  ? hasActiveColumnFiltersRecord(catalogFilters) || query.trim()
                    ? "Keine Treffer für Suche oder Filter."
                    : "Keine Treffer. Über + Titel hinzufügen oder die Suche ändern."
                  : null}
              </p>
            ) : (
              <PlayerTrackTable
                columns={catalogVisibleIds}
                tracks={tracks}
                controlledWidths={catalogVisibleWidths}
                onWidthsCommit={(next) => {
                  setCatalogWidths((prev) => {
                    const n = { ...prev };
                    catalogVisibleIds.forEach((id, i) => {
                      n[id] = next[i] ?? n[id];
                    });
                    return sanitizePlayerCatalogWidths(n);
                  });
                }}
                catalogChrome={{
                  filters: catalogFilters,
                  onFilterChange: (id, value) => setCatalogFilters((p) => ({ ...p, [id]: value })),
                  sort: catalogSort,
                  onSort: (id, direction) => setCatalogSort({ columnId: id, direction }),
                  onHide: hideCatalogColumn,
                  hideDisabled: catalogVisibleIds.filter((id) => id !== "add").length <= 1,
                  onReorder: (from, to) =>
                    setCatalogOrder((o) => reorderPlayerCatalogColumns(o, catalogHidden, from, to)),
                }}
                nowPlayingId={nowPlaying?.id}
                formatDuration={formatDuration}
                selectedKey={selected?.source === "catalog" ? selected.key : null}
                onSelect={(t, i) => setSelected({ source: "catalog", key: playerTrackRowKey(t, i), track: t })}
                onPlay={(t) => playTracks([t], 0)}
                onAdd={(t) => void onAddToPlaylist(t)}
                deleteControl={
                  isAdmin
                    ? (t) => (
                        <button
                          type="button"
                          className="btn-cell btn-cell--danger player-workspace__icon-btn"
                          onClick={() => void onDeleteFromCatalog(t)}
                          aria-label={`${t.title.trim() || t.fileName} aus der Musikdatenbank entfernen`}
                          title="Aus der Musikdatenbank entfernen (Datei bleibt erhalten)"
                        >
                          <TrashIcon />
                        </button>
                      )
                    : undefined
                }
              />
            )}
            {tracks.length < searchTotal ? (
              <button
                type="button"
                className="btn-cell"
                disabled={searchBusy}
                onClick={() => void runSearch(query, tracks.length, true)}
              >
                Weitere laden
              </button>
            ) : null}
          </div>
        </div>
      </section>

      {playlistDialog ? (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="player-playlist-dialog-title"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closePlaylistDialog();
          }}
        >
          <div className="modal modal--new-folder" onMouseDown={(e) => e.stopPropagation()}>
            <h2 id="player-playlist-dialog-title" className="modal-title">
              {playlistDialog === "rename" ? "Playlist umbenennen" : "Neue Playlist"}
            </h2>
            <form
              className="edl-new-folder-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (playlistDialog === "rename") void onRenamePlaylist();
                else void onCreatePlaylist();
              }}
            >
              <label className="tag-field">
                <span>Name</span>
                <input
                  ref={playlistDialogInputRef}
                  type="text"
                  value={playlistDialogName}
                  onChange={(e) => setPlaylistDialogName(e.target.value)}
                  autoComplete="off"
                  required
                />
              </label>
              <div className="modal-actions">
                <button type="button" className="btn-modal" onClick={closePlaylistDialog}>
                  Abbrechen
                </button>
                <button type="submit" className="btn-modal primary" disabled={!playlistDialogName.trim()}>
                  Speichern
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {importOpen ? (
        <PlayerImportModal
          initialPath={browsePath}
          busy={scan?.running === true}
          onClose={() => {
            if (scan?.running) return;
            setImportOpen(false);
          }}
          onImport={(paths) => void onImportPaths(paths)}
        />
      ) : null}

      {importReport ? (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="player-import-report-title"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setImportReport(null);
          }}
        >
          <div className="modal modal--new-folder player-import-skip-modal" onMouseDown={(e) => e.stopPropagation()}>
            <h2 id="player-import-report-title" className="modal-title">
              {importReport.added > 0
                ? "Import abgeschlossen"
                : importReport.rejected > 0
                  ? "Nicht ingestet"
                  : "Bereits vorhanden"}
            </h2>
            {importReport.added > 0 ? (
              <>
                <p className="player-workspace__hint">
                  {importReport.added === 1
                    ? "1 Track wurde hinzugefügt."
                    : `${importReport.added} Tracks wurden hinzugefügt.`}
                </p>
                {importReport.addedTracks.length > 0 ? (
                  <ul className="modal-delete-mp3-list player-import-skip-modal__list">
                    {importReport.addedTracks.map((name, i) => (
                      <li key={`added-${name}-${i}`}>{name}</li>
                    ))}
                  </ul>
                ) : null}
                {importReport.added > importReport.addedTracks.length ? (
                  <p className="player-workspace__hint">
                    … und {(importReport.added - importReport.addedTracks.length).toLocaleString("de-DE")} weitere.
                  </p>
                ) : null}
              </>
            ) : null}
            {importReport.rejected > 0 ? (
              <>
                <p className="err">
                  {importReport.rejected === 1
                    ? "1 Track wurde nicht ingestet, weil die Datei nicht abspielbar ist."
                    : `${importReport.rejected} Tracks wurden nicht ingestet, weil die Dateien nicht abspielbar sind.`}
                </p>
                {importReport.rejectedTracks.length > 0 ? (
                  <ul className="modal-delete-mp3-list player-import-skip-modal__list">
                    {importReport.rejectedTracks.map((name, i) => (
                      <li key={`rej-${name}-${i}`}>{name}</li>
                    ))}
                  </ul>
                ) : null}
                {importReport.rejected > importReport.rejectedTracks.length ? (
                  <p className="player-workspace__hint">
                    … und {(importReport.rejected - importReport.rejectedTracks.length).toLocaleString("de-DE")} weitere.
                  </p>
                ) : null}
              </>
            ) : null}
            {importReport.skipped > 0 ? (
              <>
                <p className="player-workspace__hint">
                  {importReport.skipped === 1
                    ? "1 Track wurde nicht ingestet, da dieser bereits in der Datenbank vorhanden ist."
                    : `${importReport.skipped} Tracks wurden nicht ingestet, da diese bereits in der Datenbank vorhanden sind.`}
                </p>
                {importReport.skippedTracks.length > 0 ? (
                  <ul className="modal-delete-mp3-list player-import-skip-modal__list">
                    {importReport.skippedTracks.map((name, i) => (
                      <li key={`skip-${name}-${i}`}>{name}</li>
                    ))}
                  </ul>
                ) : null}
                {importReport.skipped > importReport.skippedTracks.length ? (
                  <p className="player-workspace__hint">
                    … und {(importReport.skipped - importReport.skippedTracks.length).toLocaleString("de-DE")} weitere.
                  </p>
                ) : null}
              </>
            ) : null}
            <div className="modal-actions">
              <button type="button" className="btn-modal primary" onClick={() => setImportReport(null)}>
                OK
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {tagEditTrack ? (
        <TagEditorModal
          open
          heading={`Tags — ${tagEditTrack.title.trim() || tagEditTrack.fileName}`}
          initial={playerTrackToAudioTags(tagEditTrack)}
          p7SearchSource={tagEditTrack.fileName || tagEditTrack.title || null}
          gvlLabelDb={gvlLabelDb}
          showGvlDatabaseButton={false}
          onOpenGvlDatabase={() => undefined}
          clipLoopAvailable
          clipLoopPlaying={playing && nowPlaying?.id === tagEditTrack.id}
          onClipLoopPlay={() => {
            if (nowPlaying?.id === tagEditTrack.id) {
              if (!playing) togglePlay();
              return;
            }
            playTracks([tagEditTrack], 0);
          }}
          onClipLoopStop={() => {
            if (nowPlaying?.id === tagEditTrack.id && playing) togglePlay();
            else waveformRef.current?.pause();
          }}
          onClose={() => setTagEditTrack(null)}
          onSave={onSavePlayerTags}
        />
      ) : null}
    </div>
  );
}
