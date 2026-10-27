import "./env.js";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createDatabase, transaction, type Database } from "./db.js";
import { configFromEnv } from "./config.js";
import { migrate } from "./migrate.js";

/** Operator-only handoff for the previous GCP deployment. Normal migrations stay unchanged. */
export async function upgradeLegacy(db: Database) {
  const sql = await readFile(
    new URL("../../../deploy/legacy-baseline.sql", import.meta.url),
    "utf8",
  );
  await transaction(db, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(171901)");
    await client.query(sql);
  });
  // Both steps are repeatable if a later migration fails or the connection drops.
  await migrate(db);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const db = createDatabase(configFromEnv().databaseUrl);
  try {
    await upgradeLegacy(db);
    console.log("Legacy schema adopted; current migrations applied.");
  } finally {
    await db.end();
  }
}
