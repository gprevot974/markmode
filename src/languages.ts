// How a file is highlighted: markdown as the live preview reads it, other
// files by their language. For the editor and for the pickers' previews.

import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages as allLanguages } from "@codemirror/language-data";
import { LanguageDescription, LanguageSupport, StreamLanguage, type StreamParser } from "@codemirror/language";
import { frontMatterSyntax } from "./preview/frontMatterSyntax.ts";
import { wikiLinkSyntax } from "./preview/wikiLinkSyntax.ts";
import { footnoteSyntax } from "./preview/footnoteSyntax.ts";
import { mathSyntax } from "./preview/math.ts";

type TomlState = { inString: boolean; inArray: number; lhs: boolean };

/**
 * The TOML mode (@codemirror/legacy-modes 6.5.5) starts a quoted string
 * before it notices a new line, so a quoted key (`"ui.statusline" = ...`)
 * right after another key's line is styled as a value. Tell it of the new
 * line first.
 */
export function fixedToml(toml: StreamParser<TomlState>): StreamParser<TomlState> {
  return {
    ...toml,
    token(stream, state) {
      if (stream.sol() && !state.inString && state.inArray === 0) state.lhs = true;
      return toml.token(stream, state);
    },
  };
}

/** The languages of @codemirror/language-data, TOML's fixed. */
const languages = allLanguages.map((l) =>
  l.name !== "TOML"
    ? l
    : LanguageDescription.of({
        name: l.name,
        alias: l.alias,
        extensions: l.extensions,
        filename: l.filename,
        load: () => import("@codemirror/legacy-modes/mode/toml").then((m) => new LanguageSupport(StreamLanguage.define(fixedToml(m.toml as StreamParser<TomlState>)))),
      }),
);

/** Files edited as markdown, with the live preview; others (a style's TOML) are plain text. */
export const isMarkdownPath = (path: string | null) => !path || /\.(?:md|markdown|mdown|mkd)$/i.test(path);

export const proseLanguage = markdown({
  base: markdownLanguage,
  codeLanguages: languages,
  extensions: [frontMatterSyntax, wikiLinkSyntax, footnoteSyntax, mathSyntax],
});

/** Highlighting for the other files, by language name, loaded when such a file is first shown. */
const plainLanguages = new Map<string, LanguageSupport>();

export const languageOf = (path: string) => LanguageDescription.matchFilename(languages, path.split("/").pop() ?? path);

export async function loadLanguage(path: string) {
  const found = languageOf(path);
  if (found && !plainLanguages.has(found.name)) plainLanguages.set(found.name, (await found.load().catch(() => [])) as LanguageSupport);
}

/** The highlighting of a file that is not markdown, once loaded. */
export const plainLanguage = (path: string): LanguageSupport | null => plainLanguages.get(languageOf(path)?.name ?? "") ?? null;
