// Light or dark: "auto" follows the macOS appearance. A choice made with
// `:theme` is remembered on this machine and wins over config.ts.

import { backend } from "../backend.ts";

export type ThemeSetting = "auto" | "light" | "dark";
export const themeSettings: ThemeSetting[] = ["auto", "light", "dark"];

const KEY = "md-editor.theme";
const systemLight = matchMedia("(prefers-color-scheme: light)");
let setting: ThemeSetting = "auto";

function stored(): ThemeSetting | null {
  try {
    const value = localStorage.getItem(KEY);
    return themeSettings.includes(value as ThemeSetting) ? (value as ThemeSetting) : null;
  } catch {
    return null;
  }
}

function apply() {
  const light = setting === "light" || (setting === "auto" && systemLight.matches);
  document.documentElement.dataset.theme = light ? "light" : "dark";
  // The title bar is transparent over the window, so it takes the theme's
  // background. Pinning its appearance only when the theme is pinned keeps
  // "auto" listening to the system.
  const background = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
  void backend.setAppearance(setting === "auto" ? null : setting, background).catch(() => {});
}

export function initTheme(fallback: ThemeSetting) {
  setting = stored() ?? fallback;
  apply();
  systemLight.addEventListener("change", apply);
}

export function setTheme(value: ThemeSetting) {
  setting = value;
  try {
    localStorage.setItem(KEY, value);
  } catch {
    // Not remembered, but still applied.
  }
  apply();
}

export const currentTheme = () => setting;
