// web/vite.config.js
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    allowedHosts: true, // ok for ngrok
    proxy: {
      // If any call starts with /api, strip it and forward to Node
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ""),
      },

      // Direct endpoints (prefix match)
      "/login":          { target: "http://localhost:4000", changeOrigin: true },
      "/register":       { target: "http://localhost:4000", changeOrigin: true },
      "/forgot-password":{ target: "http://localhost:4000", changeOrigin: true },
      "/reset-password": { target: "http://localhost:4000", changeOrigin: true },
      "/me":             { target: "http://localhost:4000", changeOrigin: true },
      "/jobs":           { target: "http://localhost:4000", changeOrigin: true },
      "/scan":           { target: "http://localhost:4000", changeOrigin: true },
      "/admin":          { target: "http://localhost:4000", changeOrigin: true },
      "/config":         { target: "http://localhost:4000", changeOrigin: true }, // /config/rates
      "/__reset":        { target: "http://localhost:4000", changeOrigin: true },
      "/__routes":       { target: "http://localhost:4000", changeOrigin: true },
      "/health":         { target: "http://localhost:4000", changeOrigin: true },
    },
  },
});
