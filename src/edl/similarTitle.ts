/**
 * Vergleich von Reel-/Dateinamen: gekürzte vs. ausführliche Schreibweise derselben Quelle.
 */

function lettersDigitsOnly(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function longestCommonPrefixLen(a: string, b: string): number {
  const m = Math.min(a.length, b.length);
  let i = 0;
  while (i < m && a[i] === b[i]) i++;
  return i;
}

const MIN_PREFIX_CHARS = 10;
const MIN_LCP_RATIO = 0.88;

/**
 * Prüft, ob zwei Anzeigenamen sehr wahrscheinlich dieselbe Tonquelle meinen
 * (z. B. gekürztes Reel vs. vollständiger Dateiname).
 */
export function titlesLikelySame(a: string, b: string): boolean {
  const ta = a.trim();
  const tb = b.trim();
  if (!ta || !tb) return false;
  if (ta === tb) return true;
  if (ta.toLowerCase() === tb.toLowerCase()) return true;

  const na = lettersDigitsOnly(ta);
  const nb = lettersDigitsOnly(tb);
  if (!na || !nb) return false;
  if (na === nb) return true;

  const short = na.length <= nb.length ? na : nb;
  const long = na.length > nb.length ? na : nb;

  if (short.length >= MIN_PREFIX_CHARS && long.startsWith(short)) return true;

  const lcp = longestCommonPrefixLen(na, nb);
  const denom = Math.min(na.length, nb.length);
  if (denom >= MIN_PREFIX_CHARS && lcp / denom >= MIN_LCP_RATIO) return true;

  if (long.includes(short) && short.length >= MIN_PREFIX_CHARS) return true;

  return false;
}

/** Bevorzugt den ausführlicheren / lesbareren Titel. */
export function pickRicherTitle(a: string, b: string): string {
  const ta = a.trim();
  const tb = b.trim();
  if (tb.length > ta.length) return tb;
  if (ta.length > tb.length) return ta;
  const score = (t: string) =>
    (t.includes(".mp3") || t.includes(".wav") || t.includes(".m4a") ? 2 : 0) +
    (t.includes(" ") ? 1 : 0);
  if (score(tb) > score(ta)) return tb;
  if (score(ta) > score(tb)) return ta;
  return ta;
}
