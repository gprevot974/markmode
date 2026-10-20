// Version history, as the picker shows it: each version kept of the file
// (see src-tauri/src/history.rs), with a preview of what changed since.

import type { Snapshot } from "./backend.ts";
import type { Preview } from "./ui/picker.ts";
import { lineChanges } from "./diff.ts";

const KINDS: Record<Snapshot["kind"], string> = {
  opened: "opened",
  saved: "saved",
  outside: "changed on disk",
};

const pad = (n: number) => String(n).padStart(2, "0");

export function describeSnapshot(s: Snapshot, now = Date.now()): string {
  const d = new Date(s.time);
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  return `${date}  ${KINDS[s.kind] ?? s.kind.padEnd(15)}  ${ago(now - s.time)}`;
}

function ago(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hours = Math.round(min / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

const CONTEXT = 2;

const linesOf = (text: string) => (text.endsWith("\n") ? text.slice(0, -1) : text).split("\n");

/** What changed from `old` to `now`, as diff lines with a little context around each change. */
export function diffPreview(old: string, now: string): Preview {
  const a = linesOf(old);
  const b = linesOf(now);
  const changes = lineChanges(a, b);
  if (!changes.length) return { text: "same as the current text", classes: ["pk-head"] };
  const lines: string[] = [];
  const classes: string[] = [];
  const push = (text: string, cls: string) => {
    lines.push(text);
    classes.push(cls);
  };
  let added = 0;
  let removed = 0;
  // Lines of `now` before this one are shown.
  let shown = 0;
  changes.forEach((c, i) => {
    const from = Math.max(shown, c.b0 - CONTEXT);
    if (from > shown) push("⋯", "pk-skip");
    for (let n = from; n < c.b0; n++) push(b[n], "");
    for (let n = c.a0; n < c.a1; n++) push(a[n], "pk-del");
    for (let n = c.b0; n < c.b1; n++) push(b[n], "pk-add");
    removed += c.a1 - c.a0;
    added += c.b1 - c.b0;
    const until = Math.min(c.b1 + CONTEXT, changes[i + 1]?.b0 ?? b.length);
    for (let n = c.b1; n < until; n++) push(b[n], "");
    shown = until;
  });
  if (shown < b.length) push("⋯", "pk-skip");
  const places = `${changes.length} place${changes.length > 1 ? "s" : ""}`;
  const head = `changes since this version: ${places}, −${removed} +${added} line${removed + added > 1 ? "s" : ""}`;
  return { text: [head, ...lines].join("\n"), classes: ["pk-head", ...classes] };
}
