import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app.js";
import { createAgent, type AgentRouter } from "../src/agent/router.js";
import { configFromEnv } from "../src/config.js";
import { transaction } from "../src/db.js";
import { migrate } from "../src/migrate.js";
import { issueToken } from "../src/middleware/auth.js";
import type { Provider } from "../src/providers/types.js";
import { createArtifact } from "../src/repositories/artifacts.js";
import { startRoutineRun } from "../src/repositories/routines.js";
import { createWorkTask } from "../src/repositories/tasks.js";
import { createUser } from "../src/repositories/users.js";
import { Scheduler } from "../src/scheduler.js";
import { temporaryPostgres } from "./postgres.js";

const secret = "runs-test-secret-at-least-32-characters";
let fixture: Awaited<ReturnType<typeof temporaryPostgres>>;
let storage: string;
const previousStorage = process.env.STORAGE_DIR;
let agent: AgentRouter;
let server: Server;
let url: string;
let accountNumber = 0;
const provider: Provider = {
  async respond() {
    return { text: "Here are three ideas.", calls: [] };
  },
};

before(async () => {
  fixture = await temporaryPostgres();
  await migrate(fixture.db);
  storage = await mkdtemp(join(tmpdir(), "postorca-runs-storage-"));
  process.env.STORAGE_DIR = storage;
  agent = createAgent(fixture.db, provider);
  server = createApp(
    fixture.db,
    configFromEnv({ DATABASE_URL: fixture.url, JWT_SECRET: secret }),
    agent,
  ).listen(0, "127.0.0.1");
  await once(server, "listening");
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
after(async () => {
  await agent?.shutdown();
  if (server)
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  if (previousStorage === undefined) delete process.env.STORAGE_DIR;
  else process.env.STORAGE_DIR = previousStorage;
  await rm(storage, { recursive: true, force: true });
  await fixture?.close();
});

async function account() {
  const user = await createUser(
    fixture.db,
    "Founder",
    `runs-${++accountNumber}@example.com`,
    "runs-test-password",
  );
  return { id: user.id as string, token: issueToken(user.id, secret) };
}
async function request(
  path: string,
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
  active: true,
};
async function waitFor<T>(check: () => Promise<T | undefined>) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out");
}
const runCount = async (routineId: string) =>
  (
    await fixture.db.query("SELECT 1 FROM routine_runs WHERE routine_id=$1", [
      routineId,
    ])
  ).rowCount;

test("a due routine runs exactly once, creates Inbox work, and advances", async () => {
  const a = await account();
  const { data: created } = await request("/routines", "POST", routine, a.token);
  await fixture.db.query(
    "UPDATE routines SET next_run_at = now() - interval '5 minutes' WHERE id = $1",
    [created.id],
  );
  const scheduler = new Scheduler(fixture.db, agent, 60_000);
  const other = new Scheduler(fixture.db, agent, 60_000);
  // Two schedulers (as if two processes) racing on the same due routine.
  await Promise.all([scheduler.tick(), other.tick(), scheduler.tick()]);
  const runs = (
    await fixture.db.query("SELECT * FROM routine_runs WHERE routine_id = $1", [
      created.id,
    ])
  ).rows;
  assert.equal(runs.length, 1);
  assert.equal(runs[0].trigger, "schedule");
  const listed = await waitFor(async () => {
    const [work] = (await request("/tasks?kind=work", "GET", undefined, a.token))
      .data;
    return work?.status === "completed" ? work : undefined;
  });
  assert.equal(listed.id, runs[0].task_id);
  assert.equal(listed.platform, "Threads");
  assert.equal(listed.routine_title, "Find fresh ideas");
  assert.equal(listed.summary, "Here are three ideas.");
  const detail = (await request(`/tasks/${listed.id}`, "GET", undefined, a.token))
    .data;
  assert.equal(
    detail.turns[0].messages[0].content.text,
    "Routine: Find fresh ideas (Threads)\n\nPropose three post ideas for this week.",
  );
  const [after] = (await request("/routines", "GET", undefined, a.token)).data;
  assert.ok(new Date(after.next_run_at) > new Date());
  assert.equal(after.last_task_id, listed.id);
  assert.equal(after.last_run_status, "completed");
  await scheduler.tick();
  assert.equal(await runCount(created.id), 1);
  await Promise.all([scheduler.stop(), other.stop()]);
});

test("a scheduled occurrence cannot start twice; run now is manual and on demand", async () => {
  const a = await account();
  const { data: created } = await request(
    "/routines",
    "POST",
    { ...routine, active: false },
    a.token,
  );
  const row = { ...created, user_id: a.id };
  const at = new Date("2026-10-21T02:00:00Z");
  const first = await transaction(fixture.db, (client) =>
    startRoutineRun(client, row, "schedule", at),
  );
  const second = await transaction(fixture.db, (client) =>
    startRoutineRun(client, row, "schedule", at),
  );
  assert.ok(first);
  assert.equal(second, null);
  // While that run is still queued, another run is refused.
  const busy = await request(`/routines/${created.id}/run`, "POST", {}, a.token);
  assert.equal(busy.status, 409);
  assert.equal(busy.data.error, "This routine is already running.");
  await fixture.db.query("UPDATE turns SET status = 'completed' WHERE id = $1", [
    first!.turnId,
  ]);
  const run = await request(`/routines/${created.id}/run`, "POST", {}, a.token);
  assert.equal(run.status, 202);
  assert.ok(run.data.taskId);
  assert.equal(run.data.routine.last_task_id, run.data.taskId);
  assert.equal(run.data.routine.last_run_trigger, "manual");
  // A paused routine stays paused: running it now does not schedule it.
  assert.equal(run.data.routine.next_run_at, null);
  await waitFor(async () => {
    const detail = (
      await request(`/tasks/${run.data.taskId}`, "GET", undefined, a.token)
    ).data;
    return detail.turns[0].status === "completed" ? detail : undefined;
  });
  // Another founder cannot run it, and unknown routines are not found.
  const b = await account();
  assert.equal(
    (await request(`/routines/${created.id}/run`, "POST", {}, b.token)).status,
    404,
  );
  // Deleting a routine keeps the work it already produced.
  await request(`/routines/${created.id}`, "DELETE", undefined, a.token);
  assert.equal(
    (await request(`/tasks/${run.data.taskId}`, "GET", undefined, a.token))
      .status,
    200,
  );
});

test("one-time schedules fire once through the shared scheduler, catch up after downtime, and retain follow-ups", async () => {
  const a = await account();
  const { data: scheduled } = await request(
    "/routines",
    "POST",
    {
      title: "One-time research",
      instructions: "Find launch ideas.",
      timezone: "Asia/Bangkok",
      run_at: new Date(Date.now() + 3600_000).toISOString(),
    },
    a.token,
  );
  // Calendar tasks only run at their time, never on demand.
  assert.equal(
    (await request(`/routines/${scheduled.id}/run`, "POST", {}, a.token))
      .status,
    400,
  );
  const scheduler = new Scheduler(fixture.db, agent, 60_000);
  const other = new Scheduler(fixture.db, agent, 60_000);
  await scheduler.tick();
  assert.equal(await runCount(scheduled.id), 0);
  // Simulate a time that passed while the server was offline.
  await fixture.db.query(
    "UPDATE routines SET run_at=now()-interval '2 hours',next_run_at=now()-interval '2 hours' WHERE id=$1",
    [scheduled.id],
  );
  await Promise.all([scheduler.tick(), other.tick(), scheduler.tick()]);
  const runs = (
    await fixture.db.query("SELECT * FROM routine_runs WHERE routine_id=$1", [
      scheduled.id,
    ])
  ).rows;
  assert.equal(runs.length, 1);
  const task = await waitFor(async () => {
    const result = (
      await request(`/tasks/${runs[0].task_id}`, "GET", undefined, a.token)
    ).data;
    return result.status === "completed" ? result : undefined;
  });
  assert.equal(task.kind, "work");
  assert.equal(task.platform, null);
  const listed = (await request("/tasks?kind=work", "GET", undefined, a.token))
    .data;
  assert.equal(
    listed.find((item: { id: string }) => item.id === task.id).routine_title,
    null,
  );
  assert.match(
    task.turns[0].messages[0].content.text,
    /^Scheduled task: One-time research\n\nFind launch ideas\./,
  );
  const [after] = (await request("/routines?once=true", "GET", undefined, a.token))
    .data;
  assert.equal(after.active, false);
  assert.equal(after.next_run_at, null);
  assert.equal(after.last_task_id, task.id);
  assert.equal(
    (await request(`/routines/${scheduled.id}`, "DELETE", undefined, a.token))
      .status,
    409,
  );
  await scheduler.tick();
  assert.equal(await runCount(scheduled.id), 1);
  assert.equal(
    (
      await request(
        `/tasks/${task.id}/turns`,
        "POST",
        { message: "Refine those ideas." },
        a.token,
      )
    ).status,
    202,
  );
  await waitFor(async () => {
    const result = (await request(`/tasks/${task.id}`, "GET", undefined, a.token))
      .data;
    return result.turns.length === 2 && result.status === "completed"
      ? result
      : undefined;
  });
  await Promise.all([scheduler.stop(), other.stop()]);
});

test("a turn left queued by a crash is picked up again by the next tick", async () => {
  const a = await account();
  const { data: created } = await request(
    "/routines",
    "POST",
    { ...routine, active: false },
    a.token,
  );
  // Committed but never dispatched, as if the process stopped in between.
  const run = await transaction(fixture.db, (client) =>
    startRoutineRun(client, { ...created, user_id: a.id }, "manual", new Date()),
  );
  const scheduler = new Scheduler(fixture.db, agent, 60_000);
  await scheduler.tick();
  const status = async () =>
    (
      await fixture.db.query("SELECT status FROM turns WHERE id=$1", [
        run!.turnId,
      ])
    ).rows[0].status;
  // A turn queued moments ago may still be on its way to the agent.
  assert.equal(await status(), "queued");
  await fixture.db.query(
    "UPDATE turns SET started_at = now() - interval '2 minutes' WHERE id=$1",
    [run!.turnId],
  );
  await scheduler.tick();
  await waitFor(async () => ((await status()) === "completed" ? true : undefined));
  await scheduler.stop();
});

test("stopping the scheduler waits for its tick and starts nothing more", async () => {
  const a = await account();
  const { data: created } = await request("/routines", "POST", routine, a.token);
  const scheduler = new Scheduler(fixture.db, agent, 10);
  scheduler.start();
  await scheduler.stop();
  await fixture.db.query(
    "UPDATE routines SET next_run_at = now() - interval '1 minute' WHERE id = $1",
    [created.id],
  );
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(await runCount(created.id), 0);
});

test("an idea queues one create-content task that the scheduler runs", async () => {
  const a = await account();
  const b = await account();
  const { task, turn } = await createWorkTask(
    fixture.db,
    a.id,
    "Content ideas",
    "Find ideas",
    "X",
  );
  const idea = await createArtifact(fixture.db, task.id, turn.id, {
    kind: "idea",
    title: "The awkward first post",
    content: "**Hook**: I almost didn't post this.",
  });
  const doc = await createArtifact(fixture.db, task.id, turn.id, {
    kind: "document",
    title: "Notes",
    content: "Not an idea",
  });
  const path = (artifactId: string) =>
    `/tasks/${task.id}/artifacts/${artifactId}/content`;

  // Only the owner's ideas can be turned into content.
  assert.equal((await request(path(idea.id), "POST", {}, b.token)).status, 404);
  assert.equal((await request(path(doc.id), "POST", {}, a.token)).status, 404);
  assert.equal(
    (await request(path(idea.id), "POST", { note: "x".repeat(2001) }, a.token))
      .status,
    400,
  );

  const queued = await request(
    path(idea.id),
    "POST",
    { note: "Keep the product out of it" },
    a.token,
  );
  assert.equal(queued.status, 201);
  // Queued a few minutes out, not run immediately.
  const wait = new Date(queued.data.run_at).getTime() - Date.now();
  assert.ok(wait > 4 * 60_000 && wait <= 5 * 60_000);
  assert.equal(queued.data.platform, "X");
  // Content work, so the Inbox labels it and the voice review reads its feedback.
  assert.equal(queued.data.work_type, "content");
  assert.equal(
    queued.data.instructions,
    "Read the create-content skill with read_skill, then follow it for this idea.\n\nIdea: The awkward first post\n\n**Hook**: I almost didn't post this.\n\nFounder's note: Keep the product out of it",
  );
  // One content task per idea.
  const again = await request(path(idea.id), "POST", {}, a.token);
  assert.equal(again.status, 409);
  assert.equal(again.data.error, "Content for this idea is already queued.");
  // It is a pending Calendar task until it runs.
  const calendar = (await request("/routines?once=true", "GET", undefined, a.token))
    .data;
  assert.deepEqual(
    calendar.map((item: { id: string }) => item.id),
    [queued.data.id],
  );

  const ideaOf = async () =>
    (await request(`/tasks/${task.id}`, "GET", undefined, a.token)).data.turns[0]
      .artifacts.find((item: any) => item.id === idea.id);
  assert.deepEqual((await ideaOf()).content_work, {
    routine_id: queued.data.id,
    run_at: queued.data.run_at,
    task_id: null,
    status: null,
  });

  await fixture.db.query(
    "UPDATE routines SET next_run_at = now() - interval '1 second' WHERE id = $1",
    [queued.data.id],
  );
  const scheduler = new Scheduler(fixture.db, agent, 60_000);
  await scheduler.tick();
  await scheduler.stop();
  const work = await ideaOf();
  assert.ok(work.content_work.task_id);
  const content = await waitFor(async () => {
    const detail = (
      await request(`/tasks/${work.content_work.task_id}`, "GET", undefined, a.token)
    ).data;
    return detail.status === "completed" ? detail : undefined;
  });
  assert.equal(content.title, "The awkward first post");
  assert.equal(content.platform, "X");
  assert.match(
    content.turns[0].messages[0].content.text,
    /^Scheduled task: The awkward first post \(X\)\n\nRead the create-content skill/,
  );
  assert.equal((await ideaOf()).content_work.status, "completed");
});

test("a follow-up continues finished work with a new turn", async () => {
  const a = await account();
  const { task, turn } = await createWorkTask(fixture.db, a.id, "Draft", "Draft a post");
  // Without the turn finishing, a follow-up is refused.
  const early = await request(`/tasks/${task.id}/turns`, "POST", { message: "Shorter" }, a.token);
  assert.equal(early.status, 409);
  agent.dispatch(task.id, turn.id, a.id);
  await waitFor(async () => {
    const detail = (await request(`/tasks/${task.id}`, "GET", undefined, a.token)).data;
    return detail.status === "completed" ? detail : undefined;
  });
  const followed = await request(
    `/tasks/${task.id}/turns`,
    "POST",
    { message: "Make it shorter" },
    a.token,
  );
  assert.equal(followed.status, 202);
  const detail = await waitFor(async () => {
    const result = (await request(`/tasks/${task.id}`, "GET", undefined, a.token)).data;
    return result.turns.length === 2 && result.status === "completed"
      ? result
      : undefined;
  });
  assert.equal(detail.turns[1].messages[0].content.text, "Make it shorter");
});

test("a scheduled post becomes a founder reminder or an agent run, and records how it ended", async () => {
  const a = await account();
  const b = await account();
  const { task, turn } = await createWorkTask(
    fixture.db,
    a.id,
    "Post draft",
    "Write it",
    "X",
  );
  const post = await createArtifact(fixture.db, task.id, turn.id, {
    kind: "document",
    title: "The awkward first post",
    content: "I almost didn't post this.\n\n**Other openings:**\n- Another line",
  });
  const second = await createArtifact(fixture.db, task.id, turn.id, {
    kind: "document",
    title: "A thread",
    content: "1/ First\n\n2/ Second",
  });
  const path = (id: string) => `/tasks/${task.id}/artifacts/${id}/publication`;
  const soon = new Date(Date.now() + 3_600_000).toISOString();
  const body = {
    text: "I almost didn't post this.",
    post_at: soon,
    publisher: "founder",
  };

  assert.equal(
    (await request(path(post.id), "POST", body, b.token)).status,
    404,
  );
  assert.equal(
    (
      await request(
        path(post.id),
        "POST",
        { ...body, post_at: new Date(Date.now() - 3_600_000).toISOString() },
        a.token,
      )
    ).status,
    400,
  );
  const scheduled = await request(path(post.id), "POST", body, a.token);
  assert.equal(scheduled.status, 201);
  assert.equal(scheduled.data.status, "scheduled");
  assert.equal(scheduled.data.source_task_id, task.id);
  // One open schedule per post.
  assert.equal(
    (await request(path(post.id), "POST", body, a.token)).status,
    409,
  );
  // It shows on the post and on the calendar as a one-time publish routine.
  const onPost = async () =>
    (await request(`/tasks/${task.id}`, "GET", undefined, a.token)).data
      .turns[0].artifacts.find((x: any) => x.id === post.id).publication;
  assert.equal((await onPost()).status, "scheduled");
  const calendar = (
    await request("/routines?once=true", "GET", undefined, a.token)
  ).data;
  assert.equal(
    calendar.find((r: any) => r.title === "Post: The awkward first post")
      .work_type,
    "publish",
  );

  // Orca posts the second one: a normal agent run.
  const byAgent = await request(
    path(second.id),
    "POST",
    { text: "1/ First\n\n2/ Second", post_at: soon, publisher: "agent" },
    a.token,
  );
  assert.equal(byAgent.status, 201);
  // Cancelled before it's due: gone from the post and the calendar.
  const cancelled = await request(path(second.id), "POST", body, a.token);
  assert.equal(cancelled.status, 409);
  assert.equal(
    (
      await request(
        `/publications/${byAgent.data.id}`,
        "DELETE",
        undefined,
        b.token,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await request(
        `/publications/${byAgent.data.id}`,
        "DELETE",
        undefined,
        a.token,
      )
    ).status,
    204,
  );
  const again = await request(
    path(second.id),
    "POST",
    { text: "1/ First\n\n2/ Second", post_at: soon, publisher: "agent" },
    a.token,
  );
  assert.equal(again.status, 201);

  await fixture.db.query(
    "UPDATE routines SET next_run_at = now() - interval '1 second' WHERE title LIKE 'Post: %'",
  );
  const scheduler = new Scheduler(fixture.db, agent, 60_000);
  await scheduler.tick();
  await scheduler.stop();

  // The founder's post: a publish task with no agent run, the post ready on it.
  const due = (
    await request(`/publications/${scheduled.data.id}`, "GET", undefined, a.token)
  ).data;
  assert.equal(due.status, "due");
  const reminder = (
    await request(`/tasks/${due.task_id}`, "GET", undefined, a.token)
  ).data;
  assert.equal(reminder.work_type, "publish");
  assert.equal(reminder.publication.text, "I almost didn't post this.");
  assert.equal(reminder.turns.length, 1);
  assert.equal(reminder.turns[0].status, "completed");
  assert.ok(
    !reminder.turns[0].messages.some((m: any) => m.kind === "assistant"),
  );
  assert.equal((await onPost()).status, "due");

  // Orca's post: dispatched to the agent with the publish-post skill.
  const agentDue = (
    await request(`/publications/${again.data.id}`, "GET", undefined, a.token)
  ).data;
  assert.equal(agentDue.status, "due");
  const run = await waitFor(async () => {
    const detail = (
      await request(`/tasks/${agentDue.task_id}`, "GET", undefined, a.token)
    ).data;
    return detail.turns[0].status === "completed" ? detail : undefined;
  });
  assert.match(run.turns[0].messages[0].content.text, /publish-post skill/);
  assert.ok(run.turns[0].messages.some((m: any) => m.kind === "assistant"));

  // Recording how it ended: owner only, a real link, once.
  assert.equal(
    (
      await request(
        `/publications/${due.id}`,
        "PATCH",
        { status: "posted", url: "https://x.com/f/status/1" },
        b.token,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await request(
        `/publications/${due.id}`,
        "PATCH",
        { status: "posted", url: "not a link" },
        a.token,
      )
    ).status,
    400,
  );
  const posted = await request(
    `/publications/${due.id}`,
    "PATCH",
    { status: "posted", url: "https://x.com/f/status/1" },
    a.token,
  );
  assert.equal(posted.data.status, "posted");
  assert.ok(posted.data.posted_at);
  assert.equal(
    (
      await request(
        `/publications/${due.id}`,
        "PATCH",
        { status: "skipped" },
        a.token,
      )
    ).status,
    404,
  );
  assert.equal(
    (await request(`/publications/${due.id}`, "DELETE", undefined, a.token))
      .status,
    409,
  );
  assert.equal((await onPost()).posted_url, "https://x.com/f/status/1");
  // A posted post can be scheduled again, and to another of the founder's
  // platforms than the task's own.
  assert.equal(
    (
      await request(
        path(post.id),
        "POST",
        { ...body, platform: "Myspace" },
        a.token,
      )
    ).status,
    400,
  );
  const elsewhere = await request(
    path(post.id),
    "POST",
    { ...body, platform: "LinkedIn" },
    a.token,
  );
  assert.equal(elsewhere.status, 201);
  assert.equal(elsewhere.data.platform, "LinkedIn");
  assert.equal((await onPost()).platform, "LinkedIn");
  const later = (
    await request("/routines?once=true", "GET", undefined, a.token)
  ).data.filter((r: any) => r.title === "Post: The awkward first post");
  assert.equal(later.at(-1).platform, "LinkedIn");
  assert.match(later.at(-1).instructions, /post this on LinkedIn/);
});
