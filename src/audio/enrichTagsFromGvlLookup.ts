import { mergeWarnungForDisplay, type AudioTags } from "./audioTags";
import { findGvlEntryByLabelcode, type GvlLabelDb } from "../storage/gvlLabelStore";

/**
 * Überschreibt Label, Hersteller und Rechterückruf mit der importierten GVL-Liste,
 * sobald der Labelcode in der Datenbank vorkommt (unabhängig von den bisherigen Tag-Werten).
 */
export function enrichTagsFromGvlByLabelcode(tags: AudioTags, db: GvlLabelDb | null): AudioTags {
  const lc = typeof tags.labelcode === "string" ? tags.labelcode.trim() : "";
  if (!lc || !db?.entries?.length) return tags;
  const hit = findGvlEntryByLabelcode(db, lc);
  if (!hit) return tags;

  const label = hit.label.trim();
  const hersteller = hit.hersteller.trim();
  const gvlRechte = hit.rechterueckrufe.trim();

  const merged: AudioTags = { ...tags, label, hersteller, gvlRechte };

  const same =
    (tags.label ?? "").trim() === label &&
    (tags.hersteller ?? "").trim() === hersteller &&
    (tags.gvlRechte ?? "").trim() === gvlRechte;

  return same ? tags : mergeWarnungForDisplay(merged);
}
