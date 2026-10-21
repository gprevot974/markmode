// Browser tests: the editor runs in Chrome against the in-memory backend
// (src/backend.ts), driven with real key presses. Run with `npm run test:e2e`,
// or `npm run test:e2e -- spelling` for the suites whose name matches.
//
// Uses the installed Chrome; set CHROME_PATH to use another Chromium.

import { chromium, type Browser, type BrowserContextOptions, type Page } from "playwright-core";
import { createServer } from "vite";

export interface Harness {
  page: Page;
  type(keys: string): Promise<void>;
  press(key: string): Promise<void>;
  ev<R, A = undefined>(f: (arg: A) => R | Promise<R>, arg?: A): Promise<R>;
  check(name: string, ok: boolean, info?: unknown): void;
  /** Reloads the page, as a restart of the app. */
  restart(): Promise<void>;
}

export type Suite = (t: Harness) => Promise<void>;

const SUITES = ["editing", "spelling", "theme", "files", "review", "prose", "export", "large"];

async function open(browser: Browser, url: string, options: BrowserContextOptions, check: Harness["check"]) {
  const context = await browser.newContext({ viewport: { width: 1300, height: 860 }, ...options });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("dialog", (d) => void d.dismiss());
  const ready = async () => {
    await page.waitForSelector(".cm-content");
    await page.waitForTimeout(400);
  };
  await page.goto(url);
  await ready();
  const t: Harness = {
    page,
    async type(keys) {
      await page.keyboard.type(keys, { delay: 15 });
      await page.waitForTimeout(50);
    },
    async press(key) {
      await page.keyboard.press(key);
      await page.waitForTimeout(60);
    },
    ev: (f, arg) => page.evaluate(f as never, arg),
    check,
    async restart() {
      await page.reload();
      await ready();
    },
  };
  return { t, context, errors };
}

const filter = process.argv[2];
const suites = SUITES.filter((s) => !filter || s.includes(filter));
const server = await createServer({ server: { port: 0, strictPort: false }, logLevel: "error" });
await server.listen();
const url = server.resolvedUrls!.local[0];
const executablePath = process.env.CHROME_PATH;
const browser = await chromium.launch(executablePath ? { executablePath } : { channel: "chrome" });

let failed = 0;
for (const name of suites) {
  console.log(`\n${name}`);
  const suite: { default: Suite; options?: BrowserContextOptions } = await import(`./${name}.ts`);
  const check: Harness["check"] = (what, ok, info) => {
    if (!ok) failed++;
    console.log(`  ${ok ? "✓" : "✗"} ${what}${ok ? "" : `\n      ${JSON.stringify(info)}`}`);
  };
  const { t, context, errors } = await open(browser, url, suite.options ?? {}, check);
  try {
    await suite.default(t);
  } catch (err) {
    check("runs to the end", false, String(err));
  }
  check("no errors in the page", errors.length === 0, errors);
  await context.close();
}

await browser.close();
await server.close();
console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
