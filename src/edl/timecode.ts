/** Non-drop: Standard 25 fps (deutsche Produktion). */
export const DEFAULT_FPS = 25;

export function timecodeToFrames(tc: string, fps: number = DEFAULT_FPS): number {
  const m = tc.trim().match(/^(\d{2}):(\d{2}):(\d{2}):(\d{2})$/);
  if (!m) throw new Error(`Ungültiger Timecode: ${tc}`);
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  const ss = Number(m[3]);
  const ff = Number(m[4]);
  return (((hh * 60 + mm) * 60 + ss) * fps + ff) | 0;
}

export function framesToTimecode(frames: number, fps: number = DEFAULT_FPS): string {
  if (frames < 0) frames = 0;
  const totalSeconds = Math.floor(frames / fps);
  const ff = frames % fps;
  const ss = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const mm = totalMinutes % 60;
  const hh = Math.floor(totalMinutes / 60);
  const pad = (n: number, w: number) => String(n).padStart(w, "0");
  return `${pad(hh, 2)}:${pad(mm, 2)}:${pad(ss, 2)}:${pad(ff, 2)}`;
}

/**
 * Dauer recIn→recOut in Frames, auf volle Sekunden im Timecode gerundet:
 * Restframes 0–12 → abrunden, 13–24 (bei 25 fps) → aufrunden; Ergebnis ist Vielfaches von `fps` → Anzeige endet auf …:00.
 */
export function roundDurationFramesToWholeSeconds(d: number, fps: number = DEFAULT_FPS): number {
  if (d <= 0) return 0;
  const sec = Math.floor(d / fps);
  const rem = d % fps;
  if (rem <= 12) return sec * fps;
  return (sec + 1) * fps;
}

/** Dauer zwischen Programm-In und -Out als Timecode (letzte Stelle immer :00). */
export function playlistDurationTimecode(recInFrames: number, recOutFrames: number, fps: number = DEFAULT_FPS): string {
  const d = Math.max(0, recOutFrames - recInFrames);
  const rounded = roundDurationFramesToWholeSeconds(d, fps);
  return framesToTimecode(rounded, fps);
}
