import { basenamePath, stripExtension } from "../tracks/sanitizeFilename";

/** Metadaten für MP3 (ID3 + benutzerdefinierte TXXX-Felder). */
export type AudioTags = {
  songTitle?: string;
  artist?: string;
  album?: string;
  year?: string;
  comment?: string;
  composer?: string;
  isrc?: string;
  labelcode?: string;
  label?: string;
  hersteller?: string;
  gvlRechte?: string;
  /** Nur UI: Zeile in EDL- und Musikdatenbank-Listen rot hervorheben; wird nicht in ID3 geschrieben. */
  warnung?: boolean;
};

export const EMPTY_AUDIO_TAGS: AudioTags = {};

export function hasAnyAudioTagValue(tags: AudioTags): boolean {
  return Object.values(tags).some((v) => typeof v === "string" && v.trim().length > 0);
}

/**
 * `overlay` überschreibt Basiswerte. Leerer String in `overlay` entfernt den jeweiligen Wert
 * (z. B. wenn der Nutzer ein Feld leert, das vorher aus der Vorgabe kam).
 */
export function mergeAudioTags(base: AudioTags, overlay?: AudioTags): AudioTags {
  if (!overlay) return { ...base };
  const out: AudioTags = { ...base };
  for (const k of Object.keys(overlay) as (keyof AudioTags)[]) {
    const v = overlay[k];
    if (v === undefined) continue;
    if (k === "warnung") {
      if (v === false) delete out.warnung;
      else out.warnung = true;
      continue;
    }
    const t = typeof v === "string" ? v.trim() : "";
    if (t === "") delete (out as Record<string, unknown>)[k];
    else (out as Record<string, string>)[k] = t;
  }
  return out;
}

const AUDIO_TAG_KEYS: (keyof AudioTags)[] = [
  "songTitle",
  "artist",
  "album",
  "year",
  "comment",
  "composer",
  "isrc",
  "labelcode",
  "label",
  "hersteller",
  "gvlRechte",
];

/**
 * Spaltenreihenfolge in Tabellen und im Tag-Editor (Kommentar nach Komponist).
 */
export const AUDIO_TAG_TABLE_COLUMN_KEYS: (keyof AudioTags)[] = [
  "songTitle",
  "artist",
  "album",
  "year",
  "composer",
  "comment",
  "isrc",
  "labelcode",
  "label",
  "hersteller",
  "gvlRechte",
];

export const AUDIO_TAG_FIELD_LABELS: Record<keyof AudioTags, string> = {
  songTitle: "Songtitel",
  artist: "Interpret",
  album: "Albumtitel",
  year: "Jahr",
  comment: "Kommentar",
  composer: "Komponist",
  isrc: "ISRC",
  labelcode: "Labelcode",
  label: "Label",
  hersteller: "Hersteller",
  gvlRechte: "Rechterückruf",
  warnung: "Warnung",
};

/** Anzeigewert für eine Tabellenzelle (leer wenn nicht gesetzt). */
export function tagCellText(tags: AudioTags, key: keyof AudioTags): string {
  const v = tags[key];
  return typeof v === "string" && v.trim() ? v.trim() : "";
}

/** Nicht leere Felder in Anzeigereihenfolge (z. B. Menüleiste). */
export function tagEntriesForDisplay(tags: AudioTags): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  for (const k of AUDIO_TAG_TABLE_COLUMN_KEYS) {
    const v = tags[k];
    const t = typeof v === "string" ? v.trim() : "";
    if (t) out.push({ label: AUDIO_TAG_FIELD_LABELS[k], value: t });
  }
  return out;
}

/** Differenz Formular ↔ automatische Vorgabe — nur Abweichungen speichern. */
export function overlayFromForm(base: AudioTags, form: AudioTags): AudioTags {
  const out: AudioTags = {};
  for (const k of AUDIO_TAG_KEYS) {
    const f = (typeof form[k] === "string" ? form[k] : "").trim();
    const b = (typeof base[k] === "string" ? base[k] : "").trim();
    if (f !== b) (out as Record<string, string>)[k] = f;
  }
  const fw = form.warnung === true;
  const bw = base.warnung === true;
  if (fw !== bw) out.warnung = fw;
  return out;
}

/** ID3-Embedding: nur String-Felder (ohne UI-Flag `warnung`). */
export function tagsForId3Embedding(tags: AudioTags): AudioTags {
  const { warnung: _w, ...rest } = tags;
  return rest;
}

/** Für ID3: Songtitel aus EDL-Zeile / Dateiname als Vorschlag. */
export function defaultTagsFromPlaylistTitle(displayTitle: string): AudioTags {
  const base = basenamePath(displayTitle.trim());
  const t = stripExtension(base.trim()).trim() || base.trim();
  return t ? { songTitle: t } : {};
}

