import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomBytes, createHash } from "node:crypto";
import { temporaryPostgres } from "./postgres.js";
import { upgradeLegacy } from "../src/upgrade-legacy.js";
import {
  hashPassword,
  verifyPassword,
  findUser,
} from "../src/repositories/users.js";
import { rotateSession } from "../src/repositories/sessions.js";
import { getCreditSummary } from "../src/billing/credits.js";
let f: Awaited<ReturnType<typeof temporaryPostgres>>;
before(async () => {
  f = await temporaryPostgres();
});
after(async () => {
  await f?.close();
});

test("the deployed legacy schema upgrades without replaying creates or losing accounts, work, or refresh sessions", async () => {
  await f.db.query(
    await readFile(
      new URL("./fixtures/legacy-schema.sql", import.meta.url),
      "utf8",
    ),
  );
  const password = await hashPassword("legacy-password");
  const {
    rows: [user],
  } = await f.db.query(
    "INSERT INTO users(name,email,password_hash) VALUES ('Legacy','legacy@example.test',$1) RETURNING id",
    [password],
  );
  await f.db.query("INSERT INTO brand_profiles(user_id) VALUES ($1)", [
    user.id,
  ]);
  const {
    rows: [task],
  } = await f.db.query(
    "INSERT INTO tasks(user_id,kind,title) VALUES ($1,'work','Existing work') RETURNING id",
    [user.id],
  );
  const {
    rows: [session],
  } = await f.db.query(
    "INSERT INTO auth_sessions(user_id) VALUES ($1) RETURNING id",
    [user.id],
  );
  const token = randomBytes(32).toString("base64url");
  await f.db.query(
    "INSERT INTO refresh_tokens(token_hash,session_id,expires_at) VALUES ($1,$2,now()+interval '1 day')",
    [createHash("sha256").update(token).digest(), session.id],
  );
  await upgradeLegacy(f.db);
  await upgradeLegacy(f.db);
  assert.equal((await findUser(f.db, user.id)).email, "legacy@example.test");
  assert.ok(await verifyPassword("legacy-password", password));
  assert.equal(
    (await f.db.query("SELECT title FROM tasks WHERE id=$1", [task.id])).rows[0]
      .title,
    "Existing work",
  );
  assert.equal((await rotateSession(f.db, token))?.userId, user.id);
  assert.equal((await getCreditSummary(f.db, user.id)).balance, 250);
  const names = (
    await f.db.query("SELECT name FROM schema_migrations")
  ).rows.map((row) => row.name);
  assert.ok(names.includes("019_refresh_tokens.sql"));
  assert.ok(names.includes("001_accounts.sql"));
  assert.ok(names.includes("015_billing_and_allowances.sql"));
  assert.equal(
    (
      await f.db.query(
        "SELECT is_nullable FROM information_schema.columns WHERE table_name='skills' AND column_name='dir'",
      )
    ).rows[0].is_nullable,
    "NO",
  );
});

test("an unknown legacy history is refused before baseline registration", async () => {
  const bad = await temporaryPostgres();
  try {
    await bad.db.query(
      "CREATE TABLE schema_migrations(name text PRIMARY KEY); INSERT INTO schema_migrations VALUES ('001_initial.sql')",
    );
    await assert.rejects(
      upgradeLegacy(bad.db),
      /Expected the legacy 019 schema/,
    );
    assert.equal(
      (await bad.db.query("SELECT count(*)::int AS n FROM schema_migrations"))
        .rows[0].n,
      1,
    );
  } finally {
    await bad.close();
  }
});

test("a clean database continues to use the normal migration path", async () => {
  const clean = await temporaryPostgres();
  try {
    await upgradeLegacy(clean.db);
    assert.equal(
      (await clean.db.query("SELECT count(*)::int AS n FROM schema_migrations"))
        .rows[0].n,
      15,
    );
  } finally {
    await clean.close();
  }
});
