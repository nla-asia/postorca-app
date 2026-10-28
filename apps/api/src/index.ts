import "./env.js";
import { createAgent } from "./agent/router.js";
import { createApp } from "./app.js";
import { attachDesktopSocket } from "./desktop/connections.js";
import { configFromEnv } from "./config.js";
import { createDatabase, ping } from "./db.js";
import { catalogDrift } from "./plugins/catalog.js";
import { MetaProvider } from "./providers/meta.js";
import { OpenAIProvider } from "./providers/openai.js";
import { failInterruptedTurns } from "./repositories/turns.js";
import { Scheduler } from "./scheduler.js";

const config = configFromEnv();
const db = createDatabase(config.databaseUrl);
try {
  await ping(db);
  // Turns left queued or running by the previous process never resume on their own.
  await failInterruptedTurns(db);
  const drift = await catalogDrift(db);
  if (drift.length)
    console.warn(
      `The tool catalog in the database is out of date (${drift.join("; ")}). Run npm run db:migrate: Orca sees the database's tools.`,
    );
} catch (error) {
  await db.end();
  throw error;
}
const { orca } = config;
const agent = orca
  ? createAgent(
      db,
      orca.provider === "meta"
        ? new MetaProvider(orca.apiKey, orca.model)
        : new OpenAIProvider(orca.apiKey, orca.model),
    )
  : null;
if (orca) console.log(`Orca runs on ${orca.provider} (${orca.model}).`);
else
  console.warn(
    "Orca is off: set META_MODEL_API_KEY and META_MODEL (or OPENAI_API_KEY and OPENAI_MODEL) to run Agent chat, work and routines.",
  );
// Routines run only when Orca can execute them; otherwise they stay due and run
// once on the first tick after a model is configured.
const scheduler = agent ? new Scheduler(db, agent) : null;
const app = createApp(db, config, agent);
const server = app.listen(config.port, "127.0.0.1", () => {
  console.log(`PostOrca API listening on http://127.0.0.1:${config.port}`);
  scheduler?.start();
});
const desktopSocket = attachDesktopSocket(server, config.jwtSecret);
server.on("error", (error) => {
  console.error("API failed to start:", error.message);
  process.exitCode = 1;
  void db.end();
});

let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  // No new runs start while open requests finish.
  const scheduled = scheduler?.stop();
  // Desktops reconnect to the next server process on their own.
  desktopSocket.close();
  const deadline = setTimeout(() => server.closeAllConnections(), 10_000);
  deadline.unref();
  server.close(async (error) => {
    clearTimeout(deadline);
    if (error) {
      console.error("API shutdown failed:", error.message);
      process.exitCode = 1;
    }
    await scheduled;
    // Running turns fail with a follow-up message before their database goes away.
    await agent?.shutdown();
    await db.end();
  });
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
