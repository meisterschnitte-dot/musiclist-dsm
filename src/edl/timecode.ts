/** Non-drop: Standard 25 fps (deutsche Produktion). */
export const DEFAULT_FPS = 25;

/** Frames in einem 24h-Zyklus bei gegebener Bildfrequenz (z. B. 25 → 2_160_000). */
export function framesPerDay(fps: number = DEFAULT_FPS): number {
  return 24 * 60 * 60 * fps;
}

/** Wie eine Uhr: nach 23:59:59:(fps-1) folgt wieder 00:00:00:00 — für Anzeige/Parsing. */
export function normalizeFramesToDay(frames: number, fps: number = DEFAULT_FPS): number {
  const n = framesPerDay(fps);
  if (n <= 0) return 0;
  let x = frames % n;
  if (x < 0) x += n;
  return x | 0;
}

/**
 * Abstand (Frames) vom Nullpunkt zur Programmposition **vorwärts** entlang der Uhr
 * (über Mitternacht: z. B. Nullpunkt 23:59:55:00 → erster Clip 00:00:00:00 liegt ~125 Frames rechts).
 */
export function offsetFromOriginFrame(
  programFrames: number,
  originFrames: number,
  fps: number = DEFAULT_FPS
): number {
  const DAY = framesPerDay(fps);
  const T = normalizeFramesToDay(programFrames, fps);
  const O = normalizeFramesToDay(Math.max(0, originFrames), fps);
  return (T - O + DAY) % DAY;
}

export function timecodeToFrames(tc: string, fps: number = DEFAULT_FPS): number {
  const m = tc.trim().match(/^(\d{2}):(\d{2}):(\d{2}):(\d{2})$/);
  if (!m) throw new Error(`Ungültiger Timecode: ${tc}`);
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  const ss = Number(m[3]);
  const ff = Number(m[4]);
  const maxF = fps - 1;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59 || ss < 0 || ss > 59 || ff < 0 || ff > maxF) {
    throw new Error(
      `Ungültiger Timecode (Uhrzeit 00–23:59:59, Frames 00–${String(maxF).padStart(2, "0")} bei ${fps} fps): ${tc}`
    );
  }
  return (((hh * 60 + mm) * 60 + ss) * fps + ff) | 0;
}

/**
 * Wie {@link timecodeToFrames}, plus reine Ziffern ohne Doppelpunkt: 1–8 Stellen werden links mit Nullen
 * auf HHMMSSFF aufgefüllt (z. B. `01000000` → 01:00:00:00).
 */
export function timecodeInputToFrames(raw: string, fps: number = DEFAULT_FPS): number {
  const t = raw.trim();
  if (!t) throw new Error("Leerer Timecode");
  const noSpace = t.replace(/\s/g, "");
  if (/^\d+$/.test(noSpace)) {
    if (noSpace.length > 8) {
      throw new Error(`Zu viele Ziffern (max. 8): ${noSpace}`);
    }
    const padded = noSpace.padStart(8, "0");
    const tc = `${padded.slice(0, 2)}:${padded.slice(2, 4)}:${padded.slice(4, 6)}:${padded.slice(6, 8)}`;
    return timecodeToFrames(tc, fps);
  }
  return timecodeToFrames(t, fps);
}

/**
 * Programm-/Uhrzeit-Position: 24h-Zyklus (gleiche Uhrzeit wie EBU 25fps: Frames 00–24).
 * Für Zeitspannen (Dauer) stattdessen {@link framesToTimecodeDuration} verwenden.
 */
export function framesToTimecode(frames: number, fps: number = DEFAULT_FPS): string {
  const f = normalizeFramesToDay(frames, fps);
  const totalSeconds = Math.floor(f / fps);
  const ff = f % fps;
  const ss = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const mm = totalMinutes % 60;
  const hh = Math.floor(totalMinutes / 60) % 24;
  const pad = (n: number, w: number) => String(n).padStart(w, "0");
  return `${pad(hh, 2)}:${pad(mm, 2)}:${pad(ss, 2)}:${pad(ff, 2)}`;
}

/**
 * Vorschlag für den Start-TC der Playlist-Timeline: **Stunde** wie beim ersten Eintrag (`recIn`),
 * dabei immer `HH:00:00:00` (Minuten, Sekunden und Frames auf null).
 */
export function suggestedTimelineOriginFromFirstRecIn(recInFrames: number, fps: number = DEFAULT_FPS): number {
  const f = normalizeFramesToDay(recInFrames, fps);
  const totalSeconds = Math.floor(f / fps);
  const totalMinutes = Math.floor(totalSeconds / 60);
  const hh = Math.floor(totalMinutes / 60) % 24;
  return (hh * 60 * 60 * fps) | 0;
}

/**
 * Zeitspanne (Dauer) ohne Tagesumbruch — Stunden können 24 überschreiten; pro Sekunde Frames 0…fps−1.
 */
export function framesToTimecodeDuration(frames: number, fps: number = DEFAULT_FPS): string {
  if (frames < 0) frames = 0;
  const f = Math.floor(frames);
  const totalSeconds = Math.floor(f / fps);
  const ff = f % fps;
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
  return framesToTimecodeDuration(rounded, fps);
}
