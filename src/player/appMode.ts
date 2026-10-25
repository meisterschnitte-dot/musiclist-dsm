const LS_KEY = "musiclist-app-mode-v1";

/** Zwei Arbeitsflächen, gleiche Anmeldung. */
export type AppMode = "musiclist" | "player";

export function loadAppMode(): AppMode {
  try {
    const v = localStorage.getItem(LS_KEY);
    if (v === "player" || v === "musiclist") return v;
  } catch {
    /* ignore */
  }
  return "musiclist";
}

export function saveAppMode(mode: AppMode): void {
  try {
    localStorage.setItem(LS_KEY, mode);
  } catch {
    /* ignore */
  }
}
