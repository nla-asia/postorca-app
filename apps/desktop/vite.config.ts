import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";

const { version } = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
);

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const apiUrl = new URL(env.VITE_API_URL ?? "http://127.0.0.1:3001/api");
  if (!["http:", "https:"].includes(apiUrl.protocol))
    throw new Error("VITE_API_URL must use HTTP or HTTPS.");
  return {
    define: { __APP_VERSION__: JSON.stringify(version) },
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
                // Radix dialogs inject styles to lock background scrolling. Saved media
                // is fetched with the session token and shown through blob: URLs.
                content: `default-src 'self'; script-src 'self'${development ? " 'unsafe-inline'" : ""}; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; media-src blob:; connect-src 'self' ${apiUrl.origin}${development ? " ws://127.0.0.1:5173" : ""}`,
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
  };
});
