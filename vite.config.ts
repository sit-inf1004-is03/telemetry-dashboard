import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    // React + mqtt.js make one ~600 kB file; fine for a LAN dashboard
    chunkSizeWarningLimit: 1000,
  },
});
