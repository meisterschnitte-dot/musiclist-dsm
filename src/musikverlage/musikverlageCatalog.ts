/**
 * Musikverlage wie die Portal-Buttons unter „Tags bearbeiten“ (ohne GVL-Rechte).
 * IDs sind stabil für Konfiguration und Dateiablage auf dem Server.
 */
export const MUSIKVERLAGE_CATALOG = [
  {
    id: "p7s1",
    label: "P7S1 Musikportal",
    hint: "ProSiebenSat.1 Track Research — wie Button im Tag-Editor.",
  },
  {
    id: "apple",
    label: "Apple Music",
    hint: "Apple Music Suche — wie Button im Tag-Editor.",
  },
  {
    id: "upm",
    label: "UPM (Universal Production Music)",
    hint: "UPM-Suche — wie Button im Tag-Editor.",
  },
  {
    id: "bmgpm",
    label: "BMG Production Music",
    hint: "BMGPM-Suche — wie Button im Tag-Editor.",
  },
  {
    id: "sonoton",
    label: "Sonoton",
    hint: "Sonoton-Suche — wie Button im Tag-Editor.",
  },
  {
    id: "extreme",
    label: "Extreme Music",
    hint: "Extreme-Suche — wie Button im Tag-Editor.",
  },
  {
    id: "earmotion",
    label: "Earmotion",
    hint: "Earmotion-Suche — wie Button im Tag-Editor.",
  },
  {
    id: "blankframe",
    label: "Blankframe",
    hint: "Blankframe (Website/API) — wie Button im Tag-Editor.",
  },
  {
    id: "wcpm",
    label: "Warner Chappell Production Music (WCPM)",
    hint: "Excel hochladen → SQLite-Index; im Tag-Editor „WCPM“: Treffer per Dateiname (FILENAME, .wav/.mp3 egal).",
  },
] as const;

export type MusikverlagId = (typeof MUSIKVERLAGE_CATALOG)[number]["id"];

export const MUSIKVERLAG_IDS: MusikverlagId[] = MUSIKVERLAGE_CATALOG.map((x) => x.id);

export function isMusikverlagId(s: string): s is MusikverlagId {
  return (MUSIKVERLAG_IDS as string[]).includes(s);
}
