import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createDatabase, ping, transaction } from "../src/db.js";
import { migrate } from "../src/migrate.js";
import { temporaryPostgres } from "./postgres.js";

let fixture: Awaited<ReturnType<typeof temporaryPostgres>>;
before(async () => {
  fixture = await temporaryPostgres();
});
after(async () => {
  await fixture?.close();
});

test("migrations apply once, including concurrent runners", async () => {
  const { db } = fixture;
  await Promise.all([migrate(db), migrate(db)]);
  await migrate(db);
  assert.deepEqual(
    (await db.query("SELECT name FROM schema_migrations ORDER BY name")).rows,
    [
      { name: "001_accounts.sql" },
      { name: "002_account_timezone.sql" },
      { name: "003_brand_profile.sql" },
      { name: "004_scheduling.sql" },
      { name: "005_default_routines.sql" },
      { name: "006_task_messages_and_artifacts.sql" },
      { name: "007_task_context.sql" },
    ],
  );
  await ping(db);
  assert.equal(
    (await db.query("SHOW server_encoding")).rows[0].server_encoding,
    "UTF8",
  );
});

test("accounts retain UUIDs, unique email, default profile fields and cascading ownership", async () => {
  const { db } = fixture;
  const {
    rows: [user],
  } = await db.query(
    "INSERT INTO users(name,email,password_hash) VALUES ($1,$2,$3) RETURNING id,name,email",
    ["Founder", "founder@example.com", "test-password-hash"],
  );
  assert.match(user.id, /^[0-9a-f-]{36}$/);
  await assert.rejects(
    db.query("INSERT INTO users(name,email,password_hash) VALUES ($1,$2,$3)", [
      "Duplicate",
      "founder@example.com",
      "other-hash",
    ]),
    { code: "23505" },
  );
  const {
    rows: [profile],
  } = await db.query(
    "INSERT INTO brand_profiles(user_id) VALUES ($1) RETURNING company,audience,voice",
    [user.id],
  );
  assert.deepEqual(profile, { company: "", audience: "", voice: "" });
  await assert.rejects(
    db.query("INSERT INTO brand_profiles(user_id) VALUES (gen_random_uuid())"),
    { code: "23503" },
  );
  await db.query("DELETE FROM users WHERE id=$1", [user.id]);
  assert.equal(
    (await db.query("SELECT 1 FROM brand_profiles WHERE user_id=$1", [user.id]))
      .rowCount,
    0,
  );
});

test("transactions commit, roll back on failure and release their client", async () => {
  const { db } = fixture;
  await transaction(db, async (client) => {
    await client.query(
      "INSERT INTO users(name,email,password_hash) VALUES ($1,$2,$3)",
      ["Committed", "committed@example.com", "test-hash"],
    );
  });
  await assert.rejects(
    transaction(db, async (client) => {
      await client.query(
        "INSERT INTO users(name,email,password_hash) VALUES ($1,$2,$3)",
        ["Rolled back", "rollback@example.com", "test-hash"],
      );
      await client.query(
        "INSERT INTO users(name,email,password_hash) VALUES ($1,$2,$3)",
        ["Duplicate", "committed@example.com", "test-hash"],
      );
    }),
    { code: "23505" },
  );
  assert.equal(
    (await db.query("SELECT 1 FROM users WHERE email='rollback@example.com'"))
      .rowCount,
    0,
  );
  assert.equal(
    (await db.query("SELECT 1 FROM users WHERE email='committed@example.com'"))
      .rowCount,
    1,
  );
  await ping(db);
  assert.equal(db.idleCount, db.totalCount);
});

test("a failed migration rolls back new tables and its migration record", async () => {
  await fixture.postgres.createDatabase("postorca_failed_migration");
  const url = new URL(fixture.url);
  url.pathname = "/postorca_failed_migration";
  const db = createDatabase(url.href);
  try {
    await db.query("CREATE TABLE brand_profiles(user_id uuid)");
    await assert.rejects(migrate(db), { code: "42P07" });
    assert.deepEqual(
      (
        await db.query(
          "SELECT to_regclass('users') AS users, to_regclass('schema_migrations') AS migrations",
        )
      ).rows[0],
      { users: null, migrations: null },
    );
    await db.query("DROP TABLE brand_profiles");
    await migrate(db);
    assert.equal(
      (await db.query("SELECT 1 FROM schema_migrations")).rowCount,
      7,
    );
  } finally {
    await db.end();
  }
});
