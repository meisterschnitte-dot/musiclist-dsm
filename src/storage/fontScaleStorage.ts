const LS_KEY = "musiclist-app-font-scale-v1";

export const FONT_SCALE_MIN = 0.75;
export const FONT_SCALE_MAX = 1.5;
export const FONT_SCALE_STEP = 0.05;
export const FONT_SCALE_DEFAULT = 1;

export function clampFontScale(n: number): number {
  const s = FONT_SCALE_STEP;
  const c = Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, Math.round(n / s) * s));
  return Number(c.toFixed(2));
}

export function loadFontScale(): number {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw == null) return FONT_SCALE_DEFAULT;
    const n = Number.parseFloat(raw);
    if (!Number.isFinite(n)) return FONT_SCALE_DEFAULT;
    return clampFontScale(n);
  } catch {
    return FONT_SCALE_DEFAULT;
  }
}

export function saveFontScale(n: number): void {
  try {
    localStorage.setItem(LS_KEY, String(clampFontScale(n)));
  } catch {
    /* ignore */
  }
}
