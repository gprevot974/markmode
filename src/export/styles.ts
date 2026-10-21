// Where export styles come from, most specific first:
//
//   <project>/.md-editor/styles/<name>.toml   shared with a project, in its repository
//   ~/.config/md-editor/styles/<name>.toml    your own
//   the built-in ones (style.ts)
//
// A style named in a more specific place hides one of the same name further
// down; a style inheriting its own name extends the one it hides. Which style
// a document gets: its front matter's `style:`, else `[export] style` in the
// project's or your config.toml (next to styles/), else "default".

import { parse as parseToml } from "smol-toml";
import { BUILT_IN, defaultStyle, parseStyleFile, type ExportStyle } from "./style.ts";

/** How styles are read: through the backend in the app, from disk on the command line. */
export interface StyleFs {
  /** A file's text; null when there is none. */
  read(path: string): Promise<string | null>;
  /** The names of the files in a directory; empty when there is none. */
  list(dir: string): Promise<string[]>;
}

export type StyleScope = "project" | "user" | "built-in";

/** The directories holding a config.toml and styles/: `.md-editor` and `~/.config/md-editor`. */
export interface StyleDirs {
  project: string | null;
  user: string | null;
}

export interface StyleEntry {
  name: string;
  scope: StyleScope;
  /** The file; null for a built-in style. */
  path: string | null;
  description: string;
}

const layers = (dirs: StyleDirs): { scope: StyleScope; dir: string | null }[] => [
  ...(dirs.project ? [{ scope: "project" as const, dir: dirs.project }] : []),
  ...(dirs.user ? [{ scope: "user" as const, dir: dirs.user }] : []),
  { scope: "built-in", dir: null },
];

export const stylePath = (dir: string, name: string) => `${dir}/styles/${name}.toml`;

/** Every style there is, each name once: the most specific one. */
export async function listStyles(fs: StyleFs, dirs: StyleDirs): Promise<StyleEntry[]> {
  const out = new Map<string, StyleEntry>();
  for (const { scope, dir } of layers(dirs)) {
    if (!dir) {
      for (const [name, { doc }] of Object.entries(BUILT_IN)) {
        if (!out.has(name)) out.set(name, { name, scope, path: null, description: doc });
      }
      continue;
    }
    for (const file of (await fs.list(`${dir}/styles`)).sort()) {
      const name = file.replace(/\.toml$/, "");
      if (name === file || out.has(name)) continue;
      const text = await fs.read(stylePath(dir, name));
      const description = text === null ? "" : (parseStyleFile(text).description ?? "");
      out.set(name, { name, scope, path: stylePath(dir, name), description });
    }
  }
  return [...out.values()];
}

export interface Resolved {
  style: ExportStyle;
  /** What is wrong in the files read, by file name. */
  errors: string[];
  found: boolean;
  /** The file of the style named, if it has one. */
  path: string | null;
}

/** The style called `name`, with what it inherits. */
export async function resolveStyle(name: string, fs: StyleFs, dirs: StyleDirs): Promise<Resolved> {
  const all = layers(dirs);
  const errors: string[] = [];
  let path: string | null = null;

  async function resolve(name: string, from: number, depth: number): Promise<ExportStyle | null> {
    if (depth > 10) {
      errors.push(`${name}: inherits in a loop`);
      return defaultStyle();
    }
    for (let k = from; k < all.length; k++) {
      const { dir } = all[k];
      if (!dir) {
        const built = BUILT_IN[name];
        if (!built) return null;
        return { ...defaultStyle(), ...built.keys } as ExportStyle;
      }
      const file = stylePath(dir, name);
      const text = await fs.read(file);
      if (text === null) continue;
      if (depth === 0) path = file;
      const parsed = parseStyleFile(text);
      errors.push(...parsed.errors.map((e) => `${name}.toml: ${e}`));
      const parent = parsed.inherits ?? "default";
      // Inheriting its own name extends the style this one hides.
      const base = await resolve(parent, parent === name ? k + 1 : 0, depth + 1);
      if (!base) errors.push(`${name}.toml: no style named ${parent} to inherit`);
      return { ...(base ?? defaultStyle()), ...parsed.keys } as ExportStyle;
    }
    return null;
  }

  const style = await resolve(name, 0, 0);
  return { style: style ?? defaultStyle(), errors, found: !!style, path };
}

/** The style a document without `style:` gets: `[export] style` in config.toml, project first. */
export async function configuredStyle(fs: StyleFs, dirs: StyleDirs): Promise<string> {
  for (const { dir } of layers(dirs)) {
    if (!dir) break;
    const text = await fs.read(`${dir}/config.toml`);
    if (text === null) continue;
    try {
      const exp = (parseToml(text) as Record<string, unknown>).export as Record<string, unknown> | undefined;
      if (typeof exp?.style === "string") return exp.style;
    } catch {
      // A broken config.toml counts as none; opening it shows why.
    }
  }
  return "default";
}

/** config.toml's text with `[export] style` set, touching nothing else in it. */
export function setConfiguredStyle(text: string, name: string): string {
  const line = `style = ${JSON.stringify(name)}`;
  const lines = text.split("\n");
  const start = lines.findIndex((l) => /^\s*\[export\]\s*(#.*)?$/.test(l));
  if (start === -1) return `${text.replace(/\n*$/, text ? "\n\n" : "")}[export]\n${line}\n`;
  for (let i = start + 1; i < lines.length && !/^\s*\[/.test(lines[i]); i++) {
    if (/^\s*style\s*=/.test(lines[i])) {
      lines[i] = line;
      return lines.join("\n");
    }
  }
  lines.splice(start + 1, 0, line);
  return lines.join("\n");
}
