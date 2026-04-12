import type { IAudioMetadata } from "music-metadata";
import type { AudioTags } from "./audioTags";
import { readId3RawPreferredTextFields } from "./readId3RawTextFrames";

/**
 * `music-metadata` wird nur dynamisch geladen, wenn ID3 gelesen wird (z. B. Tag-Dialog),
 * damit der Start-Bundle klein bleibt. Die Musikdatenbank-Tabelle ruft das nicht pro Zeile auf.
 *
 * TCOM, TPE1, TXXX (u. a. Hersteller): `music-metadata` splittet ID3v2.3-Texte an `/`.
 * {@link readId3RawPreferredTextFields} liest Rohstrings und überschreibt diese Felder.
 */

/** Entspricht den TXXX-Beschreibungen aus `embedId3.ts`. */
const TXXX_ID_TO_KEY: Record<string, keyof AudioTags> = {
  "TXXX:ISRC": "isrc",
  "TXXX:Labelcode": "labelcode",
  "TXXX:Label": "label",
  "TXXX:Hersteller": "hersteller",
  "TXXX:Rechterückruf": "gvlRechte",
};

function firstCommentText(metadata: IAudioMetadata): string | undefined {
  const c = metadata.common.comment;
  if (!c?.length) return undefined;
  const first = c[0];
  if (typeof first === "string") return first;
  const t = first?.text?.trim();
  return t || undefined;
}

function audioTagsFromMetadata(metadata: IAudioMetadata): AudioTags {
  const out: AudioTags = {};
  const c = metadata.common;

  if (c.title?.trim()) out.songTitle = c.title.trim();
  if (c.artist?.trim()) out.artist = c.artist.trim();
  if (c.album?.trim()) out.album = c.album.trim();

  if (typeof c.year === "number" && Number.isFinite(c.year)) {
    out.year = String(c.year);
  } else if (c.date?.trim()) {
    const y = c.date.trim().slice(0, 4);
    if (/^\d{4}$/.test(y)) out.year = y;
  }

  const comment = firstCommentText(metadata);
  if (comment) out.comment = comment;

  if (c.composer?.length) {
    const parts = c.composer.map((x) => x.trim()).filter(Boolean);
    if (parts.length) out.composer = parts.join(", ");
  }

  if (c.isrc?.length) {
    const first = c.isrc.map((x) => x.trim()).find(Boolean);
    if (first) out.isrc = first;
  }

  for (const tags of Object.values(metadata.native)) {
    for (const tag of tags) {
      const key = TXXX_ID_TO_KEY[tag.id];
      if (!key) continue;
      const v = tag.value;
      if (typeof v === "string" && v.trim()) {
        (out as Record<string, string>)[key] = v.trim();
      }
    }
  }

  return out;
}

/**
 * Liest ID3 aus einer MP3-Datei und mappt auf {@link AudioTags}.
 * Bei Fehlern (kein ID3, kein MP3) wird ein leeres Objekt zurückgegeben.
 */
export async function readAudioTagsFromBlob(blob: Blob): Promise<AudioTags> {
  try {
    const ab = await blob.arrayBuffer();
    const u8 = new Uint8Array(ab);
    const { parseBuffer } = await import("music-metadata");
    const metadata = await parseBuffer(u8, "audio/mpeg", {
      duration: false,
      skipCovers: true,
    });
    const out = audioTagsFromMetadata(metadata);
    const raw = readId3RawPreferredTextFields(u8);
    if (raw.composer !== undefined) out.composer = raw.composer;
    if (raw.artist !== undefined) out.artist = raw.artist;
    if (raw.isrc !== undefined) out.isrc = raw.isrc;
    if (raw.labelcode !== undefined) out.labelcode = raw.labelcode;
    if (raw.label !== undefined) out.label = raw.label;
    if (raw.hersteller !== undefined) out.hersteller = raw.hersteller;
    if (raw.gvlRechte !== undefined) out.gvlRechte = raw.gvlRechte;
    return out;
  } catch {
    return {};
  }
}
