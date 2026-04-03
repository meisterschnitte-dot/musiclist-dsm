import type { EdlEvent, PlaylistEntry } from "./types";
import { DEFAULT_FPS, framesToTimecode, timecodeToFrames } from "./timecode";
import { isBlackEvent } from "./parseEdl";
import { pickRicherTitle, titlesLikelySame } from "./similarTitle";

/** Bei ähnlichen Titeln: Lücke zwischen TC-Out und nächstem TC-In unter dieser Dauer → zusammenfassen. */
const MAX_GAP_MERGE_SECONDS = 5;

type Segment = {
  track: string;
  sourceKey: string;
  title: string;
  recInFrames: number;
  recOutFrames: number;
};

function normalizeSourceKey(ev: EdlEvent): string {
  if (ev.sourceFile) {
    const base = ev.sourceFile.replace(/^.*[/\\]/, "").trim();
    return base.toLowerCase();
  }
  return ev.reel.trim().toLowerCase();
}

function displayTitle(ev: EdlEvent): string {
  if (ev.sourceFile) return ev.sourceFile.replace(/^.*[/\\]/, "").trim();
  return ev.reel.trim();
}

/** Nach exakter Quelle; Überlappungen schließen an. */
function exactMergeEvents(
  rows: {
    ev: EdlEvent;
    recInFrames: number;
    recOutFrames: number;
    sourceKey: string;
    sortKey: number;
  }[]
): Segment[] {
  rows.sort((a, b) => a.sortKey - b.sortKey);

  const mergeKey = (r: (typeof rows)[0]) => `${r.ev.track}|${r.sourceKey}`;

  const merged: Segment[] = [];
  let current: Segment | null = null;

  for (const r of rows) {
    const key = mergeKey(r);
    if (!current) {
      current = {
        track: r.ev.track,
        sourceKey: r.sourceKey,
        title: displayTitle(r.ev),
        recInFrames: r.recInFrames,
        recOutFrames: r.recOutFrames,
      };
      continue;
    }

    const same = key === `${current.track}|${current.sourceKey}`;
    const adjacent = r.recInFrames <= current.recOutFrames;

    if (same && adjacent) {
      current.recOutFrames = Math.max(current.recOutFrames, r.recOutFrames);
      if (r.ev.sourceFile) current.title = displayTitle(r.ev);
    } else {
      merged.push(current);
      current = {
        track: r.ev.track,
        sourceKey: r.sourceKey,
        title: displayTitle(r.ev),
        recInFrames: r.recInFrames,
        recOutFrames: r.recOutFrames,
      };
    }
  }

  if (current) merged.push(current);

  return merged;
}

/**
 * Ähnlicher Titel + (Überlappung/Anstoß ODER Lücke unter MAX_GAP_MERGE_SECONDS) — auch über
 * verschiedene Spuren; Ergebnis: TC-In des ersten bis TC-Out des letzten (Lücke inkl.).
 */
function fuzzyMergeSimilarTitles(
  segments: Segment[],
  frameSlack: number,
  fps: number
): Segment[] {
  const sorted = [...segments].sort(
    (a, b) =>
      a.recInFrames - b.recInFrames ||
      a.recOutFrames - b.recOutFrames ||
      a.track.localeCompare(b.track)
  );

  const out: Segment[] = [];
  let i = 0;
  while (i < sorted.length) {
    let recIn = sorted[i].recInFrames;
    let recOut = sorted[i].recOutFrames;
    let title = sorted[i].title;
    const clusterTitles = [sorted[i].title];
    const tracks = new Set<string>([sorted[i].track]);
    const sourceKeys = new Set<string>([sorted[i].sourceKey]);

    let j = i + 1;
    while (j < sorted.length) {
      const next = sorted[j];
      const gapFrames = next.recInFrames - recOut;
      const overlapOrTouch = next.recInFrames <= recOut + frameSlack;
      const shortGap =
        gapFrames > 0 && gapFrames < MAX_GAP_MERGE_SECONDS * fps;
      const connected = overlapOrTouch || shortGap;
      const similar = clusterTitles.some((t) => titlesLikelySame(t, next.title));
      if (!connected || !similar) break;

      recIn = Math.min(recIn, next.recInFrames);
      recOut = Math.max(recOut, next.recOutFrames);
      title = pickRicherTitle(title, next.title);
      clusterTitles.push(next.title);
      tracks.add(next.track);
      sourceKeys.add(next.sourceKey);
      j++;
    }

    const trackLabel = [...tracks].sort().join(" / ");
    const sourceKey =
      sourceKeys.size === 1 ? [...sourceKeys][0] : canonicalSourceKey(title);

    out.push({
      title,
      track: trackLabel,
      recInFrames: recIn,
      recOutFrames: recOut,
      sourceKey,
    });

    i = j;
  }

  return out;
}

function canonicalSourceKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9äöüß]+/gi, "")
    .slice(0, 48);
}

/** Überlappung, Anstoß oder kurze Lücke (wie MAX_GAP_MERGE_SECONDS) — für beliebige Paare. */
function timeRangesConnected(
  aIn: number,
  aOut: number,
  bIn: number,
  bOut: number,
  frameSlack: number,
  fps: number
): boolean {
  const overlapOrTouch = aIn <= bOut + frameSlack && bIn <= aOut + frameSlack;
  if (overlapOrTouch) return true;

  if (aOut < bIn) {
    const gap = bIn - aOut;
    return gap > 0 && gap < MAX_GAP_MERGE_SECONDS * fps;
  }
  if (bOut < aIn) {
    const gap = aIn - bOut;
    return gap > 0 && gap < MAX_GAP_MERGE_SECONDS * fps;
  }
  return false;
}

function segmentsTimeConnected(a: Segment, b: Segment, frameSlack: number, fps: number): boolean {
  return timeRangesConnected(
    a.recInFrames,
    a.recOutFrames,
    b.recInFrames,
    b.recOutFrames,
    frameSlack,
    fps
  );
}

function mergeTrackLabels(t1: string, t2: string): string {
  const parts = new Set<string>();
  for (const p of t1.split(" / ")) {
    const s = p.trim();
    if (s) parts.add(s);
  }
  for (const p of t2.split(" / ")) {
    const s = p.trim();
    if (s) parts.add(s);
  }
  return [...parts].sort().join(" / ");
}

function segmentsShouldMerge(a: Segment, b: Segment): boolean {
  if (titlesLikelySame(a.title, b.title)) return true;
  if (a.sourceKey && a.sourceKey === b.sourceKey) return true;
  return false;
}

function combineTwoSegments(a: Segment, b: Segment): Segment {
  const title = pickRicherTitle(a.title, b.title);
  const recInFrames = Math.min(a.recInFrames, b.recInFrames);
  const recOutFrames = Math.max(a.recOutFrames, b.recOutFrames);
  const track = mergeTrackLabels(a.track, b.track);
  const sourceKey =
    a.sourceKey && a.sourceKey === b.sourceKey ? a.sourceKey : canonicalSourceKey(title);
  return { title, track, recInFrames, recOutFrames, sourceKey };
}

/**
 * Verbindet Segmente, die zeitlich überlappen, anstoßen oder nur eine kurze Lücke haben — auch wenn
 * dazwischen in der Timeline andere (nicht zusammenpassende) Einträge liegen (Fuzzy-Merge ist nur
 * „kettenförmig“). Ebenfalls: ein Segment liegt vollständig im Zeitfenster eines anderen.
 */
function mergeGlobalOverlappingSimilar(
  segments: Segment[],
  frameSlack: number,
  fps: number
): Segment[] {
  let list = segments.map((s) => ({ ...s }));
  let changed = true;
  while (changed) {
    changed = false;
    outer: for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (!segmentsShouldMerge(list[i], list[j])) continue;
        if (!segmentsTimeConnected(list[i], list[j], frameSlack, fps)) continue;
        const merged = combineTwoSegments(list[i], list[j]);
        list = list.filter((_, idx) => idx !== i && idx !== j);
        list.push(merged);
        changed = true;
        break outer;
      }
    }
  }
  return list.sort(
    (a, b) =>
      a.recInFrames - b.recInFrames ||
      a.recOutFrames - b.recOutFrames ||
      a.track.localeCompare(b.track)
  );
}

function toPlaylistEntry(s: Segment, fps: number): PlaylistEntry {
  const recIn = framesToTimecode(s.recInFrames, fps);
  const recOut = framesToTimecode(s.recOutFrames, fps);
  const id = `${s.track}-${s.recInFrames}-${s.recOutFrames}-${s.sourceKey.slice(0, 24)}`;
  return {
    id,
    title: s.title,
    track: s.track,
    recIn,
    recOut,
    recInFrames: s.recInFrames,
    recOutFrames: s.recOutFrames,
    sourceKey: s.sourceKey,
  };
}

/**
 * BL wird verworfen.
 * 1) Exakt gleiche Quelle + Spur, anstoßende/überlappende Record-Zeiten.
 * 2) Sehr ähnliche Titel + auf der Timeline überlappend/anstoßend oder mit Lücke unter 5 s — auch über
 *    verschiedene Spuren; Anzeigename = ausführlichere Bezeichnung, Spalte Spur = beteiligte Spuren.
 * 3) Globale Runde: dieselbe Regel wie (2), aber für alle Paare (überlappend / kurze Lücke), damit
 *    Einträge zusammengehen, die nur durch andere Titel in der Timeline „unterbrochen“ waren.
 */
export function eventsToMergedPlaylist(
  events: EdlEvent[],
  fps: number = DEFAULT_FPS
): PlaylistEntry[] {
  const cuts = events.filter((e) => !isBlackEvent(e));

  const rows = cuts.map((ev, i) => {
    const recInFrames = timecodeToFrames(ev.recIn, fps);
    const recOutFrames = timecodeToFrames(ev.recOut, fps);
    const sourceKey = normalizeSourceKey(ev);
    return {
      ev,
      recInFrames,
      recOutFrames,
      sourceKey,
      sortKey: recInFrames * 1000 + i,
    };
  });

  const exact = exactMergeEvents(rows);
  const frameSlack = 1;
  const fuzzy = fuzzyMergeSimilarTitles(exact, frameSlack, fps);
  const globalMerged = mergeGlobalOverlappingSimilar(fuzzy, frameSlack, fps);

  return globalMerged.map((s) => toPlaylistEntry(s, fps));
}
