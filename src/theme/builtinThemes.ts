// Helix themes that ship with the app, so `:theme entre-deux` works without a
// file in ~/.config/helix/themes. A file of the same name there wins.

import { parse as parseToml } from "smol-toml";
import entreDeux from "./themes/entre-deux.toml?raw";
import entreDeuxLight from "./themes/entre-deux-light.toml?raw";
import kanagawaLotus from "./themes/kanagawa-lotus.toml?raw";
import kanagawaWave from "./themes/kanagawa-wave.toml?raw";
import plaineDesSables from "./themes/plaine-des-sables.toml?raw";
import plaineDesSablesLight from "./themes/plaine-des-sables-light.toml?raw";

const sources: Record<string, string> = {
  "entre-deux": entreDeux,
  "entre-deux-light": entreDeuxLight,
  "kanagawa-lotus": kanagawaLotus,
  "kanagawa-wave": kanagawaWave,
  "plaine-des-sables": plaineDesSables,
  "plaine-des-sables-light": plaineDesSablesLight,
};

export const builtinThemeNames = Object.keys(sources);

/** A shipped theme's table, or undefined when `name` is not one. */
export function builtinTheme(name: string): Record<string, unknown> | undefined {
  return name in sources ? parseToml(sources[name]) : undefined;
}
