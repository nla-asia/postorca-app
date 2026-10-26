import { mkdtemp, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import EmbeddedPostgres from "embedded-postgres";
import { createDatabase } from "../src/db.js";

export async function temporaryPostgres() {
  const folder = await mkdtemp(join(tmpdir(), "postorca-postgres-"));
  const socket = createServer();
  await new Promise<void>((resolve) => socket.listen(0, "127.0.0.1", resolve));
  const port = (socket.address() as { port: number }).port;
  await new Promise<void>((resolve) => socket.close(() => resolve()));
  const postgres = new EmbeddedPostgres({
    databaseDir: join(folder, "db"),
    user: "postorca",
    password: "test-only-password",
    port,
    persistent: false,
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
    postgresFlags: ["-h", "127.0.0.1"],
    onLog: () => {},
    onError: () => {},
  });
  await postgres.initialise();
  await postgres.start();
  await postgres.createDatabase("postorca_test");
  const url = `postgresql://postorca:test-only-password@127.0.0.1:${port}/postorca_test`;
  const db = createDatabase(url);
  return {
    db,
    url,
    postgres,
    async close() {
      await db.end();
      await postgres.stop();
      await rmdir(folder);
    },
  };
}
