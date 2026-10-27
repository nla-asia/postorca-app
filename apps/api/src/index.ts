import "./env.js";
import { createAgent } from "./agent/router.js";
import { createApp } from "./app.js";
import { configFromEnv } from "./config.js";
import { createDatabase, ping } from "./db.js";
import { OpenAIProvider } from "./providers/openai.js";
import { failInterruptedTurns } from "./repositories/turns.js";

const config = configFromEnv();
const db = createDatabase(config.databaseUrl);
try {
  await ping(db);
  // Turns left queued or running by the previous process never resume on their own.
  await failInterruptedTurns(db);
} catch (error) {
  await db.end();
  throw error;
}
const agent = config.openai
  ? createAgent(
      db,
      new OpenAIProvider(config.openai.apiKey, config.openai.model),
    )
  : null;
if (!agent)
  console.warn(
    "Orca is off: set OPENAI_API_KEY and OPENAI_MODEL to run Agent chat and work.",
  );
const app = createApp(db, config, agent);
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
    // Running turns fail with a follow-up message before their database goes away.
    await agent?.shutdown();
    await db.end();
  });
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
