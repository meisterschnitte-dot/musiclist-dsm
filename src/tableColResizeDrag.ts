/**
 * Spaltenbreite per Maus: während des Zugs nur <col>-Styles setzen (kein React-Re-Render pro Pixel).
 * Beim Loslassen einmal `onCommit` — wichtig bei sehr langen Tabellen (z. B. GVL).
 */
export function startColumnResizeDrag(options: {
  colIndex: number;
  clientX: number;
  startWidths: number[];
  minForIndex: (i: number) => number;
  getColElements: () => HTMLCollection | HTMLTableColElement[] | null | undefined;
  onCommit: (nextWidths: number[]) => void;
}): void {
  const { colIndex, clientX: startX, startWidths, minForIndex, getColElements, onCommit } = options;
  const startW = startWidths[colIndex];
  const current = [...startWidths];
  document.body.style.userSelect = "none";

  const applyWidthsToDom = () => {
    const cols = getColElements();
    if (!cols) return;
    const n = cols.length;
    for (let i = 0; i < n; i++) {
      const el = cols[i] as HTMLTableColElement;
      if (el?.style) {
        const px = `${current[i]}px`;
        el.style.width = px;
        el.style.minWidth = "0";
      }
    }
  };

  const onMove = (ev: MouseEvent) => {
    const minW = minForIndex(colIndex);
    const w = Math.max(minW, startW + ev.clientX - startX);
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
