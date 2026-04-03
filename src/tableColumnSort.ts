/** Sortierrichtung für Tabellenspalten (de-DE, alphanumerisch). */
export type SortDirection = "asc" | "desc";

export function compareSortableStrings(a: string, b: string, direction: SortDirection): number {
  const cmp = a.localeCompare(b, "de", { numeric: true, sensitivity: "base" });
  return direction === "asc" ? cmp : -cmp;
}
