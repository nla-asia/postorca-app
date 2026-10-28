import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/app.js";
import { configFromEnv } from "../src/config.js";
import { transaction } from "../src/db.js";
import { migrate } from "../src/migrate.js";
import { issueToken } from "../src/middleware/auth.js";
import { createUser } from "../src/repositories/users.js";
import { temporaryPostgres } from "./postgres.js";

const secret = "schedule-test-secret-at-least-32-characters";
let fixture: Awaited<ReturnType<typeof temporaryPostgres>>;
let server: Server;
let url: string;
let accountNumber = 0;
before(async () => {
  fixture = await temporaryPostgres();
  await migrate(fixture.db);
  server = createApp(
    fixture.db,
    configFromEnv({
      DATABASE_URL: fixture.url,
      JWT_SECRET: secret,
    }),
  ).listen(0, "127.0.0.1");
  await once(server, "listening");
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/routines`;
});
after(async () => {
  if (server)
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  await fixture?.close();
});
async function account() {
  const user = await createUser(
    fixture.db,
    "Founder",
    `schedule-${++accountNumber}@example.com`,
    "schedule-test-password",
  );
  return { id: user.id as string, token: issueToken(user.id, secret) };
}
async function request(
  path = "",
  method = "GET",
  body?: unknown,
  token?: string,
) {
  const response = await fetch(url + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return {
    status: response.status,
    data: response.status === 204 ? null : ((await response.json()) as any),
  };
}
const routine = {
  platform: "Threads",
  title: "Find fresh ideas",
  instructions: "Propose three post ideas for this week.",
  time: "09:00",
  days: [5, 1, 3, 1],
  timezone: "Asia/Bangkok",
};
const future = (hours = 1) =>
  new Date(Date.now() + hours * 3600_000).toISOString();
const onceTask = () => ({
  title: "Prepare launch copy",
  instructions: "Draft a launch announcement.",
  timezone: "Asia/Bangkok",
  run_at: future(),
});

test("all schedule endpoints require authentication", async () => {
  const id = "00000000-0000-4000-8000-000000000001";
  for (const [path, method, body] of [
    ["", "GET", undefined],
    ["", "POST", routine],
    [`/${id}`, "PATCH", { active: false }],
    [`/${id}`, "DELETE", undefined],
    [`/${id}/run`, "POST", {}],
  ] as const)
    assert.equal((await request(path, method, body)).status, 401);
  const a = await account();
  assert.deepEqual((await request("", "GET", undefined, a.token)).data, []);
  assert.deepEqual(
    (await request("?once=true", "GET", undefined, a.token)).data,
    [],
  );
});

test("next run uses local weekdays and is strictly after the reference instant across DST", async () => {
  const next = async (
    time: string,
    days: number[],
    timezone: string,
    after: string,
  ) =>
    (
      await fixture.db.query(
        "SELECT routine_next_run($1::time,$2::smallint[],$3,$4) AS at",
        [time, days, timezone, after],
      )
    ).rows[0].at.toISOString();
  assert.equal(
    await next("09:00", [1], "America/New_York", "2026-10-24T00:00:00Z"),
    "2026-10-26T13:00:00.000Z",
  );
  assert.equal(
    await next("09:00", [1], "America/New_York", "2026-10-31T00:00:00Z"),
    "2026-11-02T14:00:00.000Z",
  );
  assert.equal(
    await next("09:00", [3], "Asia/Bangkok", "2026-10-21T02:00:00Z"),
    "2026-10-28T02:00:00.000Z",
  );
  assert.equal(
    await next("09:00", [3, 4], "Asia/Bangkok", "2026-10-21T02:00:00Z"),
    "2026-10-22T02:00:00.000Z",
  );
  assert.equal(
    await next("09:00", [1], "America/New_York", "2026-03-07T00:00:00Z"),
    "2026-03-09T13:00:00.000Z",
  );
});

test("recurring routines persist normalized fields, enforce ownership, and replan on resume", async () => {
  const a = await account(),
    b = await account();
  const created = await request(
    "",
    "POST",
    { ...routine, title: "  Find fresh ideas  " },
    a.token,
  );
  assert.equal(created.status, 201);
  const item = created.data;
  assert.deepEqual(item.days, [1, 3, 5]);
  assert.equal(item.title, routine.title);
  assert.equal(item.time, "09:00");
  assert.equal(item.active, true);
  assert.equal(item.run_at, null);
  assert.ok(new Date(item.next_run_at).getTime() > Date.now());
  assert.equal(new Date(item.next_run_at).getUTCHours(), 2);
  for (const key of [
    "last_run_at",
    "last_run_trigger",
    "last_task_id",
    "last_run_status",
  ])
    assert.equal(item[key], null);
  assert.deepEqual(
    (await request("?once=false", "GET", undefined, a.token)).data,
    [item],
  );
  assert.equal(
    (
      await fixture.db.query("SELECT title FROM routines WHERE id=$1", [
        item.id,
      ])
    ).rows[0].title,
    routine.title,
  );
  assert.deepEqual((await request("", "GET", undefined, b.token)).data, []);
  for (const method of ["PATCH", "DELETE"])
    assert.equal(
      (
        await request(
          `/${item.id}`,
          method,
          method === "PATCH" ? { active: false } : undefined,
          b.token,
        )
      ).status,
      404,
    );
  const paused = await request(
    `/${item.id}`,
    "PATCH",
    { active: false },
    a.token,
  );
  assert.equal(paused.status, 200);
  assert.equal(paused.data.active, false);
  assert.equal(paused.data.next_run_at, null);
  await fixture.db.query(
    "UPDATE routines SET next_run_at=now()-interval '30 days',active=true WHERE id=$1",
    [item.id],
  );
  const resumed = await request(
    `/${item.id}`,
    "PATCH",
    { active: true, time: "18:30", days: [7], platform: "LinkedIn" },
    a.token,
  );
  assert.equal(resumed.status, 200);
  assert.equal(resumed.data.platform, "LinkedIn");
  const at = new Date(resumed.data.next_run_at);
  assert.ok(at.getTime() > Date.now());
  assert.equal(at.getUTCDay(), 0);
  assert.equal(at.getUTCHours(), 11);
  assert.equal(at.getUTCMinutes(), 30);
  assert.equal(
    (await request(`/${item.id}`, "DELETE", undefined, a.token)).status,
    204,
  );
  assert.equal(
    (await request(`/${item.id}`, "DELETE", undefined, a.token)).status,
    404,
  );
  assert.deepEqual((await request("", "GET", undefined, a.token)).data, []);
});

test("strict schedule validation rejects invalid create and update fields without saving changes", async () => {
  const a = await account();
  for (const changes of [
    { timezone: "Mars/Olympus" },
    { days: [] },
    { days: [0] },
    { days: [8] },
    { days: [1.5] },
    { days: Array(8).fill(1) },
    { time: "9am" },
    { time: "24:00" },
    { platform: "TikTok" },
    { title: " " },
    { title: "a".repeat(121) },
    { instructions: " " },
    { instructions: "a".repeat(4001) },
    { active: "true" },
    { user_id: a.id },
    { run_at: future() },
  ])
    assert.equal(
      (await request("", "POST", { ...routine, ...changes }, a.token)).status,
      400,
    );
  assert.deepEqual((await request("", "GET", undefined, a.token)).data, []);
  const created = (
    await request("", "POST", { ...routine, active: false }, a.token)
  ).data;
  assert.equal(created.next_run_at, null);
  for (const changes of [
    { timezone: "Mars/Olympus" },
    { days: [] },
    { time: "25:00" },
    { platform: "TikTok" },
    { user_id: a.id },
    { run_at: future() },
  ])
    assert.equal(
      (await request(`/${created.id}`, "PATCH", changes, a.token)).status,
      400,
    );
  assert.deepEqual((await request("", "GET", undefined, a.token)).data, [
    created,
  ]);
  assert.equal(
    (await request("?once=yes", "GET", undefined, a.token)).status,
    400,
  );
  assert.equal((await request("/bad-id", "PATCH", {}, a.token)).status, 400);
  assert.equal(
    (await request("/bad-id", "DELETE", undefined, a.token)).status,
    400,
  );
});

test("one-time schedules retain absolute instants, stay separate, and enforce update/cancel rules", async () => {
  const a = await account(),
    b = await account();
  const input = onceTask();
  for (const changes of [
    { run_at: new Date(Date.now() - 1000).toISOString() },
    { run_at: "2027-01-01T10:00:00" },
    { timezone: "Mars/Olympus" },
    { days: [1] },
    { time: "09:00" },
    { active: false },
  ])
    assert.equal(
      (await request("", "POST", { ...input, ...changes }, a.token)).status,
      400,
    );
  const created = await request("", "POST", input, a.token);
  assert.equal(created.status, 201);
  const item = created.data;
  assert.equal(item.run_at, input.run_at);
  assert.equal(item.next_run_at, input.run_at);
  assert.equal(item.platform, null);
  assert.equal(item.days, null);
  assert.equal(item.time, null);
  assert.equal(item.active, true);
  assert.deepEqual((await request("", "GET", undefined, a.token)).data, []);
  assert.deepEqual(
    (await request("?once=true", "GET", undefined, a.token)).data,
    [item],
  );
  assert.deepEqual(
    (await request("?once=true", "GET", undefined, b.token)).data,
    [],
  );
  assert.equal(
    (await request(`/${item.id}`, "PATCH", { title: "Foreign" }, b.token))
      .status,
    404,
  );
  assert.equal(
    (await request(`/${item.id}`, "DELETE", undefined, b.token)).status,
    404,
  );
  for (const changes of [{ time: "09:00" }, { days: [2] }, { active: false }])
    assert.equal(
      (await request(`/${item.id}`, "PATCH", changes, a.token)).status,
      400,
    );
  const instant = new Date(future(2));
  const offset = instant.toISOString().replace("Z", "+00:00");
  const updated = await request(
    `/${item.id}`,
    "PATCH",
    { platform: "X", run_at: offset, timezone: "America/New_York" },
    a.token,
  );
  assert.equal(updated.status, 200);
  assert.equal(updated.data.run_at, instant.toISOString());
  assert.equal(updated.data.next_run_at, instant.toISOString());
  assert.equal(updated.data.timezone, "America/New_York");
  assert.equal(updated.data.platform, "X");
  assert.equal(
    (await request(`/${item.id}`, "PATCH", { platform: null }, a.token)).data
      .platform,
    null,
  );
  assert.equal(
    (await request(`/${item.id}`, "DELETE", undefined, a.token)).status,
    204,
  );
  assert.deepEqual(
    (await request("?once=true", "GET", undefined, a.token)).data,
    [],
  );
});

test("one-time tasks already claimed by a worker cannot be edited or cancelled", async () => {
  const a = await account();
  const item = (await request("", "POST", onceTask(), a.token)).data;
  // Simulate the persisted state a worker will set when it claims this occurrence.
  await fixture.db.query(
    "UPDATE routines SET active=false,next_run_at=NULL WHERE id=$1",
    [item.id],
  );
  assert.equal(
    (await request(`/${item.id}`, "PATCH", { title: "Too late" }, a.token))
      .status,
    409,
  );
  assert.equal(
    (await request(`/${item.id}`, "DELETE", undefined, a.token)).status,
    409,
  );
});

test("the shared 50-schedule cap holds under concurrent requests and excludes completed one-time tasks", async () => {
  const a = await account(),
    b = await account();
  await fixture.db.query(
    `INSERT INTO routines(user_id,platform,title,instructions,time_of_day,days,timezone,active)
     SELECT $1,'X','Paused '||n,'Find ideas','09:00',ARRAY[1]::smallint[],'UTC',false FROM generate_series(1,49) n`,
    [a.id],
  );
  await fixture.db.query(
    `INSERT INTO routines(user_id,title,instructions,timezone,run_at,active)
     VALUES ($1,'Already started','Find ideas','UTC',now()-interval '1 day',false)`,
    [a.id],
  );
  const results = await Promise.all([
    request("", "POST", onceTask(), a.token),
    request("", "POST", routine, a.token),
  ]);
  assert.deepEqual(results.map((result) => result.status).sort(), [201, 409]);
  assert.equal(
    (
      await fixture.db.query(
        "SELECT count(*)::int AS count FROM routines WHERE user_id=$1 AND (run_at IS NULL OR active)",
        [a.id],
      )
    ).rows[0].count,
    50,
  );
  assert.equal((await request("", "POST", routine, b.token)).status, 201);
  const created = results.find((result) => result.status === 201)!.data;
  assert.equal(
    (await request(`/${created.id}`, "DELETE", undefined, a.token)).status,
    204,
  );
  assert.equal((await request("", "POST", onceTask(), a.token)).status, 201);
});

test("run history exposes the latest live task status and deleting routines keeps their work", async () => {
  const a = await account();
  const item = (await request("", "POST", routine, a.token)).data;
  let taskId = "",
    turnId = "";
  await transaction(fixture.db, async (client) => {
    taskId = (
      await client.query(
        "INSERT INTO tasks(user_id,kind,title,platform) VALUES ($1,'work','Ideas','Threads') RETURNING id",
        [a.id],
      )
    ).rows[0].id;
    turnId = (
      await client.query(
        "INSERT INTO turns(task_id) VALUES ($1) RETURNING id",
        [taskId],
      )
    ).rows[0].id;
    await client.query("UPDATE tasks SET current_turn_id=$2 WHERE id=$1", [
      taskId,
      turnId,
    ]);
    await client.query(
      "INSERT INTO routine_runs(routine_id,trigger,scheduled_for,created_at) VALUES ($1,'schedule',now()-interval '1 day',now()-interval '1 day')",
      [item.id],
    );
    await client.query(
      "INSERT INTO routine_runs(routine_id,trigger,scheduled_for,task_id) VALUES ($1,'manual',now(),$2)",
      [item.id, taskId],
    );
  });
  const listed = (await request("", "GET", undefined, a.token)).data[0];
  assert.equal(listed.last_run_trigger, "manual");
  assert.equal(listed.last_task_id, taskId);
  assert.equal(listed.last_run_status, "queued");
  await fixture.db.query("UPDATE turns SET status='completed' WHERE id=$1", [
    turnId,
  ]);
  assert.equal(
    (await request("", "GET", undefined, a.token)).data[0].last_run_status,
    "completed",
  );
  assert.equal(
    (await request(`/${item.id}`, "DELETE", undefined, a.token)).status,
    204,
  );
  assert.equal(
    (
      await fixture.db.query("SELECT 1 FROM routine_runs WHERE routine_id=$1", [
        item.id,
      ])
    ).rowCount,
    0,
  );
  assert.equal(
    (await fixture.db.query("SELECT 1 FROM tasks WHERE id=$1", [taskId]))
      .rowCount,
    1,
  );
});

test("database constraints protect schedule shape, current-turn ownership and occurrence uniqueness", async () => {
  const a = await account();
  const item = (await request("", "POST", routine, a.token)).data;
  for (const change of [
    "run_at=now()",
    "days=ARRAY[8]::smallint[]",
    "active=false",
    "platform='TikTok'",
  ]) {
    await assert.rejects(
      fixture.db.query(`UPDATE routines SET ${change} WHERE id=$1`, [item.id]),
      { code: "23514" },
    );
  }
  await fixture.db.query(
    "INSERT INTO routine_runs(routine_id,trigger,scheduled_for) VALUES ($1,'schedule','2026-10-21T02:00:00Z')",
    [item.id],
  );
  await assert.rejects(
    fixture.db.query(
      "INSERT INTO routine_runs(routine_id,trigger,scheduled_for) VALUES ($1,'schedule','2026-10-21T02:00:00Z')",
      [item.id],
    ),
    { code: "23505" },
  );
  await fixture.db.query(
    "INSERT INTO routine_runs(routine_id,trigger,scheduled_for) SELECT $1,'manual','2026-10-21T02:00:00Z' FROM generate_series(1,2)",
    [item.id],
  );
  const tasks = (
    await fixture.db.query(
      "INSERT INTO tasks(user_id,kind,title) SELECT $1,'work','Ideas' FROM generate_series(1,2) RETURNING id",
      [a.id],
    )
  ).rows;
  const turn = (
    await fixture.db.query(
      "INSERT INTO turns(task_id) VALUES ($1) RETURNING id",
      [tasks[0].id],
    )
  ).rows[0];
  await assert.rejects(
    fixture.db.query("UPDATE tasks SET current_turn_id=$2 WHERE id=$1", [
      tasks[1].id,
      turn.id,
    ]),
    { code: "23503" },
  );
  await fixture.db.query("DELETE FROM users WHERE id=$1", [a.id]);
  for (const table of ["tasks", "routines"])
    assert.equal(
      (
        await fixture.db.query(`SELECT 1 FROM ${table} WHERE user_id=$1`, [
          a.id,
        ])
      ).rowCount,
      0,
    );
  assert.equal(
    (
      await fixture.db.query("SELECT 1 FROM routine_runs WHERE routine_id=$1", [
        item.id,
      ])
    ).rowCount,
    0,
  );
  assert.equal(
    (await fixture.db.query("SELECT 1 FROM turns WHERE id=$1", [turn.id]))
      .rowCount,
    0,
  );
});

test("without a model, run-now is refused and never creates queued work", async () => {
  const a = await account();
  const item = (await request("", "POST", routine, a.token)).data;
  const run = await request(`/${item.id}/run`, "POST", {}, a.token);
  assert.equal(run.status, 503);
  assert.equal(run.data.error, "Orca’s model provider is not configured.");
  assert.equal((await request("/bad-id/run", "POST", {}, a.token)).status, 400);
  assert.equal(
    (await fixture.db.query("SELECT 1 FROM tasks WHERE user_id=$1", [a.id]))
      .rowCount,
    0,
  );
  assert.equal(
    (
      await fixture.db.query("SELECT 1 FROM routine_runs WHERE routine_id=$1", [
        item.id,
      ])
    ).rowCount,
    0,
  );
});

async function profile(token: string, body?: unknown) {
  const response = await fetch(url.replace(/\/routines$/, "/brand-profile"), {
    method: body === undefined ? "GET" : "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, data: (await response.json()) as any };
}
async function timezone(token: string, zone: string) {
  return fetch(url.replace(/\/routines$/, "/auth/me"), {
    headers: { Authorization: `Bearer ${token}`, "X-Timezone": zone },
  });
}
const completeProfile = {
  company: "Building a product",
  topics: "Product development",
  onboarding_status: "completed",
  links: [{ name: "Founder on X", url: "https://x.com/founder", kind: "x" }],
};

test("completed profiles seed defaults once per social link after learning a valid timezone", async () => {
  const a = await account();
  assert.equal(
    (
      await profile(a.token, {
        ...completeProfile,
        links: [
          ...completeProfile.links,
          {
            name: "Founder IG",
            url: "https://instagram.com/founder",
            kind: "instagram",
          },
          { name: "Website", url: "https://example.com", kind: "website" },
        ],
      })
    ).status,
    200,
  );
  assert.deepEqual((await request("", "GET", undefined, a.token)).data, []);
  await timezone(a.token, "Not/AZone");
  assert.deepEqual((await request("", "GET", undefined, a.token)).data, []);
  assert.equal((await timezone(a.token, "Asia/Bangkok")).status, 200);
  const seeded = (await request("", "GET", undefined, a.token)).data;
  assert.equal(seeded.length, 10);
  // One posts sync for all accounts, with no platform of its own.
  const sync = seeded.find((item: any) => item.platform === null);
  assert.equal(sync.title, "Read my posts");
  assert.equal(
    sync.instructions,
    "Read the sync-my-posts skill with read_skill, then follow it for every social account in the brand profile, in this one task.",
  );
  assert.equal(sync.time, "07:00");
  assert.deepEqual(sync.days, [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(seeded.filter((item: any) => item.platform === "X").length, 6);
  assert.equal(
    seeded.filter((item: any) => item.platform === "Instagram").length,
    3,
  );
  assert.ok(
    seeded.every(
      (item: any) =>
        item.timezone === "Asia/Bangkok" && item.active && item.next_run_at,
    ),
  );
  const ideas = seeded.find(
    (item: any) => item.platform === "X" && item.title === "Content ideas",
  );
  assert.equal(
    ideas.instructions,
    "Read the find-content-ideas skill with read_skill, then follow it for Founder on X (https://x.com/founder).",
  );
  assert.equal(ideas.time, "09:00");
  assert.deepEqual(ideas.days, [1, 2, 3, 4, 5]);
  const research = seeded.find(
    (item: any) =>
      item.platform === "X" && item.title === "Weekly strategy research",
  );
  assert.equal(research.time, "10:00");
  assert.deepEqual(research.days, [1]);
  // Each default carries its work type, so the app labels its deliverables.
  assert.deepEqual(
    Object.fromEntries(
      seeded
        .filter((item: any) => item.platform === "X")
        .map((item: any) => [item.title, item.work_type]),
    ),
    {
      "Content ideas": "ideas",
      "Conversations to join": "conversations",
      "Weekly strategy research": "strategy",
      "People to connect": "conversations",
      "Connect post": "content",
      "Daily quote": "content",
    },
  );
  const quote = seeded.find(
    (item: any) => item.platform === "Instagram" && item.title === "Daily quote",
  );
  assert.equal(quote.time, "18:00");
  assert.deepEqual(quote.days, [1, 2, 3, 4, 5, 6, 7]);
  assert.ok(
    !seeded.some(
      (item: any) =>
        item.platform === "Instagram" &&
        ["People to connect", "Connect post"].includes(item.title),
    ),
  );
  // Editing/deleting defaults and learning a different zone must not recreate them.
  await request(
    `/${research.id}`,
    "PATCH",
    { instructions: "My own research process", active: false },
    a.token,
  );
  await request(`/${ideas.id}`, "DELETE", undefined, a.token);
  await request(`/${sync.id}`, "DELETE", undefined, a.token);
  await profile(a.token, { topics: "AI products" });
  await timezone(a.token, "Europe/Berlin");
  const kept = (await request("", "GET", undefined, a.token)).data;
  assert.equal(kept.length, 8);
  assert.ok(!kept.some((item: any) => item.platform === null));
  assert.equal(
    kept.find((item: any) => item.id === research.id).instructions,
    "My own research process",
  );
  assert.ok(kept.every((item: any) => item.timezone === "Asia/Bangkok"));
  const current = (await profile(a.token)).data;
  assert.equal(
    (
      await profile(a.token, {
        links: [
          ...current.links,
          {
            name: "Founder LinkedIn",
            url: "https://linkedin.com/in/founder",
            kind: "linkedin",
          },
          { name: "Product on X", url: "https://x.com/product", kind: "x" },
        ],
      })
    ).status,
    200,
  );
  const added = (await request("", "GET", undefined, a.token)).data;
  assert.equal(added.length, 20);
  assert.equal(
    added.filter((item: any) => item.platform === "LinkedIn").length,
    6,
  );
  assert.equal(
    added.filter((item: any) => item.instructions.includes("Product on X"))
      .length,
    6,
  );
  assert.ok(
    added
      .filter((item: any) => item.platform === "LinkedIn")
      .every((item: any) => item.timezone === "Europe/Berlin"),
  );
  const markers = (
    await fixture.db.query(
      "SELECT kind,routines_seeded_at FROM brand_profile_links WHERE user_id=$1",
      [a.id],
    )
  ).rows;
  assert.equal(markers.filter((item) => item.routines_seeded_at).length, 4);
  assert.equal(
    markers.find((item) => item.kind === "website")!.routines_seeded_at,
    null,
  );
});

test("known-zone profile completion is idempotent under concurrent saves and ignores incomplete profiles", async () => {
  const a = await account();
  await timezone(a.token, "UTC");
  assert.equal(
    (
      await profile(a.token, {
        ...completeProfile,
        onboarding_status: "in_progress",
      })
    ).status,
    200,
  );
  assert.deepEqual((await request("", "GET", undefined, a.token)).data, []);
  const results = await Promise.all([
    profile(a.token, { onboarding_status: "completed" }),
    profile(a.token, { onboarding_status: "completed" }),
  ]);
  assert.ok(results.every((result) => result.status === 200));
  await timezone(a.token, "UTC");
  await profile(a.token, { voice: "Direct and clear" });
  assert.equal((await request("", "GET", undefined, a.token)).data.length, 7);
  assert.equal(
    (await request("?once=true", "GET", undefined, a.token)).data.length,
    0,
  );
});

test("removing a profile link pauses only its routines and clears their link references", async () => {
  const a = await account();
  await timezone(a.token, "UTC");
  await profile(a.token, {
    ...completeProfile,
    links: [
      ...completeProfile.links,
      { name: "Threads", url: "https://threads.net/@founder", kind: "threads" },
    ],
  });
  const manual = (await request("", "POST", routine, a.token)).data;
  const current = (await profile(a.token)).data;
  const x = current.links.find((link: any) => link.kind === "x");
  const foreign = await account();
  assert.equal((await profile(foreign.token, { links: [x] })).status, 404);
  assert.equal(
    (
      await profile(a.token, {
        links: current.links.filter((link: any) => link.id !== x.id),
      })
    ).status,
    200,
  );
  const rows = (
    await fixture.db.query(
      "SELECT platform,active,next_run_at,link_id FROM routines WHERE user_id=$1",
      [a.id],
    )
  ).rows;
  assert.equal(rows.length, 14);
  // The posts sync covers every account, so it keeps running.
  assert.ok(
    rows.find((item) => item.platform === null && item.link_id === null)
      .active,
  );
  assert.ok(
    rows
      .filter((item) => item.platform === "X")
      .every(
        (item) =>
          !item.active && item.next_run_at === null && item.link_id === null,
      ),
  );
  assert.ok(
    rows
      .filter((item) => item.platform === "Threads")
      .every((item) => item.active && item.next_run_at),
  );
  assert.equal(rows.filter((item) => item.link_id !== null).length, 6);
  assert.ok(
    (await request("", "GET", undefined, a.token)).data.find(
      (item: any) => item.id === manual.id,
    ).active,
  );
});

test("seeding respects the shared cap and defers a whole account's defaults until there is room", async () => {
  const a = await account();
  await timezone(a.token, "UTC");
  await fixture.db.query(
    `INSERT INTO routines(user_id,platform,title,instructions,time_of_day,days,timezone,active)
    SELECT $1,'Threads','Manual '||n,'Find ideas','09:00',ARRAY[1]::smallint[],'UTC',false FROM generate_series(1,44) n`,
    [a.id],
  );
  // The posts sync fits; the X account's six defaults wait for room.
  assert.equal((await profile(a.token, completeProfile)).status, 200);
  assert.equal((await request("", "GET", undefined, a.token)).data.length, 45);
  assert.equal(
    (
      await fixture.db.query(
        "SELECT routines_seeded_at FROM brand_profile_links WHERE user_id=$1",
        [a.id],
      )
    ).rows[0].routines_seeded_at,
    null,
  );
  const first = (await request("", "GET", undefined, a.token)).data[0];
  await request(`/${first.id}`, "DELETE", undefined, a.token);
  assert.equal((await profile(a.token, { topics: "More ideas" })).status, 200);
  assert.equal((await request("", "GET", undefined, a.token)).data.length, 50);
  assert.equal(
    (
      await fixture.db.query(
        "SELECT 1 FROM routines WHERE user_id=$1 AND link_id IS NOT NULL",
        [a.id],
      )
    ).rowCount,
    6,
  );
  assert.ok(
    (
      await fixture.db.query(
        "SELECT routines_seeded_at FROM brand_profile_links WHERE user_id=$1",
        [a.id],
      )
    ).rows[0].routines_seeded_at,
  );
  assert.equal((await request("", "POST", onceTask(), a.token)).status, 409);
});

test("failed seeding rolls back both profile completion and newly learned timezone", async (context) => {
  context.mock.method(console, "error", () => {});
  const a = await account(),
    b = await account();
  await timezone(a.token, "UTC");
  await profile(b.token, completeProfile);
  await fixture.db.query(
    "CREATE FUNCTION reject_default() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test-only failure'; END; $$; CREATE TRIGGER reject_default BEFORE INSERT ON routines FOR EACH ROW EXECUTE FUNCTION reject_default()",
  );
  try {
    assert.equal(
      (await profile(a.token, { ...completeProfile, name: "Must roll back" }))
        .status,
      500,
    );
    const unchanged = (await profile(a.token)).data;
    assert.equal(unchanged.name, "Founder");
    assert.equal(unchanged.company, "");
    assert.equal(unchanged.onboarding_status, "not_started");
    assert.deepEqual(unchanged.links, []);
    assert.equal((await timezone(b.token, "UTC")).status, 500);
    assert.equal(
      (await fixture.db.query("SELECT timezone FROM users WHERE id=$1", [b.id]))
        .rows[0].timezone,
      null,
    );
    assert.equal(
      (
        await fixture.db.query(
          "SELECT routines_seeded_at FROM brand_profile_links WHERE user_id=$1",
          [b.id],
        )
      ).rows[0].routines_seeded_at,
      null,
    );
    assert.equal((await request("", "GET", undefined, b.token)).data.length, 0);
  } finally {
    await fixture.db.query(
      "DROP TRIGGER reject_default ON routines; DROP FUNCTION reject_default()",
    );
  }
  assert.equal((await timezone(b.token, "UTC")).status, 200);
  assert.equal((await request("", "GET", undefined, b.token)).data.length, 7);
});

test("migrate gives links seeded before new defaults only the ones they are missing", async () => {
  const a = await account();
  await timezone(a.token, "UTC");
  await profile(a.token, completeProfile);
  const seeded = (await request("", "GET", undefined, a.token)).data;
  assert.equal(seeded.length, 7);
  // Back to how the account looked before the growth defaults and the posts sync
  // existed, with the founder having deleted Content ideas and added their own
  // People to connect.
  await fixture.db.query(
    "DELETE FROM routines WHERE user_id=$1 AND title = ANY($2)",
    [
      a.id,
      [
        "People to connect",
        "Connect post",
        "Daily quote",
        "Content ideas",
        "Read my posts",
      ],
    ],
  );
  await fixture.db.query(
    "UPDATE brand_profiles SET seeded_routines = '{}' WHERE user_id=$1",
    [a.id],
  );
  await fixture.db.query(
    `UPDATE brand_profile_links SET seeded_routines =
       ARRAY['find-content-ideas','conversations-to-join','weekly-strategy-research']
     WHERE user_id=$1`,
    [a.id],
  );
  await fixture.db.query(
    `INSERT INTO routines(user_id,platform,title,instructions,time_of_day,days,timezone,active,next_run_at,link_id)
     SELECT $1,'X','My connects','Read the people-to-connect skill with read_skill, then follow it my way.','08:00',ARRAY[1]::smallint[],'UTC',true,
       routine_next_run('08:00'::time,ARRAY[1]::smallint[],'UTC',now()),id
     FROM brand_profile_links WHERE user_id=$1`,
    [a.id],
  );
  await migrate(fixture.db);
  const titles = (await request("", "GET", undefined, a.token)).data
    .map((item: any) => item.title)
    .sort();
  assert.deepEqual(titles, [
    "Connect post",
    "Conversations to join",
    "Daily quote",
    "My connects",
    "Read my posts",
    "Weekly strategy research",
  ]);
  assert.deepEqual(
    (
      await fixture.db.query(
        "SELECT seeded_routines FROM brand_profile_links WHERE user_id=$1",
        [a.id],
      )
    ).rows[0].seeded_routines.sort(),
    [
      "connect-post",
      "conversations-to-join",
      "daily-quote",
      "find-content-ideas",
      "people-to-connect",
      "weekly-strategy-research",
    ],
  );
  // Running it again, or deleting a backfilled default, creates nothing more.
  const quote = (await request("", "GET", undefined, a.token)).data.find(
    (item: any) => item.title === "Daily quote",
  );
  await request(`/${quote.id}`, "DELETE", undefined, a.token);
  const sync = (await request("", "GET", undefined, a.token)).data.find(
    (item: any) => item.title === "Read my posts",
  );
  await request(`/${sync.id}`, "DELETE", undefined, a.token);
  await migrate(fixture.db);
  assert.equal((await request("", "GET", undefined, a.token)).data.length, 4);
});
