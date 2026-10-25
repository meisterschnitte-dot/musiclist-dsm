import {
  useEffect,
  useImperativeHandle,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type Ref,
} from "react";
import { getUsersApiToken } from "../api/authToken";

export type PlayerWaveformHandle = {
  toggle: () => void;
  pause: () => void;
};

type Props = {
  src: string;
  trackId: number;
  waveformRef?: Ref<PlayerWaveformHandle | null>;
  onEnded?: () => void;
  onState?: (state: { playing: boolean; current: number; duration: number }) => void;
  onError?: (message: string) => void;
};

const PEAK_BARS = 1400;
const peakCache = new Map<number, Float32Array>();

let sharedCtx: AudioContext | null = null;

export function resumePlayerAudio(): void {
  const ctx = getAudioContext();
  if (ctx.state === "suspended") void ctx.resume();
}

function getAudioContext(): AudioContext {
  if (!sharedCtx || sharedCtx.state === "closed") {
    sharedCtx = new AudioContext();
  }
  return sharedCtx;
}

function mixPeaks(buffer: AudioBuffer, bars: number): Float32Array {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  const length = buffer.length;
  const out = new Float32Array(bars);
  const block = length / bars;
  for (let i = 0; i < bars; i += 1) {
    const start = Math.floor(i * block);
    const end = Math.min(length, Math.floor((i + 1) * block));
    let peak = 0;
    for (let j = start; j < end; j += 1) {
      let v = 0;
      for (const ch of channels) {
        const s = Math.abs(ch[j] ?? 0);
        if (s > v) v = s;
      }
      if (v > peak) peak = v;
    }
    out[i] = peak;
  }
  return out;
}

function cssColor(el: HTMLElement, name: string, fallback: string): string {
  const v = getComputedStyle(el).getPropertyValue(name).trim();
  return v || fallback;
}

export function PlayerWaveform({ src, trackId, waveformRef, onEnded, onState, onError }: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const peaksRef = useRef<Float32Array | null>(peakCache.get(trackId) ?? null);
  const bufferRef = useRef<AudioBuffer | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const playingRef = useRef(false);
  const offsetRef = useRef(0);
  const startedAtRef = useRef(0);
  const durationRef = useRef(0);
  const draggingRef = useRef(false);
  const previewTimeRef = useRef<number | null>(null);
  const endedRef = useRef(onEnded);
  const stateRef = useRef(onState);
  const errorRef = useRef(onError);
  const lastUiState = useRef({ playing: false, current: -1, duration: 0 });
  endedRef.current = onEnded;
  stateRef.current = onState;
  errorRef.current = onError;

  const stopSource = () => {
    const srcNode = sourceRef.current;
    sourceRef.current = null;
    if (!srcNode) return;
    srcNode.onended = null;
    try {
      srcNode.stop();
    } catch {
      /* already stopped */
    }
    try {
      srcNode.disconnect();
    } catch {
      /* ignore */
    }
  };

  const currentTime = (): number => {
    const preview = previewTimeRef.current;
    if (preview != null) return preview;
    const dur = durationRef.current;
    if (!playingRef.current || !bufferRef.current) return Math.min(dur, offsetRef.current);
    const ctx = getAudioContext();
    return Math.min(dur, offsetRef.current + Math.max(0, ctx.currentTime - startedAtRef.current));
  };

  const startFrom = (offset: number, resumeCtx: boolean) => {
    const buffer = bufferRef.current;
    if (!buffer) return;
    const ctx = getAudioContext();
    if (resumeCtx && ctx.state === "suspended") void ctx.resume();
    stopSource();
    const safe = Math.min(Math.max(0, offset), Math.max(0, buffer.duration - 0.01));
    const node = ctx.createBufferSource();
    node.buffer = buffer;
    node.connect(ctx.destination);
    node.onended = () => {
      if (sourceRef.current !== node) return;
      sourceRef.current = null;
      if (draggingRef.current) return;
      playingRef.current = false;
      offsetRef.current = durationRef.current;
      endedRef.current?.();
    };
    node.start(0, safe);
    sourceRef.current = node;
    offsetRef.current = safe;
    startedAtRef.current = ctx.currentTime;
    playingRef.current = true;
  };

  const pause = () => {
    offsetRef.current = currentTime();
    playingRef.current = false;
    stopSource();
  };

  const toggle = () => {
    if (playingRef.current) {
      pause();
      return;
    }
    startFrom(offsetRef.current >= durationRef.current ? 0 : offsetRef.current, true);
  };

  useImperativeHandle(waveformRef, () => ({ toggle, pause }));

  useEffect(() => {
    peaksRef.current = peakCache.get(trackId) ?? null;
    bufferRef.current = null;
    durationRef.current = 0;
    offsetRef.current = 0;
    playingRef.current = false;
    previewTimeRef.current = null;
    stopSource();
    let cancelled = false;
    const ac = new AbortController();
    void (async () => {
      try {
        const token = getUsersApiToken();
        const res = await fetch(src, {
          signal: ac.signal,
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        if (!res.ok) throw new Error("Datei nicht geladen.");
        const raw = await res.arrayBuffer();
        const ctx = getAudioContext();
        if (ctx.state === "suspended") await ctx.resume();
        const decoded = await ctx.decodeAudioData(raw.slice(0));
        if (cancelled) return;
        const peaks = mixPeaks(decoded, PEAK_BARS);
        peakCache.set(trackId, peaks);
        peaksRef.current = peaks;
        bufferRef.current = decoded;
        durationRef.current = decoded.duration;
        offsetRef.current = 0;
        startFrom(0, true);
      } catch (e) {
        if (cancelled || (e instanceof DOMException && e.name === "AbortError")) return;
        peaksRef.current = null;
        bufferRef.current = null;
        errorRef.current?.(e instanceof Error ? e.message : "Wiedergabe nicht gestartet.");
      }
    })();
    return () => {
      cancelled = true;
      ac.abort();
      stopSource();
      playingRef.current = false;
    };
  }, [src, trackId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    let raf = 0;

    const paint = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = Math.max(1, wrap.clientWidth);
      const h = Math.max(1, wrap.clientHeight);
      const pw = Math.round(w * dpr);
      const ph = Math.round(h * dpr);
      if (canvas.width !== pw || canvas.height !== ph) {
        canvas.width = pw;
        canvas.height = ph;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const mid = h / 2;
      const played = cssColor(wrap, "--app-accent-border", "#4a7ab0");
      const rest = cssColor(wrap, "--app-text-dim", "#a0aab8");
      const playhead = cssColor(wrap, "--app-focus", "#7eb8ff");
      const peaks = peaksRef.current;
      const dur = durationRef.current;
      const t = currentTime();
      const progress = dur > 0 ? t / dur : 0;
      const splitX = progress * w;

      if (!peaks || peaks.length === 0) {
        ctx.fillStyle = rest;
        ctx.fillRect(0, mid - 1, w, 2);
        ctx.fillStyle = played;
        ctx.fillRect(0, mid - 1, splitX, 2);
      } else {
        const gap = w > 640 ? 1 : 0.6;
        const barW = Math.max(1, w / peaks.length - gap);
        for (let i = 0; i < peaks.length; i += 1) {
          const x = (i / peaks.length) * w;
          const amp = Math.max(2, peaks[i] * (h * 0.92));
          ctx.fillStyle = x + barW / 2 <= splitX ? played : rest;
          ctx.fillRect(x, mid - amp / 2, barW, amp);
        }
      }

      if (progress > 0 && progress < 1) {
        ctx.fillStyle = playhead;
        ctx.fillRect(Math.round(splitX), 0, 1, h);
      }
      const rounded = Math.floor(t * 10) / 10;
      const prev = lastUiState.current;
      if (prev.playing !== playingRef.current || prev.current !== rounded || prev.duration !== dur) {
        lastUiState.current = { playing: playingRef.current, current: rounded, duration: dur };
        stateRef.current?.({ playing: playingRef.current, current: t, duration: dur });
      }
    };

    const tick = () => {
      paint();
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    const ro = new ResizeObserver(() => paint());
    ro.observe(wrap);
    return () => {
      window.cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [trackId]);

  const timeFromClientX = (clientX: number): number | null => {
    const wrap = wrapRef.current;
    const dur = durationRef.current;
    if (!wrap || !(dur > 0)) return null;
    const rect = wrap.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return ratio * dur;
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    draggingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    const next = timeFromClientX(e.clientX);
    if (next != null) previewTimeRef.current = next;
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    const next = timeFromClientX(e.clientX);
    if (next != null) previewTimeRef.current = next;
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const next = timeFromClientX(e.clientX);
    draggingRef.current = false;
    previewTimeRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    if (next == null) return;
    if (playingRef.current) startFrom(next, true);
    else offsetRef.current = next;
  };

  return (
    <div
      ref={wrapRef}
      className="player-waveform"
      role="slider"
      aria-label="Waveform, Position in der Aufnahme"
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={(e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        e.preventDefault();
        const step = e.key === "ArrowLeft" ? -5 : 5;
        const next = Math.min(durationRef.current, Math.max(0, currentTime() + step));
        if (playingRef.current) startFrom(next, true);
        else offsetRef.current = next;
      }}
    >
      <canvas ref={canvasRef} />
    </div>
  );
}
