import type { AudioTags } from "./audioTags";
import { labelcodeWithLcPrefix } from "../blankframeSearch";

const MMD_NS = "http://www.musicmetadata.org/mmdSchema/";

function firstText(
  parent: Element | Document,
  local: string,
  preferLang?: string
): string {
  const list = parent.getElementsByTagNameNS(MMD_NS, local);
  if (preferLang) {
    for (let i = 0; i < list.length; i++) {
      const el = list[i]!;
      if (el.getAttribute("lang") === preferLang) {
        const t = el.textContent?.trim();
        if (t) return t;
      }
    }
  }
  if (list.length > 0) {
    const t = list[0]!.textContent?.trim();
    if (t) return t;
  }
  return "";
}

function normalizeIsrc(raw: string): string {
  const t = raw.replace(/\s+/g, "").replace(/-/g, "").toUpperCase();
  if (/^[A-Z0-9]{12}$/.test(t)) return t;
  return raw.trim();
}

/**
 * Parst die öffentliche SonoFind-MMD-Antwort ([musicmetadata.org](https://musicmetadata.org)).
 */
export function parseSonofindMmdXml(xml: string, trackcodeHint?: string): Partial<AudioTags> {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  if (doc.getElementsByTagName("parsererror").length > 0) {
    throw new Error("MMD-XML konnte nicht gelesen werden.");
  }

  const findTrack = (): Element | null => {
    const tracks = doc.getElementsByTagNameNS(MMD_NS, "track");
    if (tracks.length === 0) return null;
    if (trackcodeHint) {
      for (let i = 0; i < tracks.length; i++) {
        const t = tracks[i]!;
        if (t.getAttribute("trackcode") === trackcodeHint) return t;
      }
    }
    return tracks[0] ?? null;
  };

  const track = findTrack();
  if (!track) {
    throw new Error("Im MMD-XML fehlt ein &lt;track&gt;.");
  }

  const out: Partial<AudioTags> = {};

  const st = firstText(track, "title", "de") || firstText(track, "title", "en");
  if (st) out.songTitle = st;

  const isrcEl = track.getElementsByTagNameNS(MMD_NS, "isrc")[0];
  const isrcRaw = isrcEl?.textContent?.trim() ?? "";
  if (isrcRaw) {
    out.isrc = normalizeIsrc(isrcRaw);
  }

  const composers: string[] = [];
  const compRoot = track.getElementsByTagNameNS(MMD_NS, "composers")[0];
  if (compRoot) {
    const comps = compRoot.getElementsByTagNameNS(MMD_NS, "composer");
    for (let i = 0; i < comps.length; i++) {
      const c = comps[i]!.textContent?.trim();
      if (c) composers.push(c);
    }
  }
  if (composers.length) {
    const joined = composers.join("; ");
    out.composer = joined;
  }

  const artRoot = track.getElementsByTagNameNS(MMD_NS, "artists")[0];
  if (artRoot) {
    const artists: string[] = [];
    const as = artRoot.getElementsByTagNameNS(MMD_NS, "artist");
    for (let i = 0; i < as.length; i++) {
      const a = as[i]!.textContent?.trim();
      if (a) artists.push(a);
    }
    if (artists.length) {
      out.artist = artists.join("; ");
    }
  }
  if (!out.artist && out.composer) {
    out.artist = out.composer;
  }

  const lib = track.getElementsByTagNameNS(MMD_NS, "library")[0]?.textContent?.trim() ?? "";
  const lab = track.getElementsByTagNameNS(MMD_NS, "label")[0]?.textContent?.trim() ?? "";
  if (lib) {
    out.label = lib;
  } else if (lab) {
    out.label = lab;
  }

  const labelinfos = doc.getElementsByTagNameNS(MMD_NS, "labelinfo");
  for (let i = 0; i < labelinfos.length; i++) {
    const li = labelinfos[i]!;
    const lc = li.getElementsByTagNameNS(MMD_NS, "lc")[0]?.textContent?.trim() ?? "";
    if (lc) {
      out.labelcode = labelcodeWithLcPrefix(lc);
      break;
    }
  }

  const cds = doc.getElementsByTagNameNS(MMD_NS, "cd");
  const tCodeForCd = track.getAttribute("trackcode") || trackcodeHint || "";
  const pickCd = (): Element | null => {
    if (cds.length === 0) return null;
    if (tCodeForCd) {
      for (let i = 0; i < cds.length; i++) {
        const cdc = cds[i]!.getAttribute("cdcode");
        if (cdc && tCodeForCd.startsWith(cdc)) return cds[i]!;
      }
    }
    return cds[0] ?? null;
  };

  const cd0 = pickCd();
  if (cd0) {
    const al = firstText(cd0, "title", "de") || firstText(cd0, "title", "en");
    if (al) out.album = al;
    const ra = firstText(cd0, "releasedat");
    const ym = ra.match(/^(19|20)\d{2}/);
    if (ym) out.year = ym[0];
  }

  return out;
}
