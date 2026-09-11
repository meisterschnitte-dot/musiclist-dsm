const IGNORED_SEPARATORS = new Set(["_", "-", "(", ")"]);

function isLetterOrDigit(ch: string): boolean {
  return /^[0-9a-z]$/i.test(ch);
}

/** Endet der Dateiname mit .mp3 oder .wav (case-insensitive)? */
function stripAudioExtensionForCompare(filename: string): { stem: string; extLen: number } {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".mp3")) return { stem: filename.slice(0, -4), extLen: 4 };
  if (lower.endsWith(".wav")) return { stem: filename.slice(0, -4), extLen: 4 };
  return { stem: filename, extLen: 0 };
}

/** Grün: identischer Name ohne .mp3/.wav, Groß/Kleinschreibung egal. */
export function dupFilenamesFullyEqual(a: string, b: string): boolean {
  const sa = stripAudioExtensionForCompare(a).stem;
  const sb = stripAudioExtensionForCompare(b).stem;
  return sa.toLowerCase() === sb.toLowerCase();
}

type AlphanumToken = { ch: string; index: number };

function alphanumTokensWithIndices(filename: string): AlphanumToken[] {
  const { stem } = stripAudioExtensionForCompare(filename);
  const out: AlphanumToken[] = [];
  for (let i = 0; i < stem.length; i++) {
    const ch = stem[i]!;
    if (IGNORED_SEPARATORS.has(ch)) continue;
    if (!isLetterOrDigit(ch)) continue;
    out.push({ ch: ch.toLowerCase(), index: i });
  }
  return out;
}

/**
 * Original-Indizes in `a`, deren Buchstaben/Ziffern (links ausgerichtet, ohne _-(),
 * ohne .mp3/.wav, case-insensitive) mit `b` übereinstimmen — für orange Hervorhebung.
 */
export function dupFilenameMatchIndicesInA(a: string, b: string): Set<number> {
  const ta = alphanumTokensWithIndices(a);
  const tb = alphanumTokensWithIndices(b);
  const out = new Set<number>();
  const n = Math.min(ta.length, tb.length);
  for (let k = 0; k < n; k++) {
    if (ta[k]!.ch === tb[k]!.ch) out.add(ta[k]!.index);
  }
  return out;
}
