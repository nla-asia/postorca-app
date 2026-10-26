import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    {
      name: "desktop-content-policy",
      transformIndexHtml() {
        // React's development refresh preamble needs inline scripts.
        const development = command === "serve";
        return [
          {
            tag: "meta",
            attrs: {
              "http-equiv": "Content-Security-Policy",
              content: `default-src 'self'; script-src 'self'${development ? " 'unsafe-inline'" : ""}; style-src 'self'${development ? " 'unsafe-inline'" : ""}; connect-src 'self'${development ? " ws://127.0.0.1:5173" : ""}`,
            },
            injectTo: "head-prepend",
          },
        ];
      },
    },
  ],
  base: "./",
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
  },
}));
