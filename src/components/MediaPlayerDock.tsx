import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";
import type { PlaylistEntry } from "../edl/types";
import {
  DEFAULT_FPS,
  normalizeFramesToDay,
  offsetFromOriginFrame,
  suggestedTimelineOriginFromFirstRecIn,
} from "../edl/timecode";
import { basenamePath } from "../tracks/sanitizeFilename";
import { DEFAULT_TIMELINE_ORIGIN_FRAMES, PlaylistTimeline } from "./PlaylistTimeline";

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Bisherige feste Videobreite — kleinste zulässige Breite beim Ziehen. */
const VIDEO_SLOT_MIN_PX = 280;
/** Resizer-Breite + horizontaler Außenabstand (CSS: 6px + 2px + 2px). */
const VIDEO_ROW_RESIZER_TOTAL_PX = 10;
/** Mindestbreite für die Timeline neben dem Video. */
const TIMELINE_MIN_PX = 160;

type MediaKind = "audio" | "video" | null;

function isWavFile(file: File): boolean {
  const n = file.name.toLowerCase();
  if (/\.(wav|wave)$/i.test(n)) return true;
  const t = file.type.toLowerCase();
  return t === "audio/wav" || t === "audio/wave" || t === "audio/x-wav" || t === "audio/vnd.wave";
}

function guessKind(file: File): MediaKind {
  const t = file.type.toLowerCase();
  const n = file.name.toLowerCase();
  if (t.startsWith("video/") || /\.mp4$/i.test(n)) return "video";
  /** Wie MP4: großes Fenster, DnD, Leertaste, Playhead + Timeline-Seek. */
  if (isWavFile(file)) return "video";
  if (t.startsWith("audio/") || /\.mp3$/i.test(n)) return "audio";
  if (/\.(mp3|mp4)$/i.test(n)) return n.endsWith(".mp4") ? "video" : "audio";
  return "audio";
}

function isAllowedMediaFile(f: File): boolean {
  const n = f.name.toLowerCase();
  if (!/\.(mp3|wav|wave|mp4)$/i.test(n)) return false;
  const t = f.type.toLowerCase();
  if (!t) return true;
  return t.startsWith("audio/") || t.startsWith("video/");
}

function shouldIgnoreGlobalSpaceShortcut(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === "textarea") return true;
  if (tag === "input") {
    const t = ((el as HTMLInputElement).type || "").toLowerCase();
    /** Nur bei Texteingabe blockieren; Timeline-/Range-Fokus soll Space erlauben. */
    return (
      t === "" ||
      t === "text" ||
      t === "search" ||
      t === "password" ||
      t === "email" ||
      t === "url" ||
      t === "tel" ||
      t === "number"
    );
  }
  if (el.isContentEditable) return true;
  return Boolean(el.closest("textarea, input[type='text'], input[type='search'], input[type='password'], input[type='email'], input[type='url'], input[type='tel'], input[type='number'], [contenteditable='true']"));
}

function findPlaylistRowForFileName(
  playlist: PlaylistEntry[] | null,
  fileName: string
): PlaylistEntry | null {
  if (!playlist?.length || !fileName.trim()) return null;
  const n = fileName.trim().toLowerCase();
  for (const row of playlist) {
    const linked = row.linkedTrackFileName?.trim();
    if (linked && basenamePath(linked).toLowerCase() === n) return row;
    if (row.title.trim().toLowerCase() === n) return row;
    if (basenamePath(row.sourceKey).toLowerCase() === n) return row;
  }
  return null;
}

/**
 * Lokaler Mediaplayer (MP3, WAV, MP4) unter der Musikdatenbank. WAV und MP4 teilen
 * dasselbe Anzeigefenster (HTML-Video) und die Timeline; MP3 bleibt die kompakte Vorschau.
 * Anbindung an Server-/Bibliotheksdateien kann später ergänzt werden.
 */
export function MediaPlayerDock({
  playlist = null,
  playlistDocumentTitle = null,
  tagIncompleteByEntryId = null,
  onTimelineClipSelectEntryId = null,
  seekToProgramFramesRequest = null,
}: {
  playlist?: PlaylistEntry[] | null;
  /** Anzeige über der Timeline (z. B. geladene .list / EDL-Name). */
  playlistDocumentTitle?: string | null;
  /** Pro Zeilen-ID: unvollständige Tags (nur Markierung in der Timeline, nicht in der EDL). */
  tagIncompleteByEntryId?: Readonly<Record<string, boolean>> | null;
  /** Klick auf einen Clip: EDL-Zeile fokussieren und Programm-TC setzen. */
  onTimelineClipSelectEntryId?: ((entryId: string) => void) | null;
  /** Bei Klick auf einen Playlist-Track: Programm-TC springen (`requestId` bei jedem Klick erhöhen). */
  seekToProgramFramesRequest?: { programFrames: number; requestId: number } | null;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<MediaKind>(null);
  const [originFrames, setOriginFrames] = useState(DEFAULT_TIMELINE_ORIGIN_FRAMES);
  const playlistRef = useRef(playlist);
  playlistRef.current = playlist;
  const [playheadFrames, setPlayheadFrames] = useState<number | null>(null);
  /** Mediendauer in Sekunden (Video: für End-TC in der Timeline bei 25 fps). */
  const [mediaDurationSec, setMediaDurationSec] = useState<number | null>(null);
  const [videoSlotWidthPx, setVideoSlotWidthPx] = useState(VIDEO_SLOT_MIN_PX);
  const rowRef = useRef<HTMLDivElement | null>(null);
  const videoResizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const [videoSlotDragOver, setVideoSlotDragOver] = useState(false);

  /** Beim Öffnen einer anderen Playlist: Start-TC = Stunde des ersten Eintrags, sonst 00:00:00. Nur bei Wechsel des Dokumenttitels, damit manuelle Eingabe erhalten bleibt. */
  useEffect(() => {
    const pl = playlistRef.current;
    if (!playlistDocumentTitle || !pl?.length) {
      setOriginFrames(DEFAULT_TIMELINE_ORIGIN_FRAMES);
      return;
    }
    setOriginFrames(suggestedTimelineOriginFromFirstRecIn(pl[0]!.recInFrames, DEFAULT_FPS));
  }, [playlistDocumentTitle]);

  const computeVideoSlotMaxWidth = useCallback(() => {
    const row = rowRef.current;
    if (!row) return VIDEO_SLOT_MIN_PX * 4;
    const w = row.getBoundingClientRect().width;
    const reserved = VIDEO_ROW_RESIZER_TOTAL_PX + TIMELINE_MIN_PX;
    return Math.max(VIDEO_SLOT_MIN_PX, w - reserved);
  }, []);

  useLayoutEffect(() => {
    const onResize = () => {
      setVideoSlotWidthPx((prev) => clamp(prev, VIDEO_SLOT_MIN_PX, computeVideoSlotMaxWidth()));
    };
    window.addEventListener("resize", onResize);
    onResize();
    return () => window.removeEventListener("resize", onResize);
  }, [computeVideoSlotMaxWidth]);

  const onVideoRowResizePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (kind !== "video" || !objectUrl) return;
      e.preventDefault();
      videoResizeRef.current = {
        startX: e.clientX,
        startWidth: videoSlotWidthPx,
      };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [kind, objectUrl, videoSlotWidthPx]
  );

  const onVideoRowResizePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const r = videoResizeRef.current;
      if (!r) return;
      const maxW = computeVideoSlotMaxWidth();
      const delta = e.clientX - r.startX;
      const next = clamp(r.startWidth + delta, VIDEO_SLOT_MIN_PX, maxW);
      setVideoSlotWidthPx(next);
    },
    [computeVideoSlotMaxWidth]
  );

  const onVideoRowResizePointerUp = useCallback((e: React.PointerEvent) => {
    if (!videoResizeRef.current) return;
    videoResizeRef.current = null;
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* */
    }
  }, []);

  useEffect(() => {
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [objectUrl]);

  useLayoutEffect(() => {
    if (kind !== "video" || !objectUrl) {
      setMediaDurationSec(null);
      return;
    }
    const v = videoRef.current;
    if (!v) return;
    const upd = () => {
      const d = v.duration;
      setMediaDurationSec(Number.isFinite(d) && d > 0 ? d : null);
    };
    v.addEventListener("loadedmetadata", upd);
    v.addEventListener("durationchange", upd);
    upd();
    return () => {
      v.removeEventListener("loadedmetadata", upd);
      v.removeEventListener("durationchange", upd);
    };
  }, [kind, objectUrl]);

  const updatePlayhead = useCallback(() => {
    const v = videoRef.current;
    if (!v || kind !== "video" || !objectUrl) {
      return;
    }
    const t = v.currentTime;
    const fps = DEFAULT_FPS;
    const matched = findPlaylistRowForFileName(playlist, label);
    let fr: number;
    if (matched) {
      fr = matched.recInFrames + Math.floor(t * fps);
    } else {
      fr = originFrames + Math.floor(t * fps);
    }
    setPlayheadFrames(fr);
  }, [kind, objectUrl, playlist, label, originFrames]);

  useEffect(() => {
    if (kind !== "video" || !objectUrl) {
      return;
    }
    const v = videoRef.current;
    if (!v) return;

    let raf = 0;
    const loop = () => {
      updatePlayhead();
      if (!v.paused && !v.ended) {
        raf = requestAnimationFrame(loop);
      }
    };

    const onPlay = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(loop);
    };

    const onPause = () => {
      cancelAnimationFrame(raf);
      updatePlayhead();
    };

    const onEnded = () => {
      cancelAnimationFrame(raf);
      updatePlayhead();
    };

    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("ended", onEnded);
    v.addEventListener("timeupdate", updatePlayhead);
    v.addEventListener("seeked", updatePlayhead);
    updatePlayhead();

    return () => {
      cancelAnimationFrame(raf);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("ended", onEnded);
      v.removeEventListener("timeupdate", updatePlayhead);
      v.removeEventListener("seeked", updatePlayhead);
    };
  }, [kind, objectUrl, updatePlayhead]);

  useEffect(() => {
    updatePlayhead();
  }, [label, originFrames, playlist, updatePlayhead]);

  const applyMediaFile = useCallback((f: File) => {
    if (!isAllowedMediaFile(f)) return;
    setObjectUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(f);
    });
    setLabel(f.name);
    setKind(guessKind(f));
  }, []);

  const onFile = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      e.target.value = "";
      if (!f) return;
      applyMediaFile(f);
    },
    [applyMediaFile]
  );

  const onVideoSlotDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.types.includes("Files")) {
      e.dataTransfer.dropEffect = "copy";
      setVideoSlotDragOver(true);
    }
  }, []);

  const onVideoSlotDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    const next = e.relatedTarget as Node | null;
    if (next && e.currentTarget instanceof Element && e.currentTarget.contains(next)) return;
    setVideoSlotDragOver(false);
  }, []);

  const onVideoSlotDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setVideoSlotDragOver(false);
      const f = e.dataTransfer.files?.[0];
      if (!f) return;
      applyMediaFile(f);
    },
    [applyMediaFile]
  );

  const clear = useCallback(() => {
    setObjectUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setLabel("");
    setKind(null);
    setPlayheadFrames(null);
    setMediaDurationSec(null);
  }, []);

  const seekProgramFrames = useCallback(
    (frames: number) => {
      const fps = DEFAULT_FPS;
      const frNorm = normalizeFramesToDay(frames, fps);
      const v = videoRef.current;
      if (!v || kind !== "video" || !objectUrl) {
        setPlayheadFrames(frNorm);
        return;
      }
      const matched = findPlaylistRowForFileName(playlist, label);
      let t: number;
      if (matched) {
        /** Gleiche 24h-Vorwärtslogik wie die Timeline (wichtig bei Nullpunkt kurz vor Mitternacht). */
        const deltaFrames = offsetFromOriginFrame(frames, matched.recInFrames, fps);
        t = deltaFrames / fps;
      } else {
        const deltaFrames = offsetFromOriginFrame(frames, Math.max(0, originFrames), fps);
        t = deltaFrames / fps;
      }
      if (!Number.isFinite(t)) return;
      const dur = v.duration;
      if (Number.isFinite(dur) && dur > 0) {
        t = clamp(t, 0, dur);
      } else {
        t = Math.max(0, t);
      }
      /** Sofortige Playhead-Anzeige (auch während Abspielen, bevor timeupdate nachzieht). */
      if (matched) {
        setPlayheadFrames(matched.recInFrames + Math.floor(t * fps));
      } else {
        setPlayheadFrames(originFrames + Math.floor(t * fps));
      }
      v.currentTime = t;
    },
    [kind, objectUrl, playlist, label, originFrames]
  );

  useEffect(() => {
    if (!seekToProgramFramesRequest) return;
    seekProgramFrames(seekToProgramFramesRequest.programFrames);
  }, [seekToProgramFramesRequest?.requestId, seekProgramFrames]);

  useEffect(() => {
    if (kind !== "video" || !objectUrl) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== " " && e.code !== "Space") return;
      if (shouldIgnoreGlobalSpaceShortcut(e.target)) return;
      const v = videoRef.current;
      if (!v) return;
      e.preventDefault();
      if (v.paused || v.ended) {
        void v.play();
      } else {
        v.pause();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [kind, objectUrl]);

  return (
    <div className="media-player-dock" aria-label="Mediaplayer">
      <div className="media-player-dock__head">
        <label className="media-player-dock__file">
          <input
            type="file"
            accept="audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/wave,video/mp4,.mp3,.wav,.mp4"
            onChange={onFile}
          />
          <span className="btn-modal media-player-dock__btn media-player-dock__btn--file">
            Datei wählen …
          </span>
        </label>
        <button
          type="button"
          className="btn-modal media-player-dock__btn media-player-dock__btn--reset"
          disabled={!objectUrl}
          title={!objectUrl ? "Keine Mediendatei geladen" : undefined}
          onClick={clear}
        >
          Zurücksetzen
        </button>
      </div>
      <div
        className={`media-player-dock__row${kind === "video" && objectUrl ? " media-player-dock__row--video-resize" : ""}`}
        ref={rowRef}
      >
        <div className="media-player-dock__video-block">
          <div
            className="media-player-dock__video-column"
            style={{ width: videoSlotWidthPx, maxWidth: "100%" }}
          >
            <div
              className={[
                "media-player-dock__video-slot",
                videoSlotDragOver ? "media-player-dock__video-slot--drag-over" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              aria-label="Video- oder Wellenform-Audio (WAV) im selben Anzeigefeld"
              onDragEnter={(e: DragEvent) => {
                e.preventDefault();
                if (e.dataTransfer.types.includes("Files")) setVideoSlotDragOver(true);
              }}
              onDragOver={onVideoSlotDragOver}
              onDragLeave={onVideoSlotDragLeave}
              onDrop={onVideoSlotDrop}
            >
              <div
                className={
                  kind === "video" && objectUrl
                    ? "media-player-dock__video-inner"
                    : "media-player-dock__video-inner media-player-dock__video-inner--placeholder"
                }
              >
                {kind === "video" && objectUrl ? (
                  <video
                    ref={videoRef}
                    className="media-player-dock__video"
                    src={objectUrl}
                    controls
                    playsInline
                    preload="metadata"
                  />
                ) : (
                  <div className="media-player-dock__video-placeholder-stack">
                    <img
                      className="media-player-dock__video-placeholder-logo"
                      src="/Musiclist-App-logo.png"
                      alt=""
                      draggable={false}
                    />
                    <p className="media-player-dock__video-placeholder-hint">
                      Drag and Drop Media here
                    </p>
                  </div>
                )}
              </div>
            </div>
            {label && objectUrl ? (
              <p className="media-player-dock__media-label mono-cell" title={label}>
                {label}
              </p>
            ) : null}
          </div>
          {kind === "video" && objectUrl ? (
            <div
              className="media-player-dock__video-timeline-resizer"
              role="separator"
              aria-orientation="vertical"
              aria-label="Breite Videofenster anpassen"
              title="Ziehen: Video vergrößern oder verkleinern"
              tabIndex={0}
              onPointerDown={onVideoRowResizePointerDown}
              onPointerMove={onVideoRowResizePointerMove}
              onPointerUp={onVideoRowResizePointerUp}
              onPointerCancel={onVideoRowResizePointerUp}
              onKeyDown={(e) => {
                if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
                e.preventDefault();
                const maxW = computeVideoSlotMaxWidth();
                const step = 8;
                setVideoSlotWidthPx((w) =>
                  clamp(e.key === "ArrowRight" ? w + step : w - step, VIDEO_SLOT_MIN_PX, maxW)
                );
              }}
            />
          ) : null}
        </div>
        <div className="media-player-dock__side">
          <div className="media-player-dock__audio-col">
            {kind === "audio" && objectUrl ? (
              <audio className="media-player-dock__audio" src={objectUrl} controls preload="metadata" />
            ) : null}
          </div>
          <PlaylistTimeline
            playlist={playlist}
            playlistDocumentTitle={playlistDocumentTitle}
            tagIncompleteByEntryId={tagIncompleteByEntryId}
            onClipSelectEntryId={onTimelineClipSelectEntryId}
            videoDurationSeconds={mediaDurationSec}
            originFrames={originFrames}
            onOriginFramesChange={setOriginFrames}
            playheadFrames={playheadFrames}
            seekEnabled={kind === "video" && !!objectUrl}
            onSeekProgramFrames={seekProgramFrames}
          />
        </div>
      </div>
    </div>
  );
}
