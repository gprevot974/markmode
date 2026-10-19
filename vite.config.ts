import { defineConfig } from "vite";

// Tauri expects a fixed dev port and shows Rust errors in the terminal, so
// Vite must not clear it.
export default defineConfig({
  clearScreen: false,
  server: { port: 1420, strictPort: true, watch: { ignored: ["**/src-tauri/**"] } },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: { target: "safari16", outDir: "dist", emptyOutDir: true },
});
