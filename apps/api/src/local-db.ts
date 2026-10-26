import "./env.js";
import { fileURLToPath } from "node:url";
import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
if (!process.env.DATABASE_URL)
  throw new Error("Set DATABASE_URL in .env first.");
const url = new URL(process.env.DATABASE_URL);
if (url.hostname !== "127.0.0.1" || url.pathname !== "/postorca")
  throw new Error(
    "db:local only manages the project-local postorca database at 127.0.0.1.",
  );
const databaseDir = fileURLToPath(
  new URL("../.data/postgres/", import.meta.url),
);
const pg = new EmbeddedPostgres({
  databaseDir,
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  port: Number(url.port),
  persistent: true,
  authMethod: "scram-sha-256",
  // Windows otherwise inherits a legacy code page that cannot store skill text.
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
  postgresFlags: ["-h", "127.0.0.1"],
  onLog: () => {},
  onError: () => {},
});
if (!existsSync(resolve(databaseDir, "PG_VERSION"))) await pg.initialise();
await pg.start();
const client = pg.getPgClient();
await client.connect();
if (
  !(await client.query("SELECT 1 FROM pg_database WHERE datname='postorca'"))
    .rowCount
)
  await pg.createDatabase("postorca");
await client.end();
console.log(`Project-local PostgreSQL listening on 127.0.0.1:${url.port}`);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await pg.stop();
}
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
