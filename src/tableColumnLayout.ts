import {
  AUDIO_TAG_FIELD_LABELS,
  AUDIO_TAG_TABLE_COLUMN_KEYS,
  type AudioTags,
} from "./audio/audioTags";

/** Anzahl fester Spalten vor den Tag-Spalten (EDL-Liste). */
export const EDL_FIXED_COL_COUNT = 6;

/**
 * Mindestbreite aus der sichtbaren Spaltenüberschrift (ungefähre Textbreite + Innenabstand + Ziehgriff).
 */
function headerMinPx(label: string): number {
  const pad = 26;
  const perChar = 6.4;
  return Math.min(168, Math.max(28, Math.ceil(label.length * perChar + pad)));
}

/** Mindestbreiten für ID3-Spalten (gleiche Logik wie in der EDL- und MP3-Tabelle). */
export const TAG_COLUMN_MIN_WIDTHS: Record<keyof AudioTags, number> = (() => {
  const o = {} as Record<keyof AudioTags, number>;
  for (const k of AUDIO_TAG_TABLE_COLUMN_KEYS) {
    o[k] = headerMinPx(AUDIO_TAG_FIELD_LABELS[k]);
  }
  /* „Rechterückruf“: etwas großzügiger — vermeidet in Firefox stärkeres Abschneiden als in Chrome. */
  o.gvlRechte = Math.max(o.gvlRechte, 124);
  return o;
})();

/** Mindestbreiten je Spalte — EDL- & Playlist (Kopfzeilen-Texte). */
export const EDL_COLUMN_MIN_WIDTHS: number[] = [
  headerMinPx("#"),
  headerMinPx("Spur"),
  headerMinPx("TC-In"),
  headerMinPx("TC-Out"),
  headerMinPx("Duration"),
  headerMinPx("Titel / Quelle"),
  ...AUDIO_TAG_TABLE_COLUMN_KEYS.map((k) => TAG_COLUMN_MIN_WIDTHS[k]),
];

/** Mindestbreiten je Spalte — Musikdatenbank (#, Dateiname, Erstellt, Bearbeitet, …). */
export const MP3_COLUMN_MIN_WIDTHS: number[] = [
  headerMinPx("#"),
  headerMinPx("Dateiname"),
  headerMinPx("Erstellt"),
  headerMinPx("Bearbeitet"),
  ...AUDIO_TAG_TABLE_COLUMN_KEYS.map((k) => TAG_COLUMN_MIN_WIDTHS[k]),
];

function defaultWidthFromMin(min: number): number {
  return Math.round(min * 1.28 + 16);
}

export function defaultEdlColumnWidths(): number[] {
  return EDL_COLUMN_MIN_WIDTHS.map(defaultWidthFromMin);
}

export function defaultMp3ColumnWidths(): number[] {
  const w = MP3_COLUMN_MIN_WIDTHS.map(defaultWidthFromMin);
  w[0] = Math.max(w[0], 108);
  /* „Dateiname“ bewusst großzügiger als z. B. „Jahr“ */
  w[1] = Math.max(w[1], 300);
  w[2] = Math.max(w[2], 132);
  w[3] = Math.max(w[3], 132);
  return w;
}

export function edlResizeMinForIndex(index: number): number {
  return EDL_COLUMN_MIN_WIDTHS[index] ?? 28;
}

export function mp3ResizeMinForIndex(index: number): number {
  return MP3_COLUMN_MIN_WIDTHS[index] ?? 28;
}

/** GVL-Labeltabelle (Dialog „GVL-Daten“): Kürzel & PLM; Übernehmen; Web-Suche. */
export const GVL_COLUMN_MIN_WIDTHS: number[] = [
  headerMinPx("Labelcode"),
  headerMinPx("Label"),
  headerMinPx("Kürzel"),
  headerMinPx("PLM"),
  headerMinPx("Hersteller"),
  Math.max(headerMinPx("Rechterückrufe"), 150),
  headerMinPx("Übernehmen"),
  40,
];

export function defaultGvlColumnWidths(): number[] {
  const w = GVL_COLUMN_MIN_WIDTHS.map(defaultWidthFromMin);
  w[1] = Math.max(w[1], 200);
  w[2] = Math.max(w[2], 72);
  w[3] = Math.max(w[3], 72);
  w[5] = Math.max(w[5], 184);
  w[6] = Math.max(w[6], 92);
  w[7] = 52;
  return w;
}

export function gvlResizeMinForIndex(index: number): number {
  return GVL_COLUMN_MIN_WIDTHS[index] ?? 28;
}
