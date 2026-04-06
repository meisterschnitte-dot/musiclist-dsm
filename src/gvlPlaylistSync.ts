import {
  mergeAudioTags,
  mergeWarnungForDisplay,
  rechterueckrufImpliesWarnung,
  defaultTagsFromPlaylistTitle,
  type AudioTags,
} from "./audio/audioTags";
import type { PlaylistEntry } from "./edl/types";
import {
  playlistEntryTagStoreKey,
  playlistRowTagOverlay,
  type TagStore,
} from "./storage/audioTagsStorage";
import {
  findGvlEntryByLabelcode,
  type GvlLabelDb,
  type GvlLabelEntry,
} from "./storage/gvlLabelStore";
import { basenamePath, resolveMusicDbPathForBasename } from "./tracks/sanitizeFilename";

function isMp3Link(name: string): boolean {
  return basenamePath(name).toLowerCase().endsWith(".mp3");
}

/** Wie beim GVL-Abgleich (Label/Hersteller/Rechte) — exportiert für UI-Markierung. */
export function normGvlField(s: string | undefined): string {
  return (s ?? "").trim().replace(/\s+/g, " ");
}

/**
 * Welche Felder weichen Vorher/Nachher ab (nach normGvlField).
 * Hinweis: Nur Label, Hersteller und Rechterückruf lösen einen Sync-Vorschlag aus;
 * ein abweichender Labelcode ist oft nur Schreibweise und wird nicht aus der GVL überschrieben.
 */
export function gvlSyncFieldMismatchFlags(
  before: GvlSyncUpdateItem["before"],
  after: GvlSyncUpdateItem["after"]
): { labelcode: boolean; label: boolean; hersteller: boolean; gvlRechte: boolean } {
  return {
    labelcode: normGvlField(before.labelcode) !== normGvlField(after.labelcode),
    label: normGvlField(before.label) !== normGvlField(after.label),
    hersteller: normGvlField(before.hersteller) !== normGvlField(after.hersteller),
    gvlRechte: normGvlField(before.gvlRechte) !== normGvlField(after.gvlRechte),
  };
}

function gvlTripleMatchesEntry(merged: AudioTags, entry: GvlLabelEntry): boolean {
  return (
    normGvlField(entry.label) === normGvlField(merged.label) &&
    normGvlField(entry.hersteller) === normGvlField(merged.hersteller) &&
    normGvlField(entry.rechterueckrufe) === normGvlField(merged.gvlRechte)
  );
}

function warnungOverlayAfterGvlRechteChange(
  prevOverlay: AudioTags,
  oldMergedGvlRechte: string | undefined,
  newGvlRechte: string
): Pick<AudioTags, "warnung"> {
  const oldR3 = rechterueckrufImpliesWarnung(oldMergedGvlRechte);
  const oldManual = prevOverlay.warnung === true && !oldR3;
  const newR3 = rechterueckrufImpliesWarnung(newGvlRechte);
  if (newR3) return { warnung: false };
  if (oldManual) return { warnung: true };
  return { warnung: false };
}

export type GvlPlaylistSyncRowUpdated = {
  title: string;
  labelcode: string;
};

export type GvlPlaylistSyncRowMissing = {
  title: string;
  labelcode: string;
  /** Tag-Store-Schlüssel der Playlist-Zeile (Warnung setzen). */
  tagStoreKey: string;
};

export type GvlPlaylistSyncResult = {
  nextTagStore: TagStore;
  updated: GvlPlaylistSyncRowUpdated[];
  missingInGvl: GvlPlaylistSyncRowMissing[];
};

/** Ein vorgeschlagener GVL-Abgleich für eine Playlist-Zeile (Vorher/Nachher für UI). */
export type GvlSyncUpdateItem = {
  row: PlaylistEntry;
  tagStoreKey: string;
  /** Anzeige: verknüpfte MP3 oder Zeilentitel */
  displayPath: string;
  before: { labelcode: string; label: string; hersteller: string; gvlRechte: string };
  after: { labelcode: string; label: string; hersteller: string; gvlRechte: string };
  entry: GvlLabelEntry;
  /** Gemischtes gvlRechte (wie in sync) für Warnungs-Overlay */
  mergedGvlRechteForWarnung: string | undefined;
};

export type GvlPlaylistSyncEnumerateResult = {
  updates: GvlSyncUpdateItem[];
  missingInGvl: GvlPlaylistSyncRowMissing[];
};

function quadFromMerged(merged: AudioTags): {
  labelcode: string;
  label: string;
  hersteller: string;
  gvlRechte: string;
} {
  return {
    labelcode: (merged.labelcode ?? "").trim(),
    label: (merged.label ?? "").trim(),
    hersteller: (merged.hersteller ?? "").trim(),
    gvlRechte: (merged.gvlRechte ?? "").trim(),
  };
}

function quadFromGvlEntry(entry: GvlLabelEntry, fallbackLabelcode: string): {
  labelcode: string;
  label: string;
  hersteller: string;
  gvlRechte: string;
} {
  return {
    labelcode: (entry.labelcode ?? "").trim() || fallbackLabelcode,
    label: (entry.label ?? "").trim(),
    hersteller: (entry.hersteller ?? "").trim(),
    gvlRechte: (entry.rechterueckrufe ?? "").trim(),
  };
}

/**
 * Sammelt alle vorgeschlagenen GVL-Anpassungen ohne den Tag-Store zu ändern.
 */
export function enumerateGvlPlaylistSyncItems(params: {
  playlist: PlaylistEntry[];
  tagStore: TagStore;
  musicDbFileNames: string[];
  gvlDb: GvlLabelDb | null;
}): GvlPlaylistSyncEnumerateResult {
  const { playlist, tagStore, musicDbFileNames, gvlDb } = params;
  const updates: GvlSyncUpdateItem[] = [];
  const missingInGvl: GvlPlaylistSyncRowMissing[] = [];

  for (const row of playlist) {
    const linked = row.linkedTrackFileName?.trim();
    if (!linked || !isMp3Link(linked)) continue;
    if (resolveMusicDbPathForBasename(musicDbFileNames, linked) === null) continue;

    const base = defaultTagsFromPlaylistTitle(row.linkedTrackFileName ?? row.title);
    const overlay = playlistRowTagOverlay(row, tagStore);
    const merged = mergeWarnungForDisplay(mergeAudioTags(base, overlay));
    const lc = merged.labelcode?.trim();
    if (!lc) continue;

    const entry = findGvlEntryByLabelcode(gvlDb, lc);
    if (!entry) {
      missingInGvl.push({
        title: row.title,
        labelcode: lc,
        tagStoreKey: playlistEntryTagStoreKey(row),
      });
      continue;
    }

    if (gvlTripleMatchesEntry(merged, entry)) continue;

    const before = quadFromMerged(merged);
    const after = quadFromGvlEntry(entry, lc);
    const key = playlistEntryTagStoreKey(row);
    const displayPath = linked || row.title;

    updates.push({
      row,
      tagStoreKey: key,
      displayPath,
      before,
      after,
      entry,
      mergedGvlRechteForWarnung: merged.gvlRechte,
    });
  }

  return { updates, missingInGvl };
}

/** Setzt die manuelle Warnung für Zeilen, deren Labelcode nicht in der GVL ist (nach Bestätigen des Hinweises). */
export function applyWarnungForMissingGvlLabelcodes(
  tagStore: TagStore,
  missing: GvlPlaylistSyncRowMissing[]
): TagStore {
  if (missing.length === 0) return tagStore;
  const seen = new Set<string>();
  let next: TagStore = { ...tagStore };
  for (const m of missing) {
    if (seen.has(m.tagStoreKey)) continue;
    seen.add(m.tagStoreKey);
    const prev = next[m.tagStoreKey] ?? {};
    next[m.tagStoreKey] = mergeAudioTags(prev, { warnung: true });
  }
  return next;
}

/** Wendet genau einen GVL-Vorschlag auf den Tag-Store an (wie bisheriger Batch-Schritt). */
export function applyGvlPlaylistSyncItem(tagStore: TagStore, item: GvlSyncUpdateItem): TagStore {
  const key = item.tagStoreKey;
  const prevOverlay = tagStore[key] ?? {};
  const patch = warnungOverlayAfterGvlRechteChange(
    prevOverlay,
    item.mergedGvlRechteForWarnung,
    item.entry.rechterueckrufe
  );
  const newOverlay = mergeAudioTags(prevOverlay, {
    label: item.entry.label,
    hersteller: item.entry.hersteller,
    gvlRechte: item.entry.rechterueckrufe,
    ...patch,
  });
  return { ...tagStore, [key]: newOverlay };
}

/**
 * Gleicht Playlist-Zeilen mit Musikdatenbank-Eintrag gegen die GVL-Liste ab (Labelcode).
 * Aktualisiert Label, Hersteller, Rechterückruf im Tag-Store, wenn die GVL abweicht.
 */
export function syncPlaylistTagsWithGvl(params: {
  playlist: PlaylistEntry[];
  tagStore: TagStore;
  musicDbFileNames: string[];
  gvlDb: GvlLabelDb | null;
}): GvlPlaylistSyncResult {
  const { updates, missingInGvl } = enumerateGvlPlaylistSyncItems(params);
  let next: TagStore = params.tagStore;
  const updated: GvlPlaylistSyncRowUpdated[] = [];
  for (const item of updates) {
    next = applyGvlPlaylistSyncItem(next, item);
    updated.push({ title: item.row.title, labelcode: item.before.labelcode });
  }
  return { nextTagStore: next, updated, missingInGvl };
}

export function formatGvlPlaylistSyncReport(r: GvlPlaylistSyncResult): string {
  const lines: string[] = [];
  if (r.updated.length) {
    lines.push("GVL-Abgleich: folgende Einträge wurden an die aktuelle GVL-Liste angepasst (Label, Hersteller, Rechterückruf):");
    for (const u of r.updated) {
      lines.push(`• ${u.title} — Labelcode ${u.labelcode}`);
    }
    lines.push("");
  }
  if (r.missingInGvl.length) {
    lines.push("Hinweis: Diese Labelcodes sind in den Tags gespeichert, tauchen aber nicht mehr in der GVL-Datenbank auf:");
    for (const m of r.missingInGvl) {
      lines.push(`• ${m.title} — ${m.labelcode}`);
    }
  }
  return lines.join("\n").trim();
}

/** Nur fehlende Labelcodes (ohne Update-Zeilen). */
export function formatGvlPlaylistSyncMissingReport(missing: GvlPlaylistSyncRowMissing[]): string {
  if (missing.length === 0) return "";
  const lines: string[] = [
    "Diese Labelcodes sind in den Tags gespeichert, tauchen aber nicht in der GVL-Datenbank auf:",
  ];
  for (const m of missing) {
    lines.push(`• ${m.title} — ${m.labelcode}`);
  }
  return lines.join("\n").trim();
}
