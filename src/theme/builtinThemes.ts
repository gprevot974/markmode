// Helix themes that ship with the app, so `:theme entre-deux` works without a
// file in ~/.config/helix/themes. A file of the same name there wins.

import { parse as parseToml } from "smol-toml";
import entreDeux from "./themes/entre-deux.toml?raw";
import entreDeuxDark from "./themes/entre-deux-dark.toml?raw";
import entreDeuxLight from "./themes/entre-deux-light.toml?raw";
import plaineDesSables from "./themes/plaine-des-sables.toml?raw";
import plaineDesSablesDark from "./themes/plaine-des-sables-dark.toml?raw";

const sources: Record<string, string> = {
  "entre-deux": entreDeux,
  "entre-deux-dark": entreDeuxDark,
  "entre-deux-light": entreDeuxLight,
  "plaine-des-sables": plaineDesSables,
  "plaine-des-sables-dark": plaineDesSablesDark,
};

export const builtinThemeNames = Object.keys(sources);

/** A shipped theme's table, or undefined when `name` is not one. */
export function builtinTheme(name: string): Record<string, unknown> | undefined {
  return name in sources ? parseToml(sources[name]) : undefined;
}
