// Setting one key in a config.toml as written, keeping its comments and
// layout: for the commands that change your settings (`:export-style-default`,
// `:hints`).

/**
 * `text` with `key = value` (a TOML literal) under `[table]`: on the key's
 * line, else on its commented-out one (as the settings template has them),
 * else first in the table; a missing table is added at the end.
 */
export function setTomlKey(text: string, table: string, key: string, value: string): string {
  const line = `${key} = ${value}`;
  const lines = text.split("\n");
  const start = lines.findIndex((l) => /^\s*\[([^\]]*)\]\s*(#.*)?$/.exec(l)?.[1].trim() === table);
  if (start === -1) return `${text.replace(/\n*$/, text ? "\n\n" : "")}[${table}]\n${line}\n`;
  let end = start + 1;
  while (end < lines.length && !/^\s*\[/.test(lines[end])) end++;
  const find = (re: RegExp) => lines.slice(start + 1, end).findIndex((l) => re.test(l));
  let at = find(new RegExp(`^\\s*${key}\\s*=`));
  if (at < 0) at = find(new RegExp(`^\\s*#\\s*${key}\\s*=`));
  if (at < 0) lines.splice(start + 1, 0, line);
  else lines[start + 1 + at] = line;
  return lines.join("\n");
}
