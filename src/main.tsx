import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { loadFontScale } from "./storage/fontScaleStorage";
import "./App.css";

document.documentElement.style.setProperty("--app-font-scale", String(loadFontScale()));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
