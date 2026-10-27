import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import jwt from "jsonwebtoken";
import { createApp } from "../src/app.js";
import { configFromEnv } from "../src/config.js";
import { migrate } from "../src/migrate.js";
import { issueToken } from "../src/middleware/auth.js";
import { hashPassword, verifyPassword } from "../src/repositories/users.js";
import { temporaryPostgres } from "./postgres.js";

const secret = "auth-test-secret-at-least-32-characters";
const password = "secure-test-password";
type User = { id: string; name: string; email: string };
type Body = {
  user?: User;
  token?: string;
  refreshToken?: string;
  error?: string;
};
let fixture: Awaited<ReturnType<typeof temporaryPostgres>>;
let server: Server;
let url: string;
before(async () => {
  fixture = await temporaryPostgres();
  await migrate(fixture.db);
  server = createApp(
    fixture.db,
    configFromEnv({ DATABASE_URL: fixture.url, JWT_SECRET: secret }),
  ).listen(0, "127.0.0.1");
  await once(server, "listening");
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
after(async () => {
  if (server)
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  await fixture?.close();
});

async function request(
  path: string,
  method = "GET",
  body?: unknown,
  token?: string,
  timezone?: string,
) {
  const response = await fetch(url + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(timezone ? { "X-Timezone": timezone } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, data: (text ? JSON.parse(text) : {}) as Body };
}
async function register(email: string, timezone?: string) {
  const result = await request(
    "/auth/register",
    "POST",
    { name: " Founder ", email, password },
    undefined,
    timezone,
  );
  assert.equal(result.status, 201);
  assert.ok(result.data.user && result.data.token && result.data.refreshToken);
  return {
    user: result.data.user,
    token: result.data.token,
    refreshToken: result.data.refreshToken,
  };
}

test("passwords use independent scrypt salts and reject incorrect or missing hashes", async () => {
  const first = await hashPassword(password);
  const second = await hashPassword(password);
  assert.match(first, /^[0-9a-f]{32}:[0-9a-f]{128}$/);
  assert.notEqual(first, second);
  assert.equal(await verifyPassword(password, first), true);
  assert.equal(await verifyPassword("wrong", first), false);
  assert.equal(await verifyPassword(password), false);
});

test("registration normalizes identity, creates a profile, and returns a 7-day user token and a refresh token", async () => {
  const account = await register(" Case@Example.com ");
  assert.equal(account.user.name, "Founder");
  assert.equal(account.user.email, "case@example.com");
  assert.deepEqual(Object.keys(account.user).sort(), ["email", "id", "name"]);
  const stored = (
    await fixture.db.query("SELECT password_hash FROM users WHERE id=$1", [
      account.user.id,
    ])
  ).rows[0];
  assert.equal(await verifyPassword(password, stored.password_hash), true);
  assert.equal(
    (
      await fixture.db.query("SELECT 1 FROM brand_profiles WHERE user_id=$1", [
        account.user.id,
      ])
    ).rowCount,
    1,
  );
  const claims = jwt.verify(account.token, secret, {
    algorithms: ["HS256"],
    issuer: "postorca",
    audience: "postorca-desktop",
  });
  assert.ok(typeof claims !== "string");
  assert.equal(claims.sub, account.user.id);
  assert.equal(claims.exp! - claims.iat!, 7 * 24 * 60 * 60);
});

test("refresh tokens rotate, tolerate a retried refresh, and revoke a reused session", async () => {
  const account = await register("refresh@example.com");
  const refresh = (refreshToken: string) =>
    request("/auth/refresh", "POST", { refreshToken });
  const signIn = async () =>
    (
      await request("/auth/login", "POST", {
        email: "refresh@example.com",
        password,
      })
    ).data.refreshToken!;
  const ownSessions =
    "session_id IN (SELECT id FROM auth_sessions WHERE user_id = $1)";
  const expiries = async () =>
    (
      await fixture.db.query(
        `SELECT used_at IS NOT NULL AS spent,
                expires_at IS NULL AS never_expires,
                round(extract(epoch FROM expires_at - used_at) / 86400) AS kept_days
           FROM refresh_tokens WHERE ${ownSessions} ORDER BY used_at NULLS LAST`,
        [account.user.id],
      )
    ).rows;
  // A live token never expires: the session lasts until logout or a detected copy.
  assert.deepEqual(await expiries(), [
    { spent: false, never_expires: true, kept_days: null },
  ]);
  const first = await refresh(account.refreshToken);
  assert.equal(first.status, 200);
  assert.notEqual(first.data.refreshToken, account.refreshToken);
  // The spent token is kept 30 days to detect reuse; its successor never expires.
  assert.deepEqual(await expiries(), [
    { spent: true, never_expires: false, kept_days: "30" },
    { spent: false, never_expires: true, kept_days: null },
  ]);
  assert.equal(
    (await request("/auth/me", "GET", undefined, first.data.token)).data.user
      ?.id,
    account.user.id,
  );
  // A client that lost the response retries with the same token at once.
  const retried = await refresh(account.refreshToken);
  assert.equal(retried.status, 200);
  assert.equal((await refresh(retried.data.refreshToken!)).status, 200);
  // A spent token presented after the grace window was copied: it ends the
  // session, including the token issued after it.
  const copied = await signIn();
  const next = (await refresh(copied)).data.refreshToken!;
  await fixture.db.query(
    `UPDATE refresh_tokens SET used_at = now() - interval '2 minutes'
      WHERE ${ownSessions} AND used_at IS NOT NULL`,
    [account.user.id],
  );
  assert.equal((await refresh(copied)).status, 401);
  assert.equal((await refresh(next)).status, 401);
  // Logout ends one session; expired and unknown tokens are refused.
  const other = await signIn();
  assert.equal(
    (await request("/auth/logout", "POST", { refreshToken: other })).status,
    204,
  );
  assert.equal((await refresh(other)).status, 401);
  const expiring = await signIn();
  await fixture.db.query(
    `UPDATE refresh_tokens SET expires_at = now()
      WHERE ${ownSessions} AND used_at IS NULL`,
    [account.user.id],
  );
  assert.equal((await refresh(expiring)).status, 401);
  assert.equal((await refresh("unknown-token")).status, 401);
  assert.equal((await request("/auth/refresh", "POST", {})).status, 400);
  // Only token hashes are stored.
  const stored = await fixture.db.query(
    `SELECT token_hash FROM refresh_tokens WHERE ${ownSessions}`,
    [account.user.id],
  );
  assert.ok(stored.rowCount);
  for (const row of stored.rows) assert.equal(row.token_hash.length, 32);
});

test("registration validates input before creating accounts", async () => {
  for (const body of [
    { name: " ", email: "invalid-name@example.com", password },
    { name: "Founder", email: "not-an-email", password },
    { name: "Founder", email: "short-password@example.com", password: "short" },
  ]) {
    assert.equal((await request("/auth/register", "POST", body)).status, 400);
  }
  assert.equal(
    (
      await fixture.db.query(
        "SELECT 1 FROM users WHERE email IN ('invalid-name@example.com','short-password@example.com')",
      )
    ).rowCount,
    0,
  );
});

test("concurrent registration preserves unique emails and a single profile", async () => {
  const results = await Promise.all([
    request("/auth/register", "POST", {
      name: "One",
      email: "race@example.com",
      password,
    }),
    request("/auth/register", "POST", {
      name: "Two",
      email: "RACE@example.com",
      password,
    }),
  ]);
  assert.deepEqual(results.map((result) => result.status).sort(), [201, 409]);
  assert.deepEqual(results.find((result) => result.status === 409)?.data, {
    error: "This record already exists.",
  });
  assert.equal(
    (
      await fixture.db.query(
        "SELECT 1 FROM users u JOIN brand_profiles p ON p.user_id=u.id WHERE u.email='race@example.com'",
      )
    ).rowCount,
    1,
  );
});

test("login uses uniform credential errors and me stays bound to the signed-in user", async () => {
  const a = await register("account-a@example.com");
  const b = await register("account-b@example.com");
  for (const email of [a.user.email, "missing@example.com"]) {
    assert.deepEqual(
      await request("/auth/login", "POST", { email, password: "wrong" }),
      { status: 401, data: { error: "Email or password is incorrect." } },
    );
  }
  const login = await request("/auth/login", "POST", {
    email: " ACCOUNT-A@example.com ",
    password,
  });
  assert.equal(login.status, 200);
  assert.deepEqual(login.data.user, a.user);
  assert.ok(login.data.token);
  const restored = await request(
    `/auth/me?userId=${b.user.id}`,
    "GET",
    undefined,
    login.data.token,
  );
  assert.deepEqual(restored, { status: 200, data: { user: a.user } });
  assert.deepEqual(
    (await request("/auth/me", "GET", undefined, b.token)).data.user,
    b.user,
  );
});

test("me rejects missing, invalid, expired, wrong-scope and deleted-user sessions", async () => {
  const account = await register("token-check@example.com");
  assert.equal((await request("/auth/me")).status, 401);
  const claims = {
    subject: account.user.id,
    issuer: "postorca",
    audience: "postorca-desktop",
    expiresIn: "12h" as const,
  };
  const invalid = [
    "invalid",
    jwt.sign({}, "a-different-secret", claims),
    jwt.sign({}, secret, { ...claims, expiresIn: -1 }),
    jwt.sign({}, secret, { ...claims, issuer: "another-app" }),
    jwt.sign({}, secret, { ...claims, audience: "postorca-device" }),
    jwt.sign({}, secret, { ...claims, algorithm: "HS384" }),
    jwt.sign({}, secret, { ...claims, subject: "not-a-user-id" }),
    issueToken(randomUUID(), secret),
  ];
  for (const token of invalid)
    assert.equal(
      (await request("/auth/me", "GET", undefined, token)).status,
      401,
    );
  await fixture.db.query("DELETE FROM users WHERE id=$1", [account.user.id]);
  assert.equal(
    (await request("/auth/me", "GET", undefined, account.token)).status,
    401,
  );
});

test("registration, login and session restore save valid timezones and ignore unknown zones", async () => {
  const account = await register("timezone@example.com", "Asia/Bangkok");
  const storedZone = async () =>
    (
      await fixture.db.query("SELECT timezone FROM users WHERE id=$1", [
        account.user.id,
      ])
    ).rows[0].timezone;
  assert.equal(await storedZone(), "Asia/Bangkok");
  assert.equal(
    (
      await request(
        "/auth/login",
        "POST",
        { email: account.user.email, password },
        undefined,
        "America/New_York",
      )
    ).status,
    200,
  );
  assert.equal(await storedZone(), "America/New_York");
  await request("/auth/me", "GET", undefined, account.token, "Unknown/Zone");
  assert.equal(await storedZone(), "America/New_York");
  await request("/auth/me", "GET", undefined, account.token, "Europe/London");
  assert.equal(await storedZone(), "Europe/London");
});

test("a profile insert failure rolls back account registration", async (context) => {
  context.mock.method(console, "error", () => {});
  await fixture.db.query(
    "CREATE FUNCTION reject_profile() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test-only failure'; END; $$; CREATE TRIGGER reject_profile BEFORE INSERT ON brand_profiles FOR EACH ROW EXECUTE FUNCTION reject_profile()",
  );
  try {
    const result = await request("/auth/register", "POST", {
      name: "Rollback",
      email: "rollback-auth@example.com",
      password,
    });
    assert.equal(result.status, 500);
    assert.equal(
      (
        await fixture.db.query(
          "SELECT 1 FROM users WHERE email='rollback-auth@example.com'",
        )
      ).rowCount,
      0,
    );
  } finally {
    await fixture.db.query(
      "DROP TRIGGER reject_profile ON brand_profiles; DROP FUNCTION reject_profile()",
    );
  }
});

test("auth routes enforce a 60-request limit without limiting health", async (context) => {
  const limited = createApp(
    fixture.db,
    configFromEnv({ DATABASE_URL: fixture.url, JWT_SECRET: secret }),
  ).listen(0, "127.0.0.1");
  await once(limited, "listening");
  context.after(
    () =>
      new Promise<void>((resolve, reject) =>
        limited.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  const address = `http://127.0.0.1:${(limited.address() as AddressInfo).port}/api`;
  for (let i = 0; i < 60; i++) {
    const response = await fetch(`${address}/auth/me`);
    assert.equal(response.status, 401);
    await response.arrayBuffer();
  }
  const blocked = await fetch(`${address}/auth/me`);
  assert.equal(blocked.status, 429);
  assert.deepEqual(await blocked.json(), {
    error: "Too many attempts. Please try again later.",
  });
  assert.ok(blocked.headers.get("ratelimit"));
  const health = await fetch(`${address}/health`);
  assert.equal(health.status, 200);
  await health.arrayBuffer();
});
