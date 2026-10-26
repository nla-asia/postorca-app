import "./env.js";
import { createApp } from "./app.js";
import { configFromEnv } from "./config.js";
import { createDatabase, ping } from "./db.js";

const config = configFromEnv();
const db = createDatabase(config.databaseUrl);
try {
  await ping(db);
} catch (error) {
  await db.end();
  throw error;
}
const app = createApp(db, config);
const server = app.listen(config.port, "127.0.0.1", () => {
  console.log(`PostOrca API listening on http://127.0.0.1:${config.port}`);
});
server.on("error", (error) => {
  console.error("API failed to start:", error.message);
  process.exitCode = 1;
  void db.end();
});

let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  const deadline = setTimeout(() => server.closeAllConnections(), 10_000);
  deadline.unref();
  server.close(async (error) => {
    clearTimeout(deadline);
    if (error) {
      console.error("API shutdown failed:", error.message);
      process.exitCode = 1;
    }
    await db.end();
  });
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
