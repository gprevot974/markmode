// How a file is highlighted: markdown as the live preview reads it, other
// files by their language. For the editor and for the pickers' previews.

import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { LanguageDescription, type LanguageSupport } from "@codemirror/language";
import { frontMatterSyntax } from "./preview/frontMatterSyntax.ts";
import { wikiLinkSyntax } from "./preview/wikiLinkSyntax.ts";
import { footnoteSyntax } from "./preview/footnoteSyntax.ts";
import { mathSyntax } from "./preview/math.ts";

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
