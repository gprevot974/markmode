// Records the README's GIF (docs/demo.gif): the editor in Chrome against the
// in-memory backend, played with real key presses, the keys shown as they are
// typed. Each step is a screenshot held for as long as it should show, so the
// text stays sharp and the file small.
//
//   node scripts/demo-gif.ts [output.gif]
//
// Needs Chrome (or CHROME_PATH) and ffmpeg.

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const output = process.argv[2] ?? new URL("../docs/demo.gif", import.meta.url).pathname;
const WIDTH = 900;
const HEIGHT = 680;

const DRAFT = `# Launch notes

The beta opens to everyone on Monday. Please read the guide before you start, and report anything odd.

## What changed

- Sync is three times faster
- Notes work offline
- Export to Word keeps your styles

Questions go to the beta channel.
`;

// The agent's answer to the comment: the paragraph rewritten, the comment
// gone, a line added.
const AGENT = `# Launch notes

From Monday, everyone can join! Skim our quick-start first, then tell us whatever feels off: we read it all.

## What changed

- Sync is three times faster
- Notes work offline, on every device
- Export to Word keeps your styles

Questions go to the beta channel, where the team answers within a day.
`;

const frames = mkdtempSync(join(tmpdir(), "markmode-demo-"));
const durations: number[] = [];

const server = await createServer({ server: { port: 0, strictPort: false }, logLevel: "error" });
await server.listen();
const executablePath = process.env.CHROME_PATH;
const browser = await chromium.launch(executablePath ? { executablePath } : { channel: "chrome" });
const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 2, colorScheme: "dark" });
await context.addInitScript((draft) => {
  sessionStorage.setItem("markmode.file./draft.md", draft);
  // Not a first start: no welcome.
  localStorage.setItem("markmode.welcomed", "1");
}, DRAFT);
const page = await context.newPage();
await page.goto(server.resolvedUrls!.local[0]);
await page.waitForSelector(".cm-content");

// The keys typed, bottom right, and what is going on, top center: drawn over
// the page, out of the editor's way.
await page.addStyleTag({
  content: `
    #demo-keys, #demo-caption {
      position: fixed; z-index: 1000; pointer-events: none; font: 600 15px -apple-system, system-ui, sans-serif;
      border-radius: 8px; padding: 6px 12px; background: #2a3442ee; color: #e8e4cf; box-shadow: 0 4px 16px #0006;
      transition: opacity 0.15s;
    }
    #demo-keys { right: 18px; bottom: 70px; font-family: ui-monospace, Menlo, monospace; font-size: 17px; }
    #demo-caption { left: 18px; bottom: 70px; }
    #demo-keys:empty, #demo-caption:empty { opacity: 0; }
  `,
});
await page.evaluate(() => {
  for (const id of ["demo-keys", "demo-caption"]) document.body.append(Object.assign(document.createElement("div"), { id }));
});

const setText = (id: string, text: string) =>
  page.evaluate(([id, text]) => void (document.getElementById(id)!.textContent = text), [id, text]);
const caption = (text: string) => setText("demo-caption", text);
let keys = "";

async function shot(ms: number) {
  await page.waitForTimeout(30);
  await page.screenshot({ path: join(frames, `${String(durations.length).padStart(4, "0")}.png`) });
  durations.push(ms);
}

/**
 * Presses keys one by one (Playwright names, or characters), showing each; a
 * frame after each, or with `chord` only after the last, so the menu of keys
 * that may follow a prefix does not flash by.
 */
async function press(sequence: string[], { label = true, ms = 160, chord = false } = {}) {
  for (const [i, key] of sequence.entries()) {
    if (label) {
      keys = (keys + " " + keyLabel(key)).trim().slice(-24);
      await setText("demo-keys", keys);
    }
    await page.keyboard.press(key);
    await page.waitForTimeout(40);
    if (!chord || i === sequence.length - 1) await shot(ms);
  }
}

/** Types text in insert mode or a prompt, a frame every few characters. */
async function typeText(text: string) {
  for (let i = 0; i < text.length; i += 3) {
    await page.keyboard.type(text.slice(i, i + 3));
    await shot(70);
  }
}

async function clearKeys() {
  keys = "";
  await setText("demo-keys", "");
}

function keyLabel(key: string) {
  return ({ Space: "␣", Enter: "⏎", Escape: "Esc", "Meta+s": "⌘S", "Shift+P": "P" } as Record<string, string>)[key] ?? key;
}

// ── The story ──

await page.evaluate(() => app.openPath("/draft.md"));
await page.keyboard.press("g");
await page.keyboard.press("g");
await caption("A draft an agent wrote, rendered as you read it");
await shot(2200);

// Select the sentence to comment on, the Helix way, and leave a note.
await caption("Select with Helix keys, leave a comment for the agent");
await press(["j", "j", "f", "Shift+P", ";", "v", "t", ","], { ms: 260 });
await shot(700);
await press(["Space", "c"]);
await shot(400);
await typeText("make this friendlier");
await press(["Enter"], { ms: 900 });
await clearKeys();
// Away from the cursor, the comment shows as an aside.
await page.keyboard.press("Escape");
await page.keyboard.press("g");
await page.keyboard.press("g");
await press(["Meta+s"], { ms: 1600 });
await clearKeys();

// The agent reads the comment and rewrites the file on disk.
await caption("An agent addresses it: its edits show inline, to review");
await page.evaluate((text) => backend.writeText("/draft.md", text), AGENT);
await page.waitForTimeout(500);
await shot(2400);

await caption("]g next change · space g a accept · space g r reject");
await press(["]", "g"], { ms: 300, chord: true });
await shot(1000);
await press(["Space", "g", "a"], { ms: 220, chord: true });
await shot(1000);
await clearKeys();
await press(["]", "g"], { ms: 300, chord: true });
await shot(1000);
await press(["Space", "g", "r"], { ms: 220, chord: true });
await shot(1000);
await clearKeys();
await press(["]", "g"], { ms: 300, chord: true });
await press(["Space", "g", "a"], { ms: 220, chord: true });
await shot(1400);
await clearKeys();

await caption("Save, and export a styled Word document");
await page.keyboard.press("g");
await page.keyboard.press("g");
await press(["Meta+s"], { ms: 700 });
await press(["Space", "e"], { ms: 300, chord: true });
await page.waitForTimeout(800);
await shot(2600);
await clearKeys();

await browser.close();
await server.close();

// Each frame held for its duration, then one palette for the whole GIF.
const list = durations.map((ms, i) => `file '${join(frames, `${String(i).padStart(4, "0")}.png`)}'\nduration ${ms / 1000}`).join("\n");
// The concat demuxer drops the last frame's duration unless the frame comes again.
writeFileSync(join(frames, "list.txt"), `${list}\nfile '${join(frames, `${String(durations.length - 1).padStart(4, "0")}.png`)}'\n`);
execFileSync("ffmpeg", [
  "-y", "-loglevel", "error",
  "-f", "concat", "-safe", "0", "-i", join(frames, "list.txt"),
  "-vf", `scale=${WIDTH}:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=full:max_colors=128[p];[b][p]paletteuse=dither=none`,
  "-fps_mode", "vfr",
  output,
]);
rmSync(frames, { recursive: true });
console.log(`wrote ${output}, ${durations.length} frames, ${(durations.reduce((a, b) => a + b, 0) / 1000).toFixed(1)} s`);
