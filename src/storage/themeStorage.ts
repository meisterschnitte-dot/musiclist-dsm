const LS_KEY = "musiclist-app-theme-v1";

export type AppTheme = "dark" | "light";

export function loadTheme(): AppTheme {
  try {
    const v = localStorage.getItem(LS_KEY);
    if (v === "light" || v === "dark") return v;
  } catch {
    /* ignore */
  }
  return "dark";
}

export function saveTheme(t: AppTheme): void {
  try {
    localStorage.setItem(LS_KEY, t);
  } catch {
    /* ignore */
  }
}
