import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";
import { baseThemeCss } from "./src/theme/baseTheme.ts";

const themes = new URL("./src/theme/themes/", import.meta.url);

// The base theme's colors (Entre-Deux's), in index.html so the very first
// paint has them; editing its files reloads the page.
function baseTheme(): Plugin {
  const read = (name: string) => readFileSync(new URL(`${name}.toml`, themes), "utf8");
  return {
    name: "markmode-base-theme",
    transformIndexHtml: () => [
      { tag: "style", attrs: { id: "base-theme" }, children: baseThemeCss(read("entre-deux"), read("entre-deux-light")), injectTo: "head-prepend" },
    ],
    handleHotUpdate({ file, server }) {
      if (/\/src\/theme\/themes\/entre-deux(-light)?\.toml$/.test(file)) server.ws.send({ type: "full-reload" });
    },
  };
}

// Tauri expects a fixed dev port and shows Rust errors in the terminal, so
// Vite must not clear it. The examples are documents to edit in the app; the
// browser stand-in imports sample.md, so saving it would reload the page.
export default defineConfig({
  clearScreen: false,
  plugins: [baseTheme()],
  server: { port: 1420, strictPort: true, watch: { ignored: ["**/src-tauri/**", "**/examples/**"] } },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: { target: "safari16", outDir: "dist", emptyOutDir: true },
});
