import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Root is this file's directory (client/). envDir is the project root, one
// level up, so a single .env at the site root feeds the VITE_* vars.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  envDir: "..",
  server: {
    proxy: {
      "/api": "http://localhost:8787",
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
