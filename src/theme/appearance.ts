// The theme: the built-in Kanagawa, light or dark ("auto" follows the macOS
// appearance), or any Helix theme by name. Helix's own `kanagawa` is the dark
// half of the built-in one, so that name means the built-in, which also has a
// light half. A choice made with `:theme` is remembered on this machine and
// wins over the Helix config.

import { backend } from "../backend.ts";
import { loadTheme, parseTheme, themeVariables, type Theme } from "./helixTheme.ts";

/** A theme name, or one theme for each system appearance (Helix's `{ light, dark }`). */
export type ThemeChoice = string | { light: string; dark: string };

const BUILTIN: Record<string, "auto" | "light" | "dark"> = {
  auto: "auto",
  kanagawa: "auto",
  light: "light",
  dark: "dark",
};

const KEY = "md-editor.theme";
/** The last Helix theme's variables, for index.html to set before the first paint. */
const VARS_KEY = "md-editor.theme-vars";
const systemLight = matchMedia("(prefers-color-scheme: light)");

let choice: ThemeChoice = "auto";
/** A theme shown while it is being picked in `:theme`, not yet chosen. */
let preview: string | null = null;
let generation = 0;
const themes = new Map<string, Theme>();

function storage(op: (s: Storage) => void) {
  try {
    op(localStorage);
  } catch {
    // Not remembered, but still applied.
  }
}

async function helixTheme(name: string): Promise<Theme> {
  let theme = themes.get(name);
  if (!theme) {
    theme = parseTheme(await loadTheme(name, (n) => backend.helixTheme(n)));
    themes.set(name, theme);
  }
  return theme;
}

async function apply() {
  const gen = ++generation;
  const systemIsLight = systemLight.matches;
  const shown = preview ?? choice;
  const name = typeof shown === "string" ? shown : systemIsLight ? shown.light : shown.dark;
  const builtin = BUILTIN[name];
  let light: boolean;
  let vars: Record<string, string> = {};
  if (builtin) light = builtin === "light" || (builtin === "auto" && systemIsLight);
  else {
    const theme = await helixTheme(name);
    if (gen !== generation) return;
    light = theme.light;
    vars = themeVariables(theme);
  }
  const root = document.documentElement;
  // Including the ones index.html set for the first paint.
  for (const v of [...root.style].filter((p) => p.startsWith("--"))) root.style.removeProperty(v);
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  root.dataset.theme = light ? "light" : "dark";
  if (!preview) storage((s) => (builtin ? s.removeItem(VARS_KEY) : s.setItem(VARS_KEY, JSON.stringify({ light, vars }))));
  // The title bar is transparent over the window, so it takes the theme's
  // background. Its text follows the system only while the theme does.
  const followsSystem = builtin === "auto" || typeof shown !== "string";
  const background = getComputedStyle(root).getPropertyValue("--bg").trim();
  void backend.setAppearance(followsSystem ? null : light ? "light" : "dark", background).catch(() => {});
}

/** Applies the remembered theme, else `fallback`; returns an error to show, if any. */
export async function initTheme(fallback: ThemeChoice): Promise<string | null> {
  let stored: string | null = null;
  storage((s) => (stored = s.getItem(KEY)));
  choice = stored ?? fallback;
  systemLight.addEventListener("change", () => void apply().catch(() => {}));
  try {
    await apply();
    return null;
  } catch (err) {
    choice = "auto";
    await apply();
    return `theme: ${err}`;
  }
}

export async function setTheme(name: string) {
  const previous = choice;
  choice = name;
  preview = null;
  try {
    await apply();
  } catch (err) {
    // Back to the previous theme, also over a preview that was showing.
    choice = previous;
    await apply().catch(() => {});
    throw err;
  }
  storage((s) => s.setItem(KEY, name));
}

/** Shows a theme without choosing it; a name that is not a theme (yet) changes nothing. */
export function previewTheme(name: string) {
  if (name === preview) return;
  const previous = preview;
  preview = name;
  apply().catch(() => {
    if (preview === name) preview = previous;
  });
}

/** Back to the chosen theme, after `:theme` was left or run. */
export function endThemePreview() {
  if (preview === null) return;
  preview = null;
  void apply().catch(() => {});
}

export function currentTheme(): string {
  return typeof choice === "string" ? choice : `${choice.light} (light), ${choice.dark} (dark)`;
}

/** For completion: the built-in names, then every Helix theme found. */
export async function themeNames(): Promise<string[]> {
  const helix = await backend.helixThemes().catch(() => []);
  return [...Object.keys(BUILTIN), ...helix.filter((n) => !(n in BUILTIN))];
}
