import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { PlaylistEntry } from "../edl/types";
import { basenamePath } from "../tracks/sanitizeFilename";
import {
  DEFAULT_FPS,
  framesToTimecode,
  normalizeFramesToDay,
  offsetFromOriginFrame,
  timecodeInputToFrames,
} from "../edl/timecode";

/** Standard-Start-TC der Timeline: 00:00:00:00 bei 25 fps. */
export const DEFAULT_TIMELINE_ORIGIN_FRAMES = 0;

const ZOOM_MIN = 1;
const ZOOM_MAX = 24;
const ZOOM_STEP = 1.12;
const THUMB_MIN_PX = 8;
/** Breite des Schiebers in der Zoom-Leiste (Avid-ähnlich). */
const ZOOM_BAR_THUMB_PX = 6;
/** Feste Breite des linken Zoom-Bereichs in der Scroll-Leiste. */
const ZOOM_BAR_RAIL_PX = 112;

const LOG_ZOOM_MIN = Math.log(ZOOM_MIN);
const LOG_ZOOM_MAX = Math.log(ZOOM_MAX);

/** Position 0…1 auf der Zoom-Leiste (logarithmisch) aus aktuellem Zoom. */
function zoomToSliderT(z: number): number {
  const lz = Math.log(clamp(z, ZOOM_MIN, ZOOM_MAX));
  return clamp((lz - LOG_ZOOM_MIN) / (LOG_ZOOM_MAX - LOG_ZOOM_MIN), 0, 1);
}

/** Zoom aus Leistenposition 0…1 (logarithmisch). */
function zoomFromSliderT(t: number): number {
  const tt = clamp(t, 0, 1);
  const z = Math.exp(LOG_ZOOM_MIN + tt * (LOG_ZOOM_MAX - LOG_ZOOM_MIN));
  return clamp(Number(z.toFixed(4)), ZOOM_MIN, ZOOM_MAX);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Pfeil hoch/runter für Timeline-Zoom nicht abfangen, wenn Fokus in Eingaben oder Slidern liegt. */
function shouldIgnoreTimelineArrowZoom(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return true;
  const tag = el.tagName.toLowerCase();
  if (tag === "textarea" || tag === "select" || tag === "button" || tag === "a") return true;
  if (el.isContentEditable) return true;
  if (el.closest('[role="slider"]')) return true;
  if (tag === "input") {
    const t = ((el as HTMLInputElement).type || "").toLowerCase();
    return (
      t === "text" ||
      t === "search" ||
      t === "password" ||
      t === "email" ||
      t === "url" ||
      t === "tel" ||
      t === "number" ||
      t === "range" ||
      t === ""
    );
  }
  return false;
}

function clipLabel(row: PlaylistEntry): string {
  const linked = row.linkedTrackFileName?.trim();
  if (linked) return basenamePath(linked);
  return row.title.trim() || row.sourceKey.slice(0, 32);
}

/** Halboffene Intervalle [start, end): Überschneidung nur bei echter zeitlicher Überlappung (Anstoßen zählt nicht). */
function intervalsOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  if (aEnd <= aStart || bEnd <= bStart) return false;
  return aStart < bEnd && bStart < aEnd;
}

type TimelineSegment = {
  key: string;
  segStart: number;
  segEnd: number;
  label: string;
};

/**
 * Primär Spur 1; bei Überlappung Folgeclip auf Spur 2, bei erneuter Überlappung auf Spur 3.
 * Sortierung nach Programm-Start, dann Ende (stabil).
 */
function assignLanesByOverlap(segments: TimelineSegment[]): Array<TimelineSegment & { lane: 0 | 1 | 2 }> {
  const sorted = [...segments].sort((a, b) =>
    a.segStart !== b.segStart
      ? a.segStart - b.segStart
      : a.segEnd !== b.segEnd
        ? a.segEnd - b.segEnd
        : a.key.localeCompare(b.key)
  );
  const occupied: Array<Array<{ segStart: number; segEnd: number }>> = [[], [], []];
  const out: Array<TimelineSegment & { lane: 0 | 1 | 2 }> = [];

  for (const seg of sorted) {
    let placed = false;
    for (let L = 0; L < 3; L++) {
      const lane = L as 0 | 1 | 2;
      const ok = occupied[lane]!.every(
        (o) => !intervalsOverlap(seg.segStart, seg.segEnd, o.segStart, o.segEnd)
      );
      if (ok) {
        occupied[lane]!.push({ segStart: seg.segStart, segEnd: seg.segEnd });
        out.push({ ...seg, lane });
        placed = true;
        break;
      }
    }
    if (!placed) {
      occupied[2]!.push({ segStart: seg.segStart, segEnd: seg.segEnd });
      out.push({ ...seg, lane: 2 });
    }
  }

  return out;
}

type PendingZoomAdjust = {
  oldIw: number;
  oldSl: number;
  playheadFrames: number | null;
  /** Abspielposition relativ zum Nullpunkt [0, DAY), für Zoom-Korrektur */
  playheadOffsetFromOrigin: number | null;
  span: number;
};

type Props = {
  playlist: PlaylistEntry[] | null;
  /** In der Kopfzeile rechts: Name der geladenen Playlist / EDL-Datei. */
  playlistDocumentTitle?: string | null;
  /** Videolänge in Sekunden (für End-TC = Start-TC + Dauer bei 25 fps). */
  videoDurationSeconds?: number | null;
  fps?: number;
  /** Programm-Start-TC in Frames. Standard: 0 (= 00:00:00:00). */
  originFrames: number;
  onOriginFramesChange: (frames: number) => void;
  playheadFrames: number | null;
  /** Video geladen: Timeline per Klick/Ziehen steuern */
  seekEnabled?: boolean;
  onSeekProgramFrames?: (programFrames: number) => void;
};

export function PlaylistTimeline({
  playlist,
  playlistDocumentTitle = null,
  videoDurationSeconds = null,
  fps = DEFAULT_FPS,
  originFrames,
  onOriginFramesChange,
  playheadFrames,
  seekEnabled = false,
  onSeekProgramFrames,
}: Props) {
  const [zoom, setZoom] = useState(1);
  const [originDraft, setOriginDraft] = useState(() =>
    framesToTimecode(Math.max(0, originFrames), fps)
  );
  const timelineRootRef = useRef<HTMLDivElement>(null);
  /** Nur vertikal (Scrollbar sichtbar). */
  const scrollOuterRef = useRef<HTMLDivElement>(null);
  /** Nur horizontal — ohne native horizontale Scrollbar (nur untere Leiste). */
  const scrollRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const zoomBarTrackRef = useRef<HTMLDivElement>(null);
  const [zoomBarW, setZoomBarW] = useState(0);
  const pendingZoomAdjustRef = useRef<PendingZoomAdjust | null>(null);
  /** Nächstes Zoomen: Playhead in die Mitte des sichtbaren Bereichs (danach klassische Zoom-Verfolgung). */
  const firstZoomCenterPendingRef = useRef(true);
  const [scrollMetrics, setScrollMetrics] = useState({
    sl: 0,
    sw: 0,
    cw: 0,
    tw: 0,
  });
  const playheadFramesRef = useRef<number>(0);
  const rangeRef = useRef({ originFrames: 0, span: 1, fps: DEFAULT_FPS });

  useEffect(() => {
    setOriginDraft(framesToTimecode(Math.max(0, originFrames), fps));
  }, [originFrames, fps]);

  const commitOriginDraft = useCallback(() => {
    const raw = originDraft.trim();
    try {
      const fr = timecodeInputToFrames(raw, fps);
      onOriginFramesChange(Math.max(0, fr));
      setZoom(1);
    } catch {
      setOriginDraft(framesToTimecode(Math.max(0, originFrames), fps));
    }
  }, [originDraft, fps, originFrames, onOriginFramesChange]);

  const refreshScrollMetrics = useCallback(() => {
    const se = scrollRef.current;
    const ie = innerRef.current;
    const tr = trackRef.current;
    if (!se || !ie) return;
    const tw = tr ? tr.getBoundingClientRect().width : 0;
    setScrollMetrics({
      sl: se.scrollLeft,
      sw: ie.scrollWidth,
      cw: se.clientWidth,
      tw,
    });
  }, []);

  /** Ohne Video: linke Position = Start-TC; sonst Programmposition aus dem Player. */
  const effectivePlayheadFrames = useMemo(() => {
    if (playheadFrames != null) {
      return normalizeFramesToDay(playheadFrames, fps);
    }
    return normalizeFramesToDay(Math.max(0, originFrames), fps);
  }, [playheadFrames, originFrames, fps]);

  const {
    span,
    clips,
    rulerTicks,
    playheadLeftPct,
    playheadOffsetFromOrigin,
  } = useMemo(() => {
    const rows = playlist?.length ? playlist : [];
    const o = Math.max(0, originFrames) | 0;
    const normOriginVal = normalizeFramesToDay(o, fps);

    let maxExtent = fps * 30;
    const rawSegments: TimelineSegment[] = [];

    for (const row of rows) {
      if (row.recOutFrames <= row.recInFrames) continue;
      const dur = row.recOutFrames - row.recInFrames;
      const relIn = offsetFromOriginFrame(row.recInFrames, o, fps);
      const segStart = relIn;
      const segEnd = segStart + dur;
      maxExtent = Math.max(maxExtent, segEnd + fps * 2);
      rawSegments.push({
        key: row.id,
        segStart,
        segEnd,
        label: clipLabel(row),
      });
    }

    const spanVal = Math.max(1, maxExtent);

    const assigned = assignLanesByOverlap(rawSegments);
    const clipItems: Array<{
      key: string;
      lane: 0 | 1 | 2;
      leftPct: number;
      widthPct: number;
      label: string;
    }> = assigned.map((s) => ({
      key: s.key,
      lane: s.lane,
      leftPct: (s.segStart / spanVal) * 100,
      widthPct: ((s.segEnd - s.segStart) / spanVal) * 100,
      label: s.label,
    }));

    const tickCount = Math.min(12, Math.max(4, Math.ceil(spanVal / (fps * 60))));
    const tickStep = spanVal / tickCount;
    const rulerTicks = Array.from({ length: tickCount + 1 }, (_, i) => {
      const off = Math.round(i * tickStep);
      const fr = normalizeFramesToDay(normOriginVal + off, fps);
      return {
        fr,
        leftPct: (off / spanVal) * 100,
        label: framesToTimecode(fr, fps),
      };
    });

    const phOff = offsetFromOriginFrame(effectivePlayheadFrames, o, fps);
    const playheadLeftPctVal = clamp((phOff / spanVal) * 100, 0, 100);

    return {
      span: spanVal,
      clips: clipItems,
      rulerTicks,
      playheadLeftPct: playheadLeftPctVal,
      playheadOffsetFromOrigin: phOff,
    };
  }, [playlist, fps, originFrames, effectivePlayheadFrames]);

  const playheadTcDisplay = useMemo(() => {
    return framesToTimecode(effectivePlayheadFrames, fps);
  }, [effectivePlayheadFrames, fps]);

  const endTcDisplay = useMemo(() => {
    if (
      videoDurationSeconds == null ||
      !Number.isFinite(videoDurationSeconds) ||
      videoDurationSeconds <= 0
    ) {
      return "—";
    }
    const o = Math.max(0, originFrames) | 0;
    const durationFrames = Math.floor(videoDurationSeconds * fps);
    const endFr = normalizeFramesToDay(o + durationFrames, fps);
    return framesToTimecode(endFr, fps);
  }, [originFrames, videoDurationSeconds, fps]);

  const ensurePlayheadVisible = useCallback(() => {
    const se = scrollRef.current;
    const ie = innerRef.current;
    if (!se || !ie) return;
    if (span <= 0) return;
    const iw = ie.scrollWidth;
    const cw = se.clientWidth;
    const maxSl = Math.max(0, iw - cw);
    if (maxSl <= 0) return;
    const frac = clamp(playheadOffsetFromOrigin / span, 0, 1);
    const playheadPx = frac * iw;
    const sl = se.scrollLeft;
    const pad = Math.max(12, cw * 0.06);
    if (playheadPx < sl + pad) {
      se.scrollLeft = Math.max(0, playheadPx - pad);
    } else if (playheadPx > sl + cw - pad) {
      se.scrollLeft = Math.min(maxSl, playheadPx - cw + pad);
    }
  }, [playheadOffsetFromOrigin, span]);

  playheadFramesRef.current = effectivePlayheadFrames;
  rangeRef.current = { originFrames: Math.max(0, originFrames), span, fps };

  const queueZoomAdjust = useCallback(() => {
    const se = scrollRef.current;
    const ie = innerRef.current;
    if (!se || !ie) return;
    const o = Math.max(0, originFrames);
    const off = offsetFromOriginFrame(effectivePlayheadFrames, o, fps);
    pendingZoomAdjustRef.current = {
      oldIw: ie.scrollWidth,
      oldSl: se.scrollLeft,
      playheadFrames: effectivePlayheadFrames,
      playheadOffsetFromOrigin: off,
      span,
    };
  }, [effectivePlayheadFrames, originFrames, fps, span]);

  const resetZoom = useCallback(() => {
    firstZoomCenterPendingRef.current = true;
    queueZoomAdjust();
    setZoom(1);
  }, [queueZoomAdjust]);

  const onTimelinePointerDownCapture = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const el = e.target as HTMLElement;
    if (el.closest("input, textarea, button, select, a")) return;
    if (el.closest('[role="slider"]')) return;
    e.currentTarget.focus();
  }, []);

  useEffect(() => {
    const root = timelineRootRef.current;
    if (!root) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      if (!root.contains(document.activeElement)) return;
      if (shouldIgnoreTimelineArrowZoom(document.activeElement)) return;
      e.preventDefault();
      queueZoomAdjust();
      const factor = e.key === "ArrowUp" ? ZOOM_STEP : 1 / ZOOM_STEP;
      setZoom((z) => clamp(Number((z * factor).toFixed(4)), ZOOM_MIN, ZOOM_MAX));
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [queueZoomAdjust]);

  useLayoutEffect(() => {
    const se = scrollRef.current;
    const ie = innerRef.current;
    if (!se || !ie) return;
    const p = pendingZoomAdjustRef.current;
    pendingZoomAdjustRef.current = null;
    if (!p) return;

    const newIw = ie.scrollWidth;
    const clientW = se.clientWidth;
    const maxSl = Math.max(0, newIw - clientW);

    if (p.playheadOffsetFromOrigin != null && p.span > 0) {
      const frac = p.playheadOffsetFromOrigin / p.span;
      if (firstZoomCenterPendingRef.current) {
        firstZoomCenterPendingRef.current = false;
        const playheadPx = frac * newIw;
        se.scrollLeft = clamp(playheadPx - clientW / 2, 0, maxSl);
      } else {
        const nextSl = p.oldSl + frac * (newIw - p.oldIw);
        se.scrollLeft = clamp(nextSl, 0, maxSl);
      }
    } else {
      const ratio = p.oldIw > 0 ? newIw / p.oldIw : 1;
      se.scrollLeft = clamp(p.oldSl * ratio, 0, maxSl);
    }
    requestAnimationFrame(() => refreshScrollMetrics());
  }, [zoom, refreshScrollMetrics]);

  useLayoutEffect(() => {
    firstZoomCenterPendingRef.current = true;
    const se = scrollRef.current;
    if (se) se.scrollLeft = 0;
  }, [originFrames]);

  useEffect(() => {
    firstZoomCenterPendingRef.current = true;
  }, [playlistDocumentTitle]);

  useLayoutEffect(() => {
    ensurePlayheadVisible();
    refreshScrollMetrics();
  }, [playheadOffsetFromOrigin, span, zoom, originFrames, ensurePlayheadVisible, refreshScrollMetrics]);

  useEffect(() => {
    const outer = scrollOuterRef.current;
    const se = scrollRef.current;
    const ie = innerRef.current;
    const tr = trackRef.current;
    if (!se) return;
    const onScroll = () => refreshScrollMetrics();
    se.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(() => refreshScrollMetrics());
    if (outer) ro.observe(outer);
    ro.observe(se);
    if (ie) ro.observe(ie);
    if (tr) ro.observe(tr);
    refreshScrollMetrics();
    return () => {
      se.removeEventListener("scroll", onScroll);
      ro.disconnect();
    };
  }, [refreshScrollMetrics, zoom, span]);

  useEffect(() => {
    const el = zoomBarTrackRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setZoomBarW(el.getBoundingClientRect().width);
    });
    ro.observe(el);
    setZoomBarW(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const outer = scrollOuterRef.current;
    const se = scrollRef.current;
    if (!se) return;
    const ro = new ResizeObserver(() => {
      requestAnimationFrame(() => ensurePlayheadVisible());
    });
    ro.observe(se);
    if (outer) ro.observe(outer);
    return () => ro.disconnect();
  }, [playheadOffsetFromOrigin, ensurePlayheadVisible]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const ie = innerRef.current;
      if (!ie) return;
      const { originFrames: o, span: sp, fps: fp } = rangeRef.current;
      const ph = playheadFramesRef.current;
      const off = offsetFromOriginFrame(ph, o, fp);
      pendingZoomAdjustRef.current = {
        oldIw: ie.scrollWidth,
        oldSl: el.scrollLeft,
        playheadFrames: ph,
        playheadOffsetFromOrigin: off,
        span: sp,
      };
      const dir = e.deltaY < 0 ? 1 : -1;
      const factor = dir > 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      setZoom((z) => clamp(Number((z * factor).toFixed(4)), ZOOM_MIN, ZOOM_MAX));
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, []);

  const seekFromTimelineOffset = useCallback(
    (offsetFrames: number) => {
      if (!onSeekProgramFrames) return;
      const o = Math.max(0, originFrames);
      const normO = normalizeFramesToDay(o, fps);
      onSeekProgramFrames(normalizeFramesToDay(normO + Math.round(offsetFrames), fps));
    },
    [onSeekProgramFrames, originFrames, fps]
  );

  const setZoomFromClientX = useCallback(
    (clientX: number, trackEl: HTMLElement) => {
      const rect = trackEl.getBoundingClientRect();
      const x = clamp(clientX - rect.left, 0, rect.width);
      const t = rect.width > 0 ? x / rect.width : 0;
      queueZoomAdjust();
      setZoom(zoomFromSliderT(t));
    },
    [queueZoomAdjust]
  );

  const onZoomTrackPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if ((e.target as HTMLElement).closest(".playlist-timeline__zoom-bar-thumb")) return;
      const tr = zoomBarTrackRef.current;
      if (!tr) return;
      e.preventDefault();
      setZoomFromClientX(e.clientX, tr);
      const ptr = e.pointerId;
      tr.setPointerCapture(ptr);
      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== ptr) return;
        setZoomFromClientX(ev.clientX, tr);
      };
      const onUp = (ev: PointerEvent) => {
        if (ev.pointerId !== ptr) return;
        try {
          tr.releasePointerCapture(ptr);
        } catch {
          /* ignore */
        }
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [setZoomFromClientX]
  );

  const onZoomThumbPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.stopPropagation();
      e.preventDefault();
      const tr = zoomBarTrackRef.current;
      if (!tr) return;
      setZoomFromClientX(e.clientX, tr);
      const ptr = e.pointerId;
      const el = e.currentTarget as HTMLElement;
      el.setPointerCapture(ptr);
      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== ptr) return;
        setZoomFromClientX(ev.clientX, tr);
      };
      const onUp = (ev: PointerEvent) => {
        if (ev.pointerId !== ptr) return;
        try {
          el.releasePointerCapture(ptr);
        } catch {
          /* ignore */
        }
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [setZoomFromClientX]
  );

  const onTrackPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if ((e.target as HTMLElement).closest(".playlist-timeline__hscroll-thumb")) return;
      const se = scrollRef.current;
      const track = trackRef.current;
      if (!se || !track) return;
      const rect = track.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const ratio = clamp(x / rect.width, 0, 1);
      const ie = innerRef.current;
      if (!ie) return;
      const maxSl = Math.max(0, ie.scrollWidth - se.clientWidth);
      se.scrollLeft = ratio * maxSl;
      refreshScrollMetrics();
    },
    [refreshScrollMetrics]
  );

  const onThumbPointerDown = useCallback((e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const se = scrollRef.current;
    const track = trackRef.current;
    const ie = innerRef.current;
    if (!se || !track || !ie) return;
    const startX = e.clientX;
    const startSl = se.scrollLeft;
    const sw = ie.scrollWidth;
    const cw = se.clientWidth;
    const maxSl = Math.max(0, sw - cw);
    const trackW = track.getBoundingClientRect().width;
    const thumbW =
      maxSl <= 0 ? trackW : Math.max(THUMB_MIN_PX, (cw / sw) * trackW);
    const slidable = Math.max(1, trackW - thumbW);
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const deltaSl = (dx / slidable) * maxSl;
      se.scrollLeft = clamp(startSl + deltaSl, 0, maxSl);
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      try {
        el.releasePointerCapture(ev.pointerId);
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }, []);

  const { sl, sw, cw, tw } = scrollMetrics;
  const maxScroll = Math.max(0, sw - cw);
  const thumbWpx =
    maxScroll <= 0 || tw <= 0 ? tw : Math.max(THUMB_MIN_PX, (cw / sw) * tw);
  const thumbLeftPx =
    maxScroll <= 0 || tw <= 0 ? 0 : (sl / maxScroll) * (tw - thumbWpx);

  const zoomThumbLeftPx = useMemo(() => {
    const t = zoomToSliderT(zoom);
    const maxLeft = Math.max(0, zoomBarW - ZOOM_BAR_THUMB_PX);
    return t * maxLeft;
  }, [zoom, zoomBarW]);

  const laneLabels = ["A1", "A2", "A3"];
  const scrubRangeMax = Math.max(1, Math.floor(span));
  const scrubRangeValue = clamp(
    Math.round(playheadOffsetFromOrigin ?? 0),
    0,
    scrubRangeMax
  );

  return (
    <div
      ref={timelineRootRef}
      tabIndex={0}
      className="playlist-timeline"
      aria-label="Playlist-Timeline"
      title="Klick in die Timeline: Fokus · Pfeil ↑/↓ oder Strg+Mausrad: Zoom (erstes Zoomen zentriert den Standanzeiger)"
      onPointerDownCapture={onTimelinePointerDownCapture}
    >
      <div className="playlist-timeline__toolbar">
        <div className="playlist-timeline__toolbar-left">
          <span className="playlist-timeline__toolbar-label">Start-TC</span>
          <input
            type="text"
            className="playlist-timeline__origin-input mono-cell"
            value={originDraft}
            onChange={(e) => setOriginDraft(e.target.value)}
            onBlur={commitOriginDraft}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                (e.currentTarget as HTMLInputElement).blur();
              }
            }}
            spellCheck={false}
            placeholder="00:00:00:00"
            title="Start-TC: HH:MM:SS:FF oder nur Ziffern (z. B. 01000000 → 01:00:00:00)"
            aria-label="Start-TC als Timecode oder acht Ziffern ohne Doppelpunkt"
          />
          <span className="playlist-timeline__toolbar-sep" aria-hidden>
            |
          </span>
          <span
            className="playlist-timeline__tc-live mono-cell"
            title="Aktuelle Programmposition (Standzeiger)"
            aria-live="polite"
          >
            {playheadTcDisplay}
          </span>
          <span className="playlist-timeline__toolbar-sep" aria-hidden>
            |
          </span>
          <span
            className="playlist-timeline__tc-end mono-cell"
            title="Ende: Start-TC + Videolänge (25 fps), nicht editierbar"
          >
            {endTcDisplay}
          </span>
        </div>
        {playlistDocumentTitle ? (
          <div
            className="playlist-timeline__playlist-title mono-cell"
            title={playlistDocumentTitle}
          >
            {playlistDocumentTitle}
          </div>
        ) : null}
      </div>
      <div className="playlist-timeline__body">
        <div className="playlist-timeline__lane-labels" aria-hidden>
          <div className="playlist-timeline__lane-label-spacer" />
          {laneLabels.map((lb) => (
            <div key={lb} className="playlist-timeline__lane-label">
              {lb}
            </div>
          ))}
          <div className="playlist-timeline__lane-labels-rail-spacer" aria-hidden />
        </div>
        <div className="playlist-timeline__main-col">
          <div className="playlist-timeline__scroll-viewport" ref={scrollOuterRef}>
            <div className="playlist-timeline__scroll-h" ref={scrollRef}>
            <div
              ref={innerRef}
              className="playlist-timeline__scroll-inner"
              style={{ width: `${zoom * 100}%` }}
            >
            <div className="playlist-timeline__ruler">
              {rulerTicks.map((tick, i) => (
                <span
                  key={`${tick.fr}-${i}`}
                  className="playlist-timeline__ruler-tick"
                  style={{ left: `${tick.leftPct}%` }}
                >
                  <span className="playlist-timeline__ruler-line" />
                  <span className="playlist-timeline__ruler-label mono-cell">{tick.label}</span>
                </span>
              ))}
            </div>
            <div className="playlist-timeline__lanes">
              {[0, 1, 2].map((lane) => (
                <div key={lane} className="playlist-timeline__lane">
                  <div className="playlist-timeline__lane-grid" />
                  {clips
                    .filter((c) => c.lane === lane)
                    .map((c) => (
                      <div
                        key={c.key}
                        className="playlist-timeline__clip"
                        style={{ left: `${c.leftPct}%`, width: `${c.widthPct}%` }}
                        title={c.label}
                      >
                        <span className="playlist-timeline__clip-label mono-cell">{c.label}</span>
                      </div>
                    ))}
                </div>
              ))}
            </div>
            {seekEnabled && onSeekProgramFrames ? (
              <input
                type="range"
                className="playlist-timeline__scrub-range"
                min={0}
                max={scrubRangeMax}
                step={1}
                value={scrubRangeValue}
                aria-label="Abspielposition in der Timeline"
                onChange={(e) =>
                  seekFromTimelineOffset(Number(e.currentTarget.value))
                }
                onInput={(e) =>
                  seekFromTimelineOffset(Number(e.currentTarget.value))
                }
                onKeyDown={(e) => {
                  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
                  e.preventDefault();
                  const step = Math.max(1, Math.floor(span / 200));
                  const baseOff = offsetFromOriginFrame(
                    effectivePlayheadFrames,
                    Math.max(0, originFrames),
                    fps
                  );
                  const nextOff = clamp(
                    e.key === "ArrowLeft" ? baseOff - step : baseOff + step,
                    0,
                    span
                  );
                  seekFromTimelineOffset(nextOff);
                }}
              />
            ) : null}
            <div
              className="playlist-timeline__playhead"
              style={{ left: `${playheadLeftPct}%` }}
              aria-hidden
            />
          </div>
            </div>
          </div>
          <div
            className="playlist-timeline__hscroll-rail"
            role="group"
            aria-label="Timeline-Zoom und Scrollposition"
          >
            <div
              className="playlist-timeline__zoom-bar"
              style={{ flex: `0 0 ${ZOOM_BAR_RAIL_PX}px`, width: ZOOM_BAR_RAIL_PX }}
            >
              <div
                ref={zoomBarTrackRef}
                className="playlist-timeline__zoom-bar-track"
                role="slider"
                aria-label="Timeline-Zoom"
                aria-valuemin={ZOOM_MIN}
                aria-valuemax={ZOOM_MAX}
                aria-valuenow={zoom}
                title="Zoom: ziehen oder klicken · Doppelklick: 100 %"
                onPointerDown={onZoomTrackPointerDown}
                onDoubleClick={(e) => {
                  e.preventDefault();
                  resetZoom();
                }}
              >
                <div
                  className="playlist-timeline__zoom-bar-thumb"
                  style={{
                    width: ZOOM_BAR_THUMB_PX,
                    left: `${zoomThumbLeftPx}px`,
                  }}
                  onPointerDown={onZoomThumbPointerDown}
                  aria-hidden
                />
              </div>
            </div>
            <div
              ref={trackRef}
              className="playlist-timeline__hscroll-track"
              onPointerDown={onTrackPointerDown}
              title="Klick: Position · Schieber: scrollen"
            >
              <div
                className="playlist-timeline__hscroll-thumb"
                style={{
                  width: maxScroll <= 0 ? "100%" : `${thumbWpx}px`,
                  left: `${thumbLeftPx}px`,
                }}
                onPointerDown={onThumbPointerDown}
                title="Ziehen: horizontal scrollen"
              />
            </div>
          </div>
        </div>
      </div>
      {!playlist?.length ? (
        <p className="playlist-timeline__empty">Keine Playlist geladen — Timeline zeigt Programm-TC nach EDL-Import.</p>
      ) : null}
    </div>
  );
}
