import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { loadFontScale } from "./storage/fontScaleStorage";
import { loadTheme } from "./storage/themeStorage";
import "./App.css";

document.documentElement.style.setProperty("--app-font-scale", String(loadFontScale()));
document.documentElement.setAttribute("data-theme", loadTheme());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
