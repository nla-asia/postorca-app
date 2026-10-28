import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/app.js";
import { configFromEnv } from "../src/config.js";
import { migrate } from "../src/migrate.js";
import { issueToken } from "../src/middleware/auth.js";
import { createUser } from "../src/repositories/users.js";
import {
  appendMessage,
  createTask,
  createTurn,
  createWorkTask,
  taskHistory,
} from "../src/repositories/tasks.js";
import {
  createArtifact,
  deleteArtifact,
} from "../src/repositories/artifacts.js";
import {
  claimQueuedTurn,
  completeTurn,
  failTurn,
  failInterruptedTurns,
  staleQueuedTurns,
} from "../src/repositories/turns.js";
import { createRoutine } from "../src/repositories/routines.js";
import { temporaryPostgres } from "./postgres.js";

const secret = "task-test-secret-at-least-32-characters";
let fixture: Awaited<ReturnType<typeof temporaryPostgres>>;
let server: Server;
let url: string;
let accountNumber = 0;
before(async () => {
  fixture = await temporaryPostgres();
  await migrate(fixture.db);
  server = createApp(
    fixture.db,
    configFromEnv({ DATABASE_URL: fixture.url, JWT_SECRET: secret }),
  ).listen(0, "127.0.0.1");
  await once(server, "listening");
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/tasks`;
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
    `task-${++accountNumber}@example.com`,
    "task-test-password",
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
  return { status: response.status, data: (await response.json()) as any };
}
const work = (userId: string, title = "Write a post") =>
  createWorkTask(
    fixture.db,
    userId,
    title,
    "Draft a post for builders.",
    "Threads",
  );

test("task endpoints require authentication and validate their input", async () => {
  const id = "00000000-0000-4000-8000-000000000001";
  for (const [path, method, body] of [
    ["", "GET", undefined],
    ["", "POST", { kind: "chat", title: "Orca" }],
    [`/${id}`, "GET", undefined],
    [`/${id}`, "PATCH", { action: "approve" }],
    [`/${id}/turns`, "POST", { message: "Hello" }],
    [`/${id}/artifacts/${id}`, "PATCH", { content: "Edit" }],
  ] as const)
    assert.equal((await request(path, method, body)).status, 401);
  const a = await account();
  for (const body of [
    { kind: "other", title: "Orca" },
    { kind: "chat", title: " " },
    { kind: "chat", title: "a".repeat(201) },
  ]) {
    assert.equal((await request("", "POST", body, a.token)).status, 400);
  }
  assert.equal(
    (await request("?kind=other", "GET", undefined, a.token)).status,
    400,
  );
  assert.equal(
    (await request("/bad-id", "GET", undefined, a.token)).status,
    400,
  );
  assert.equal(
    (await request(`/${id}`, "PATCH", { action: "delete" }, a.token)).status,
    400,
  );
  assert.equal(
    (await request(`/${id}/turns`, "POST", { message: " " }, a.token)).status,
    400,
  );
  assert.equal(
    (
      await request(
        `/${id}/turns`,
        "POST",
        { message: "a".repeat(30001) },
        a.token,
      )
    ).status,
    400,
  );
  assert.deepEqual((await request("", "GET", undefined, a.token)).data, []);
});

test("chat is one conversation per account while work tasks remain independent", async () => {
  const a = await account(),
    b = await account();
  const chats = await Promise.all(
    Array.from({ length: 3 }, () =>
      request(
        "",
        "POST",
        { kind: "chat", title: "Orca", user_id: b.id },
        a.token,
      ),
    ),
  );
  assert.ok(
    chats.every(
      (result) => result.status === 201 && result.data.id === chats[0].data.id,
    ),
  );
  assert.ok(chats.every((result) => result.data.user_id === a.id));
  const existing = await request(
    "",
    "POST",
    { kind: "chat", title: "Different title" },
    a.token,
  );
  assert.equal(existing.data.title, "Orca");
  const first = await request(
    "",
    "POST",
    { kind: "work", title: "  Draft  " },
    a.token,
  );
  const second = await request(
    "",
    "POST",
    { kind: "work", title: "Draft" },
    a.token,
  );
  assert.notEqual(first.data.id, second.data.id);
  assert.equal(first.data.title, "Draft");
  assert.equal(
    (await request("?kind=work", "GET", undefined, a.token)).data.length,
    2,
  );
  assert.equal(
    (await request("?kind=chat", "GET", undefined, a.token)).data.length,
    1,
  );
  assert.deepEqual((await request("", "GET", undefined, b.token)).data, []);
  assert.deepEqual(
    (await request(`/${first.data.id}`, "GET", undefined, a.token)).data.turns,
    [],
  );
});

test("onboarding opens once with the fixed completed greeting without a provider", async () => {
  const a = await account();
  const starts = await Promise.all(
    Array.from({ length: 3 }, () =>
      request("", "POST", { kind: "onboarding", title: "Orca" }, a.token),
    ),
  );
  assert.ok(
    starts.every(
      (result) => result.status === 201 && result.data.id === starts[0].data.id,
    ),
  );
  const id = starts[0].data.id;
  const detail = (await request(`/${id}`, "GET", undefined, a.token)).data;
  assert.equal(detail.status, "completed");
  assert.equal(detail.turns.length, 1);
  assert.equal(detail.current_turn_id, detail.turns[0].id);
  assert.equal(detail.turns[0].status, "completed");
  assert.ok(detail.turns[0].finished_at);
  assert.deepEqual(
    detail.turns[0].messages.map((message: any) => message.kind),
    ["assistant"],
  );
  assert.match(detail.turns[0].messages[0].content.text, /^Hi, I’m Orca\./);
  assert.match(detail.turns[0].messages[0].content.text, /about 3 minutes/);
  assert.match(
    detail.turns[0].messages[0].content.text,
    /what are you building\?$/,
  );
  assert.equal(
    (
      await fixture.db.query(
        "SELECT onboarding_status FROM brand_profiles WHERE user_id=$1",
        [a.id],
      )
    ).rows[0].onboarding_status,
    "in_progress",
  );
  await request("", "POST", { kind: "onboarding", title: "Orca" }, a.token);
  assert.equal(
    (await request(`/${id}`, "GET", undefined, a.token)).data.turns.length,
    1,
  );
  const chat = await request(
    "",
    "POST",
    { kind: "chat", title: "Orca" },
    a.token,
  );
  assert.notEqual(chat.data.id, id);
});

test("onboarding does not reopen existing history or a completed profile", async () => {
  const a = await account(),
    b = await account();
  const task = await createTask(fixture.db, a.id, "onboarding", "Orca");
  const turn = await createTurn(fixture.db, a.id, task.id, "An earlier answer");
  await completeTurn(fixture.db, turn.id);
  await request("", "POST", { kind: "onboarding", title: "Orca" }, a.token);
  const detail = (await request(`/${task.id}`, "GET", undefined, a.token)).data;
  assert.equal(detail.turns.length, 1);
  assert.equal(detail.turns[0].messages[0].content.text, "An earlier answer");
  await fixture.db.query(
    "UPDATE brand_profiles SET onboarding_status='completed' WHERE user_id=$1",
    [b.id],
  );
  const completed = await request(
    "",
    "POST",
    { kind: "onboarding", title: "Orca" },
    b.token,
  );
  assert.deepEqual(
    (await request(`/${completed.data.id}`, "GET", undefined, b.token)).data
      .turns,
    [],
  );
  assert.equal(
    (
      await fixture.db.query(
        "SELECT onboarding_status FROM brand_profiles WHERE user_id=$1",
        [b.id],
      )
    ).rows[0].onboarding_status,
    "completed",
  );
});

test("history is ordered, raw provider data stays internal, and malformed text can be stored", async () => {
  const a = await account();
  const first = await work(a.id);
  const cut = "launch 🚀".slice(0, 8);
  const tool = await appendMessage(fixture.db, first.turn.id, "tool_result", {
    callId: "c1",
    result: { snapshot: `${cut} and a\u0000b`, nested: [cut], valid: "🚀" },
  });
  assert.equal(tool.content.result.snapshot, "launch \uFFFD and ab");
  assert.deepEqual(tool.content.result.nested, ["launch \uFFFD"]);
  assert.equal(tool.content.result.valid, "🚀");
  const assistant = await appendMessage(
    fixture.db,
    first.turn.id,
    "assistant",
    { text: "Initial draft", replay: ["private provider state"] },
  );
  const draft = await createArtifact(fixture.db, first.task.id, first.turn.id, {
    kind: "document",
    title: "Draft",
    content: "Draft body",
  });
  await completeTurn(fixture.db, first.turn.id);
  const second = await createTurn(
    fixture.db,
    a.id,
    first.task.id,
    "Refine this",
  );
  await appendMessage(fixture.db, second.id, "assistant", {
    text: "x".repeat(300),
  });
  await appendMessage(fixture.db, second.id, "assistant", { text: "" });
  await completeTurn(fixture.db, second.id);
  const detail = (await request(`/${first.task.id}`, "GET", undefined, a.token))
    .data;
  assert.deepEqual(
    detail.turns.map((item: any) => item.id),
    [first.turn.id, second.id],
  );
  assert.deepEqual(
    detail.turns[0].messages.map((item: any) => item.kind),
    ["user", "tool_result", "assistant"],
  );
  assert.deepEqual(detail.turns[0].messages[2].content, {
    text: "Initial draft",
  });
  assert.equal(detail.turns[0].artifacts[0].id, draft.id);
  assert.equal(detail.turns[0].artifacts[0].content_work, null);
  assert.deepEqual(detail.turns[1].artifacts, []);
  const raw = await taskHistory(fixture.db, first.task.id);
  assert.deepEqual(
    raw.find((item) => item.id === assistant.id)!.content.replay,
    ["private provider state"],
  );
  const after = await taskHistory(fixture.db, first.task.id, assistant.id);
  assert.equal(after.length, 3);
  const listed = (await request("?kind=work", "GET", undefined, a.token))
    .data[0];
  assert.equal(listed.summary, "x".repeat(280));
  assert.equal(listed.status, "completed");
});

test("document edits enforce task ownership, artifact membership and editable kind", async () => {
  const a = await account(),
    b = await account();
  const first = await work(a.id),
    second = await work(a.id, "Other work");
  const draft = await createArtifact(fixture.db, first.task.id, first.turn.id, {
    kind: "document",
    title: "Draft",
    content: "Original",
  });
  const idea = await createArtifact(fixture.db, first.task.id, first.turn.id, {
    kind: "idea",
    title: "Idea",
    content: "Read only",
  });
  const path = `/${first.task.id}/artifacts/${draft.id}`;
  assert.equal(
    (await request(`/${first.task.id}`, "GET", undefined, b.token)).status,
    404,
  );
  assert.equal(
    (await request(path, "PATCH", { content: "Foreign" }, b.token)).status,
    404,
  );
  assert.equal(
    (
      await request(
        `/${second.task.id}/artifacts/${draft.id}`,
        "PATCH",
        { content: "Wrong task" },
        a.token,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await request(
        `/${first.task.id}/artifacts/${idea.id}`,
        "PATCH",
        { content: "Wrong kind" },
        a.token,
      )
    ).status,
    404,
  );
  for (const content of [" ", "x".repeat(100001)])
    assert.equal(
      (await request(path, "PATCH", { content }, a.token)).status,
      400,
    );
  const edited = await request(
    path,
    "PATCH",
    { content: "  Edited draft  " },
    a.token,
  );
  assert.equal(edited.status, 200);
  assert.equal(edited.data.id, draft.id);
  assert.equal(edited.data.content, "Edited draft");
  assert.equal(
    (await request(`/${first.task.id}`, "GET", undefined, a.token)).data
      .turns[0].artifacts[0].content,
    "Edited draft",
  );
});

test("review guards active and failed work, is idempotent, and follow-ups reset approval", async () => {
  const a = await account(),
    b = await account();
  const item = await work(a.id);
  const path = `/${item.task.id}`;
  for (const action of ["approve", "archive"])
    assert.equal(
      (await request(path, "PATCH", { action }, a.token)).status,
      409,
    );
  await claimQueuedTurn(fixture.db, item.task.id, item.turn.id);
  assert.equal(
    (await request(path, "PATCH", { action: "archive" }, a.token)).status,
    409,
  );
  await completeTurn(fixture.db, item.turn.id);
  assert.equal(
    (await request(path, "PATCH", { action: "approve" }, b.token)).status,
    404,
  );
  const approvals = await Promise.all(
    Array.from({ length: 3 }, () =>
      request(path, "PATCH", { action: "approve" }, a.token),
    ),
  );
  assert.ok(
    approvals.every(
      (result) =>
        result.status === 200 &&
        result.data.approved_at === approvals[0].data.approved_at,
    ),
  );
  const next = await createTurn(fixture.db, a.id, item.task.id, "Shorten this");
  assert.equal(
    (await request(path, "GET", undefined, a.token)).data.approved_at,
    null,
  );
  await failTurn(fixture.db, next.id, "Provider failed");
  assert.equal(
    (await request(path, "PATCH", { action: "approve" }, a.token)).status,
    409,
  );
  const failed = (await request(path, "GET", undefined, a.token)).data;
  assert.equal(failed.status, "failed");
  assert.equal(failed.turns[1].error, "Provider failed");
  const archived = await request(path, "PATCH", { action: "archive" }, a.token);
  const repeated = await request(path, "PATCH", { action: "archive" }, a.token);
  assert.equal(archived.status, 200);
  assert.equal(repeated.data.archived_at, archived.data.archived_at);
  await assert.rejects(createTurn(fixture.db, a.id, item.task.id, "Again"), {
    status: 409,
  });
  const completed = await work(a.id, "Completed work");
  await completeTurn(fixture.db, completed.turn.id);
  await request(
    `/${completed.task.id}`,
    "PATCH",
    { action: "approve" },
    a.token,
  );
  assert.ok(
    (
      await request(
        `/${completed.task.id}`,
        "PATCH",
        { action: "archive" },
        a.token,
      )
    ).data.approved_at,
  );
  const empty = await createTask(fixture.db, a.id, "work", "No turn yet");
  assert.equal(
    (await request(`/${empty.id}`, "PATCH", { action: "approve" }, a.token))
      .status,
    409,
  );
  assert.equal(
    (await request(`/${empty.id}`, "PATCH", { action: "archive" }, a.token))
      .status,
    200,
  );
});

test("concurrent follow-ups and worker claims admit one winner", async () => {
  const a = await account();
  const task = await createTask(fixture.db, a.id, "work", "Work");
  const results = await Promise.allSettled([
    createTurn(fixture.db, a.id, task.id, "One"),
    createTurn(fixture.db, a.id, task.id, "Two"),
  ]);
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    1,
  );
  const rejected = results.find(
    (result) => result.status === "rejected",
  ) as PromiseRejectedResult;
  assert.equal(rejected.reason.status, 409);
  assert.match(rejected.reason.message, /Orca is already working/);
  const turn = (
    results.find(
      (result) => result.status === "fulfilled",
    ) as PromiseFulfilledResult<any>
  ).value;
  assert.deepEqual(
    (
      await Promise.all([
        claimQueuedTurn(fixture.db, task.id, turn.id),
        claimQueuedTurn(fixture.db, task.id, turn.id),
      ])
    ).sort(),
    [false, true],
  );
  assert.equal(
    await claimQueuedTurn(
      fixture.db,
      "00000000-0000-4000-8000-000000000001",
      turn.id,
    ),
    false,
  );
  assert.equal(
    (await request(`/${task.id}`, "GET", undefined, a.token)).data.turns.length,
    1,
  );
});

test("provider-unavailable turns validate ownership and never queue new work", async () => {
  const a = await account(),
    b = await account();
  const task = await createTask(fixture.db, a.id, "work", "Work");
  const path = `/${task.id}/turns`;
  assert.equal(
    (await request(path, "POST", { message: "Draft" }, b.token)).status,
    404,
  );
  const result = await request(path, "POST", { message: "Draft" }, a.token);
  assert.equal(result.status, 503);
  assert.equal(result.data.error, "Orca’s model provider is not configured.");
  const detail = (await request(`/${task.id}`, "GET", undefined, a.token)).data;
  assert.deepEqual(detail.turns, []);
  assert.equal(detail.current_turn_id, null);
});

test("message-write failures roll back work creation and approved-task follow-ups", async () => {
  const a = await account();
  const item = await work(a.id);
  await completeTurn(fixture.db, item.turn.id);
  const approved = await request(
    `/${item.task.id}`,
    "PATCH",
    { action: "approve" },
    a.token,
  );
  await fixture.db.query(
    "CREATE FUNCTION reject_message() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test-only failure'; END; $$; CREATE TRIGGER reject_message BEFORE INSERT ON messages FOR EACH ROW EXECUTE FUNCTION reject_message()",
  );
  try {
    await assert.rejects(work(a.id, "Must roll back"));
    await assert.rejects(
      createTurn(fixture.db, a.id, item.task.id, "Must roll back"),
    );
    const detail = (
      await request(`/${item.task.id}`, "GET", undefined, a.token)
    ).data;
    assert.equal(detail.turns.length, 1);
    assert.equal(detail.current_turn_id, item.turn.id);
    assert.equal(detail.approved_at, approved.data.approved_at);
    assert.equal(
      (await request("?kind=work", "GET", undefined, a.token)).data.length,
      1,
    );
  } finally {
    await fixture.db.query(
      "DROP TRIGGER reject_message ON messages; DROP FUNCTION reject_message()",
    );
  }
});

test("task lists keep newest-first limits, recurring labels, and idea content-work metadata", async () => {
  const a = await account();
  const item = await work(a.id);
  const routine = await createRoutine(fixture.db, a.id, {
    platform: "Threads",
    title: "Recurring ideas",
    instructions: "Find ideas",
    time: "09:00",
    days: [1],
    timezone: "UTC",
    active: true,
  });
  await fixture.db.query(
    "INSERT INTO routine_runs(routine_id,trigger,scheduled_for,task_id) VALUES ($1,'schedule',now(),$2)",
    [routine, item.task.id],
  );
  assert.equal(
    (await request("?kind=work", "GET", undefined, a.token)).data[0]
      .routine_title,
    "Recurring ideas",
  );
  const idea = await createArtifact(fixture.db, item.task.id, item.turn.id, {
    kind: "idea",
    title: "An idea",
    content: "A useful hook",
  });
  const onceAt = new Date(Date.now() + 3600_000).toISOString();
  const schedule = (
    await fixture.db.query(
      "INSERT INTO routines(user_id,title,instructions,timezone,run_at,next_run_at,source_artifact_id) VALUES ($1,'Create content','Develop the idea','UTC',$2,$2,$3) RETURNING id",
      [a.id, onceAt, idea.id],
    )
  ).rows[0];
  const content = await work(a.id, "Create content");
  await fixture.db.query(
    "INSERT INTO routine_runs(routine_id,trigger,scheduled_for,task_id) VALUES ($1,'schedule',$2,$3)",
    [schedule.id, onceAt, content.task.id],
  );
  const detail = (await request(`/${item.task.id}`, "GET", undefined, a.token))
    .data;
  assert.deepEqual(detail.turns[0].artifacts[0].content_work, {
    routine_id: schedule.id,
    run_at: onceAt,
    task_id: content.task.id,
    status: "queued",
  });
  const listed = (await request("?kind=work", "GET", undefined, a.token)).data;
  assert.equal(
    listed.find((row: any) => row.id === content.task.id).routine_title,
    null,
  );
  await deleteArtifact(fixture.db, item.task.id, idea.id);
  assert.equal(
    (
      await fixture.db.query(
        "SELECT source_artifact_id FROM routines WHERE id=$1",
        [schedule.id],
      )
    ).rows[0].source_artifact_id,
    null,
  );
  const b = await account();
  await fixture.db.query(
    "INSERT INTO tasks(user_id,kind,title,created_at) SELECT $1,'work','Work '||n,'2026-01-01'::timestamptz+n*interval '1 second' FROM generate_series(1,105) n",
    [b.id],
  );
  const capped = (await request("?kind=work", "GET", undefined, b.token)).data;
  assert.equal(capped.length, 100);
  assert.equal(capped[0].title, "Work 105");
  assert.equal(capped[99].title, "Work 6");
});

test("interruption recovery is durable and account deletion cascades through task contents", async () => {
  const a = await account();
  const queued = await work(a.id, "Queued"),
    running = await work(a.id, "Running"),
    completed = await work(a.id, "Completed");
  await claimQueuedTurn(fixture.db, running.task.id, running.turn.id);
  await completeTurn(fixture.db, completed.turn.id);
  await fixture.db.query(
    "UPDATE turns SET started_at=now()-interval '2 minutes' WHERE id=$1",
    [queued.turn.id],
  );
  assert.ok(
    (await staleQueuedTurns(fixture.db)).some(
      (turn) => turn.turn_id === queued.turn.id,
    ),
  );
  await failInterruptedTurns(fixture.db);
  for (const item of [queued, running]) {
    const detail = (
      await request(`/${item.task.id}`, "GET", undefined, a.token)
    ).data;
    assert.equal(detail.status, "failed");
    assert.match(detail.turns[0].error, /server restarted/);
    assert.ok(detail.turns[0].finished_at);
  }
  assert.equal(
    (await request(`/${completed.task.id}`, "GET", undefined, a.token)).data
      .status,
    "completed",
  );
  await assert.rejects(
    createArtifact(fixture.db, completed.task.id, queued.turn.id, {
      kind: "document",
      title: "Wrong task",
      content: "No",
    }),
    { code: "23503" },
  );
  const artifact = await createArtifact(
    fixture.db,
    completed.task.id,
    completed.turn.id,
    { kind: "document", title: "Draft", content: "Body" },
  );
  await fixture.db.query("DELETE FROM users WHERE id=$1", [a.id]);
  assert.equal(
    (await fixture.db.query("SELECT 1 FROM tasks WHERE user_id=$1", [a.id]))
      .rowCount,
    0,
  );
  assert.equal(
    (
      await fixture.db.query("SELECT 1 FROM turns WHERE id=$1", [
        completed.turn.id,
      ])
    ).rowCount,
    0,
  );
  assert.equal(
    (
      await fixture.db.query("SELECT 1 FROM messages WHERE turn_id=$1", [
        completed.turn.id,
      ])
    ).rowCount,
    0,
  );
  assert.equal(
    (
      await fixture.db.query("SELECT 1 FROM artifacts WHERE id=$1", [
        artifact.id,
      ])
    ).rowCount,
    0,
  );
});

test("founders edit replies and mark them done or skipped on their own tasks only", async () => {
  const a = await account(),
    b = await account();
  const first = await work(a.id);
  const reply = {
    platform: "X",
    kind: "reply",
    intent: "conversation",
    target: { url: "https://x.com/maya/status/1", author: "Maya" },
    text: "Original reply",
  };
  const card = await createArtifact(fixture.db, first.task.id, first.turn.id, {
    kind: "reply",
    title: "Reply to Maya",
    content: JSON.stringify(reply),
  });
  const draft = await createArtifact(fixture.db, first.task.id, first.turn.id, {
    kind: "document",
    title: "Draft",
    content: "Not a reply",
  });
  const path = `/${first.task.id}/artifacts/${card.id}/reply`;
  assert.equal((await request(path, "PATCH", { state: "done" }, b.token)).status, 404);
  assert.equal(
    (await request(`/${first.task.id}/artifacts/${draft.id}/reply`, "PATCH", { state: "done" }, a.token)).status,
    404,
  );
  assert.equal((await request(path, "PATCH", {}, a.token)).status, 400);
  assert.equal((await request(path, "PATCH", { state: "posted" }, a.token)).status, 400);

  const edited = await request(path, "PATCH", { text: "  Better reply  " }, a.token);
  assert.equal(edited.status, 200);
  assert.deepEqual(JSON.parse(edited.data.content), { ...reply, text: "Better reply" });
  assert.equal(edited.data.state, null);

  const done = await request(path, "PATCH", { state: "done" }, a.token);
  assert.equal(done.data.state, "done");
  assert.ok(done.data.state_at);
  assert.equal(JSON.parse(done.data.content).text, "Better reply");
  const undone = await request(path, "PATCH", { state: null }, a.token);
  assert.equal(undone.data.state, null);
  assert.equal(undone.data.state_at, null);
  const skipped = await request(path, "PATCH", { state: "skipped" }, a.token);
  assert.equal(skipped.data.state, "skipped");

  const detail = await request(`/${first.task.id}`, "GET", undefined, a.token);
  const artifact = detail.data.turns[0].artifacts.find((item: any) => item.id === card.id);
  assert.equal(artifact.state, "skipped");
});
