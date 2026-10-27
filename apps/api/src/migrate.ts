import "./env.js";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createDatabase, transaction, type Database } from "./db.js";
import { configFromEnv } from "./config.js";
import { syncCatalog } from "./plugins/catalog.js";
import { seedAllDefaultRoutines } from "./repositories/routines.js";
export async function migrate(db: Database) {
  await transaction(db, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(171901)");
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const folder = new URL("./migrations/", import.meta.url);
    const files = (await readdir(folder))
      .filter((name) => /^\d+.*\.sql$/.test(name))
      .sort();
    for (const name of files) {
      if (
        (
          await client.query("SELECT 1 FROM schema_migrations WHERE name=$1", [
            name,
          ])
        ).rowCount
      )
        continue;
      await client.query(await readFile(new URL(name, folder), "utf8"));
      await client.query("INSERT INTO schema_migrations(name) VALUES ($1)", [
        name,
      ]);
    }
    // Project the code-defined plugin catalog and core skills into their tables.
    await syncCatalog(client);
    // Defaults added since a link was seeded reach it now.
    await seedAllDefaultRoutines(client);
  });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const db = createDatabase(configFromEnv().databaseUrl);
  try {
    await migrate(db);
    console.log("Migrations applied.");
  } finally {
    await db.end();
  }
}
