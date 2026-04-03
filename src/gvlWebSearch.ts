import type { GvlLabelEntry } from "./storage/gvlLabelStore";

/** Suchanfrage wie manuell: Labelcode, Name, Hersteller + typische Begriffe (Vermutung, kein Treffer-Garant). */
export function buildGvlWebGuessSearchUrl(entry: GvlLabelEntry): string {
  const parts = [entry.labelcode, entry.label, entry.hersteller]
    .map((s) => s.trim())
    .filter(Boolean);
  const q = (parts.length ? `${parts.join(" ")} ` : "") + "Webseite Homepage";
  return `https://www.google.com/search?q=${encodeURIComponent(q.trim())}&hl=de`;
}

export function openGvlWebGuessSearch(entry: GvlLabelEntry): void {
  window.open(buildGvlWebGuessSearchUrl(entry), "_blank", "noopener,noreferrer");
}
