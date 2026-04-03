/**
 * Spaltenbreite per Maus: während des Zugs nur <col>-Styles setzen (kein React-Re-Render pro Pixel).
 * Beim Loslassen einmal `onCommit` — wichtig bei sehr langen Tabellen (z. B. GVL).
 */
export function startColumnResizeDrag(options: {
  colIndex: number;
  clientX: number;
  startWidths: number[];
  minForIndex: (i: number) => number;
  /** Optional upper bound per column (e.g. schmale #/TC-Spalten). */
  maxForIndex?: (i: number) => number;
  /**
   * Letzte Spalte `width: auto` + `min-width` in px — nimmt Restbreite der Tabelle,
   * statt dass überschüssiger Platz (table-layout:fixed, width:100%) oft die erste Spalte aufbläht.
   */
  lastColumnAuto?: boolean;
  getColElements: () => HTMLCollection | HTMLTableColElement[] | null | undefined;
  onCommit: (nextWidths: number[]) => void;
}): void {
  const {
    colIndex,
    clientX: startX,
    startWidths,
    minForIndex,
    maxForIndex,
    lastColumnAuto,
    getColElements,
    onCommit,
  } = options;
  const startW = startWidths[colIndex];
  const current = [...startWidths];
  document.body.style.userSelect = "none";

  const applyWidthsToDom = () => {
    const cols = getColElements();
    if (!cols) return;
    const n = cols.length;
    const last = n - 1;
    for (let i = 0; i < n; i++) {
      const el = cols[i] as HTMLTableColElement;
      if (el?.style) {
        if (lastColumnAuto && i === last) {
          el.style.width = "auto";
          el.style.minWidth = `${current[i]}px`;
        } else {
          el.style.width = `${current[i]}px`;
          el.style.minWidth = "0";
        }
      }
    }
  };

  const onMove = (ev: MouseEvent) => {
    const minW = minForIndex(colIndex);
    const maxW = maxForIndex ? maxForIndex(colIndex) : Number.POSITIVE_INFINITY;
    const w = Math.min(maxW, Math.max(minW, startW + ev.clientX - startX));
    current[colIndex] = w;
    applyWidthsToDom();
  };

  const onUp = () => {
    document.body.style.userSelect = "";
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
    onCommit([...current]);
  };

  applyWidthsToDom();
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
}
