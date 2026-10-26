import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { createApp } from "./app.js";
import { configFromEnv } from "./config.js";

// Resolve from this package, for both src/ and compiled dist/ entry points.
loadEnv({
  path: fileURLToPath(new URL("../.env", import.meta.url)),
  quiet: true,
});
const config = configFromEnv();
const app = createApp(config);
const server = app.listen(config.port, "127.0.0.1", () => {
  console.log(`PostOrca API listening on http://127.0.0.1:${config.port}`);
});
server.on("error", (error) => {
  console.error("API failed to start:", error.message);
  process.exitCode = 1;
});

let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  const deadline = setTimeout(() => server.closeAllConnections(), 10_000);
  deadline.unref();
  server.close((error) => {
    clearTimeout(deadline);
    if (error) {
      console.error("API shutdown failed:", error.message);
      process.exitCode = 1;
    }
  });
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
