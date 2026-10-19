// Helix themes, turned into the CSS variables the editor is styled with.
// A theme maps scopes ("ui.background", "markup.heading.1", "keyword") to a
// color or to a style ({ fg, bg, modifiers }); colors are "#rrggbb", a name
// from the theme's [palette], or one of the terminal's named colors. A theme
// can build on another with `inherits = "name"`.

type Table = Record<string, unknown>;

interface Style {
  fg?: string;
  bg?: string;
}

export interface Theme {
  scopes: Map<string, Style>;
  /** Whether the background is light, for the title bar and `color-scheme`. */
  light: boolean;
}

// The terminal palette Helix falls back on, with xterm's values.
const NAMED: Record<string, string> = {
  black: "#000000",
  red: "#cd0000",
  green: "#00cd00",
  yellow: "#cdcd00",
  blue: "#0000ee",
  magenta: "#cd00cd",
  cyan: "#00cdcd",
  gray: "#7f7f7f",
  "light-red": "#ff0000",
  "light-green": "#00ff00",
  "light-yellow": "#ffff00",
  "light-blue": "#5c5cff",
  "light-magenta": "#ff00ff",
  "light-cyan": "#00ffff",
  "light-gray": "#e5e5e5",
  white: "#ffffff",
};

const STYLE_KEYS = new Set(["fg", "bg", "modifiers", "underline"]);

/** Loads a theme and the ones it inherits from, child entries winning. */
export async function loadTheme(name: string, read: (name: string) => Promise<Table>): Promise<Table> {
  const chain: Table[] = [];
  const seen = new Set<string>();
  for (let next: string | undefined = name; next; ) {
    if (seen.has(next)) throw new Error(`theme ${name}: inherits from itself`);
    seen.add(next);
    const table = await read(next);
    chain.unshift(table);
    next = typeof table.inherits === "string" ? table.inherits : undefined;
  }
  const merged: Table = {};
  const palette: Table = {};
  for (const table of chain) {
    Object.assign(merged, table);
    Object.assign(palette, table.palette ?? {});
  }
  merged.palette = palette;
  delete merged.inherits;
  return merged;
}

export function parseTheme(table: Table): Theme {
  const palette = (table.palette ?? {}) as Record<string, string>;
  const color = (value: unknown): string | undefined => {
    if (typeof value !== "string") return undefined;
    const c = palette[value] ?? NAMED[value] ?? value;
    return /^#[0-9a-f]{6}$/i.test(c) ? c.toLowerCase() : undefined;
  };
  const scopes = new Map<string, Style>();
  const add = (scope: string, value: unknown) => {
    if (typeof value === "string") scopes.set(scope, { fg: color(value) });
    else if (value && typeof value === "object") {
      const v = value as Table;
      // Unquoted dotted keys (ui.text = ...) come out of TOML as nested tables.
      if (!Object.keys(v).some((k) => STYLE_KEYS.has(k))) {
        for (const [k, sub] of Object.entries(v)) add(`${scope}.${k}`, sub);
      } else scopes.set(scope, { fg: color(v.fg), bg: color(v.bg) });
    }
  };
  for (const [scope, value] of Object.entries(table)) {
    if (scope !== "palette" && scope !== "inherits") add(scope, value);
  }
  const bg = scopes.get("ui.background")?.bg;
  return { scopes, light: bg ? luminance(bg) > 0.5 : false };
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

type Source = [scope: string, attr: keyof Style];

// Each variable takes the first of its sources the theme defines. Variables
// with none keep the built-in value, so a sparse theme still looks complete.
const ROLES: Record<string, Source[]> = {
  "--bg": [["ui.background", "bg"]],
  "--fg": [["ui.text", "fg"], ["ui.background", "fg"]],
  "--bg-dim": [["ui.statusline", "bg"], ["ui.popup", "bg"], ["ui.menu", "bg"]],
  "--fg-dim": [["comment", "fg"], ["ui.virtual", "fg"], ["ui.linenr", "fg"]],
  "--fg-muted": [["ui.statusline", "fg"], ["ui.text", "fg"]],
  "--cursorline": [["ui.cursorline.primary", "bg"], ["ui.cursorline", "bg"], ["ui.background", "bg"]],
  "--sel": [["ui.selection", "bg"]],
  "--sel-primary": [["ui.selection.primary", "bg"], ["ui.selection", "bg"]],
  "--gutter": [["ui.linenr", "fg"]],
  "--gutter-active": [["ui.linenr.selected", "fg"], ["ui.linenr", "fg"]],
  "--blue": [["ui.statusline.normal", "bg"], ["function", "fg"]],
  "--autumn-green": [["ui.statusline.insert", "bg"], ["diff.plus", "fg"], ["string", "fg"]],
  "--violet": [["ui.statusline.select", "bg"], ["keyword", "fg"]],
  "--red": [["ui.virtual.jump-label", "fg"], ["error", "fg"], ["diff.minus", "fg"]],
  "--orange": [["constant", "fg"], ["warning", "fg"]],
  "--yellow": [["variable.other.member", "fg"], ["warning", "fg"]],
  "--green": [["string", "fg"]],
  "--aqua": [["type", "fg"]],
  "--pink": [["constant.numeric", "fg"], ["constant", "fg"]],
  "--spring-blue": [["markup.link.text", "fg"], ["string.special.url", "fg"], ["label", "fg"]],
  "--spring-violet": [["markup.quote", "fg"], ["punctuation", "fg"]],
  "--boat-yellow": [["operator", "fg"]],
  // The preview, from the markup scopes when the theme has them.
  "--h1": [["markup.heading.1", "fg"], ["markup.heading", "fg"]],
  "--h2": [["markup.heading.2", "fg"], ["markup.heading", "fg"]],
  "--h3": [["markup.heading.3", "fg"], ["markup.heading", "fg"]],
  "--h4": [["markup.heading.4", "fg"], ["markup.heading", "fg"]],
  "--strong": [["markup.bold", "fg"]],
  "--em": [["markup.italic", "fg"]],
  "--code": [["markup.raw.inline", "fg"], ["markup.raw", "fg"]],
  "--link": [["markup.link.text", "fg"], ["markup.link.url", "fg"]],
  "--list": [["markup.list", "fg"]],
  "--quote": [["markup.quote", "fg"]],
};

/** The CSS variables for a theme. Colors derived from others use color-mix(). */
export function themeVariables(theme: Theme): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const [name, sources] of Object.entries(ROLES)) {
    for (const [scope, attr] of sources) {
      const c = theme.scopes.get(scope)?.[attr];
      if (c) {
        vars[name] = c;
        break;
      }
    }
  }
  // Built from the theme's own colors rather than left at the built-in ones,
  // which would clash.
  const mix = (a: string, b: string, pct: number) => `color-mix(in srgb, ${a} ${pct}%, ${b})`;
  if (vars["--bg"] && vars["--fg"]) {
    vars["--bg-line"] = mix("var(--fg)", "var(--bg)", 8);
    vars["--bg-raised"] = mix("var(--fg)", "var(--bg)", 16);
    vars["--bg-dim"] ??= mix("var(--bg)", "black", theme.light ? 94 : 70);
  }
  if (vars["--sel-primary"]) {
    vars["--sel"] ??= mix("var(--sel-primary)", "var(--bg)", 60);
    vars["--sel-select"] = mix("var(--sel)", "var(--violet)", 75);
    vars["--sel-select-primary"] = mix("var(--sel-primary)", "var(--violet)", 70);
  }
  return vars;
}
