import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // VITE_BASE is set by the GitHub Actions deploy workflow to /PoE2POBAI/
  base: process.env.VITE_BASE ?? "/",
  build: {
    // Output to /docs so GitHub Pages can serve it from the repo root
    outDir: "../../docs",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    host: "0.0.0.0",
  },
});
