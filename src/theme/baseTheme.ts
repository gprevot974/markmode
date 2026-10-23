// The base theme: Entre-Deux's variables, set in index.html at build time
// (vite.config.ts) so the first paint has them, and kept under every other
// theme for the variables it has no color for.

import { parse as parseToml } from "smol-toml";
import { parseTheme, themeCss, themeVariableNames, themeVariables } from "./helixTheme.ts";

/** The base theme's CSS, from the dark and light Entre-Deux files; throws when one leaves a variable unset. */
export function baseThemeCss(dark: string, light: string): string {
  const css = (selector: string, source: string, name: string) => {
    const vars = themeVariables(parseTheme(parseToml(source)));
    const missing = themeVariableNames.filter((v) => !vars[v]);
    if (missing.length) throw new Error(`${name} sets no color for ${missing.join(", ")}`);
    return themeCss(selector, vars);
  };
  return css(":root", dark, "entre-deux") + css(':root[data-theme="light"]', light, "entre-deux-light");
}
