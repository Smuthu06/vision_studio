import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

// `vite build --mode single` produces one self-contained index.html (easy to host / share).
export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === "single" ? [viteSingleFile()] : [])],
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
