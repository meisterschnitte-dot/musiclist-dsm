import type { AudioTags } from "../audio/audioTags";
import { getUsersApiToken } from "./authToken";
import {
  BLANKFRAME_GVL_LABELCODE_DIGITS,
  labelcodeWithLcPrefix,
} from "../blankframeSearch";

const API = "/api";

async function parseError(res: Response): Promise<string> {
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  return data.error || `Anfrage fehlgeschlagen (${res.status}).`;
}

function authHeaders(): HeadersInit {
  const t = getUsersApiToken();
  if (!t) throw new Error("Nicht angemeldet.");
  return { Authorization: `Bearer ${t}`, Accept: "application/json" };
}

/** Rohobjekt aus GET /track/get/many (nur die Felder, die wir nutzen). */
export type BlankframeComposerDisplayable = {
  lastname?: string;
  firstname?: string;
  pseudonym?: string;
};

export type BlankframeTrackDto = {
  title?: string;
  catalogTrackNumber?: string;
  isrc?: string;
  iswc?: string;
  gemaNumber?: string;
  length?: number;
  soundMouseId?: string;
  albumDisplayables?: { albumTitle?: string };
  composerDisplayables?: BlankframeComposerDisplayable[];
};

/** Ruft den Server-Proxy auf (ids kommasepariert). */
export async function apiBlankframeTracksFetch(idsCommaSeparated: string): Promise<BlankframeTrackDto[]> {
  const ids = idsCommaSeparated.trim();
  if (!ids) throw new Error("Keine Katalognummern.");
  const res = await fetch(
    `${API}/blankframe/tracks?${new URLSearchParams({ ids }).toString()}`,
    { headers: authHeaders() }
  );
  if (!res.ok) throw new Error(await parseError(res));
  const data = (await res.json()) as unknown;
  if (!Array.isArray(data)) {
    throw new Error("Unerwartete Antwort von Blankframe.");
  }
  return data as BlankframeTrackDto[];
}

/** Übernimmt Songtitel, Album, Interpret/Komponist, ISRC und festen Labelcode für GVL. */
export function mapBlankframeTrackToAudioTagsPartial(track: BlankframeTrackDto): Partial<AudioTags> {
  const comps = track.composerDisplayables ?? [];
  const names = comps.map((c) => {
    const p = c.pseudonym?.trim();
    if (p) return p;
    const f = c.firstname?.trim() ?? "";
    const l = c.lastname?.trim() ?? "";
    return [f, l].filter(Boolean).join(" ");
  }).filter(Boolean);
  const artistComposer = names.join("; ").trim();
  const out: Partial<AudioTags> = {
    labelcode: labelcodeWithLcPrefix(BLANKFRAME_GVL_LABELCODE_DIGITS),
  };
  const st = track.title?.trim();
  if (st) out.songTitle = st;
  const al = track.albumDisplayables?.albumTitle?.trim();
  if (al) out.album = al;
  if (artistComposer) {
    out.artist = artistComposer;
    out.composer = artistComposer;
  }
  const isrc = track.isrc?.trim();
  if (isrc) out.isrc = isrc;
  return out;
}
