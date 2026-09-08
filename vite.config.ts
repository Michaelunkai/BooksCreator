import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  build: {
    // A browser may hold a bundled model shard open while the UI is rebuilt.
    // Keep the static model bundle in place so a routine production build does
    // not fail while trying to remove an in-use file.
    emptyOutDir: false,
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:3001",
      "/media": "http://127.0.0.1:3001",
    },
  },
});
