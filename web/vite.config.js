// web/vite.config.js
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    allowedHosts: true, // allow all (useful with changing ngrok subdomains)
    proxy: {
      // 1) Support existing calls that start with /api
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ""),
      },

      // 2) ALSO proxy the real endpoints you call without /api
      "/login":  { target: "http://localhost:4000", changeOrigin: true },
      "/me":     { target: "http://localhost:4000", changeOrigin: true },
      "/jobs":   { target: "http://localhost:4000", changeOrigin: true },
      "/scan":   { target: "http://localhost:4000", changeOrigin: true },
      "/admin":  { target: "http://localhost:4000", changeOrigin: true },
      "/__reset":{ target: "http://localhost:4000", changeOrigin: true },
    },

    // If you ever need HMR through ngrok, uncomment and set your host:
    // hmr: {
    //   host: 'YOUR-NGROK-SUBDOMAIN.ngrok-free.dev',
    //   protocol: 'wss',
    //   clientPort: 443,
    // },
  },
});
