import { defineConfig } from "vite";

// Tauri expects a fixed dev port and shows Rust errors in the terminal, so
// Vite must not clear it. The examples are documents to edit in the app; the
// browser stand-in imports sample.md, so saving it would reload the page.
export default defineConfig({
  clearScreen: false,
  server: { port: 1420, strictPort: true, watch: { ignored: ["**/src-tauri/**", "**/examples/**"] } },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: { target: "safari16", outDir: "dist", emptyOutDir: true },
});
