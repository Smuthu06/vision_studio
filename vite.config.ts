import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";
import { fileURLToPath } from "node:url";
import { benchApi } from "./dev/bench-api";

// `vite build --mode single` produces one self-contained index.html (easy to host / share).
// `npm run dev` / `npm run preview` also serve the Vision Studio web API (dev/bench-api.ts), so
// the browser UI saves into the configuration folders without the native app.
export default defineConfig(({ mode }) => ({
  plugins: [react(), benchApi(fileURLToPath(new URL(".", import.meta.url))), ...(mode === "single" ? [viteSingleFile()] : [])],
  base: "./",
  clearScreen: false,
  server: { port: 1420, strictPort: true },          // fixed port for `tauri dev`
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    outDir: mode === "single" ? "dist-single" : "dist",
    target: "es2021",
    sourcemap: false,
  },
  test: { environment: "node" },
}));
