import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    allowedHosts: [
      "d50e-49-249-107-22.ngrok-free.app",
    ],
    // `npm run dev:erp` sets VITE_PROXY_TARGET to the local ERPNext (see .env.erp). Stored
    // photos live beside the API on ERPNext (/private/files, /files), so they go there too —
    // otherwise Vite answers them with the portal's own index.html.
    proxy: Object.fromEntries(
      ["/api", "/private/files", "/files"].map((prefix) => [
        prefix,
        { target: loadEnv(mode, process.cwd(), "").VITE_PROXY_TARGET || "http://localhost:4000", changeOrigin: true },
      ]),
    ),
  },
}));
