import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import WebSocket from "ws";
import { createApp } from "../src/app.js";
import { configFromEnv } from "../src/config.js";
import { attachDesktopSocket } from "../src/desktop/connections.js";
import { migrate } from "../src/migrate.js";
import { issueToken } from "../src/middleware/auth.js";
import { createTask, createTurn } from "../src/repositories/tasks.js";
import { createUser } from "../src/repositories/users.js";
import { executeTool, toolsForTask } from "../src/tools/index.js";
import { temporaryPostgres } from "./postgres.js";

const secret = "projects-test-secret-at-least-32-characters";
let fixture: Awaited<ReturnType<typeof temporaryPostgres>>;
let server: Server;
let socket: ReturnType<typeof attachDesktopSocket>;
let base: string;
let accountNumber = 0;

before(async () => {
  fixture = await temporaryPostgres();
  await migrate(fixture.db);
  server = createApp(
    fixture.db,
    configFromEnv({ DATABASE_URL: fixture.url, JWT_SECRET: secret }),
  ).listen(0, "127.0.0.1");
  socket = attachDesktopSocket(server, secret);
  await once(server, "listening");
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
after(async () => {
  socket?.close();
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
    `projects-${++accountNumber}@example.com`,
    "projects-test-password",
  );
  return { id: user.id as string, token: issueToken(user.id, secret) };
}
async function request(
  path: string,
  method = "GET",
  body?: unknown,
  token?: string,
  headers: Record<string, string> = {},
) {
  const response = await fetch(base + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return {
    status: response.status,
    data: response.status === 204 ? null : ((await response.json()) as any),
  };
}
/** A founder whose onboarding is complete, with a known timezone and these links. */
async function onboarded(links: { name: string; url: string; kind: string }[]) {
  const founder = await account();
  await request("/auth/me", "GET", undefined, founder.token, {
    "X-Timezone": "Asia/Bangkok",
  });
  await request(
    "/brand-profile",
    "PUT",
    { company: "Acme", topics: "AI agents", links, onboarding_status: "completed" },
    founder.token,
  );
  return founder;
}
const workRoutines = async (token: string) =>
  (await request("/routines", "GET", undefined, token)).data.filter(
    (routine: { instructions: string }) =>
      /work-content-ideas skill/.test(routine.instructions),
  );

test("the first project folder adds one Ideas from my work routine; projects are owned and appear in the profile", async () => {
  const founder = await onboarded([
    { name: "Founder IG", url: "https://instagram.com/founder", kind: "instagram" },
    { name: "Founder on X", url: "https://x.com/founder", kind: "x" },
  ]);
  const other = await account();
  assert.equal((await workRoutines(founder.token)).length, 0);

  const first = await request(
    "/brand-profile/projects",
    "POST",
    { name: "Acme app", path: "/Users/founder/acme", description: "The product" },
    founder.token,
  );
  assert.equal(first.status, 201);
  // Prefers the X account over others.
  assert.deepEqual(first.data.createdRoutine, {
    title: "Ideas from my work",
    platform: "X",
    account: "Founder on X",
    time: "18:00",
  });
  const [routine] = await workRoutines(founder.token);
  assert.equal(
    routine.instructions,
    "Read the work-content-ideas skill with read_skill, then follow it for Founder on X (https://x.com/founder).",
  );
  assert.deepEqual(routine.days, [1, 2, 3, 4, 5]);
  assert.equal(routine.time, "18:00");
  assert.equal(routine.timezone, "Asia/Bangkok");
  assert.ok(new Date(routine.next_run_at) > new Date());

  // A second project, and a renamed routine, don't add another one.
  assert.equal(
    (await request(`/routines/${routine.id}`, "PATCH", { title: "Work posts" }, founder.token))
      .status,
    200,
  );
  const second = await request(
    "/brand-profile/projects",
    "POST",
    { name: "Docs", path: "/Users/founder/docs" },
    founder.token,
  );
  assert.equal(second.data.createdRoutine, null);
  assert.equal((await workRoutines(founder.token)).length, 1);
  assert.equal(
    (
      await request(
        "/brand-profile/projects",
        "POST",
        { name: "Again", path: "/Users/founder/acme" },
        founder.token,
      )
    ).status,
    409,
  );
  assert.equal(
    (await request("/brand-profile/projects", "POST", { name: "", path: "/x" }, founder.token))
      .status,
    400,
  );

  const profile = (await request("/brand-profile", "GET", undefined, founder.token)).data;
  assert.deepEqual(
    profile.projects.map((project: any) => [project.name, project.path, project.description]),
    [
      ["Acme app", "/Users/founder/acme", "The product"],
      ["Docs", "/Users/founder/docs", ""],
    ],
  );
  // Saving the profile leaves projects alone.
  await request("/brand-profile", "PUT", { audience: "Plain" }, founder.token);
  assert.equal(
    (await request("/brand-profile", "GET", undefined, founder.token)).data.projects.length,
    2,
  );
  const id = first.data.project.id;
  assert.equal(
    (await request(`/brand-profile/projects/${id}`, "PATCH", { name: "Acme" }, other.token))
      .status,
    404,
  );
  assert.equal(
    (await request(`/brand-profile/projects/${id}`, "DELETE", undefined, other.token)).status,
    404,
  );
  // The folder itself can't be changed, only its name and description.
  assert.equal(
    (
      await request(
        `/brand-profile/projects/${id}`,
        "PATCH",
        { name: "Acme", path: "/elsewhere" },
        founder.token,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await request(
        `/brand-profile/projects/${id}`,
        "PATCH",
        { name: "Acme", description: "New" },
        founder.token,
      )
    ).data.description,
    "New",
  );
  assert.equal(
    (await request(`/brand-profile/projects/${id}`, "DELETE", undefined, founder.token)).status,
    204,
  );
  assert.equal(
    (await request("/brand-profile", "GET", undefined, founder.token)).data.projects.length,
    1,
  );
  assert.equal(
    (await request("/brand-profile", "GET", undefined, other.token)).data.projects.length,
    0,
  );
});

test("the routine waits for a completed profile and prefers X, then LinkedIn", async () => {
  // Before onboarding: the project is saved, the routine is not added.
  const early = await account();
  const added = await request(
    "/brand-profile/projects",
    "POST",
    { name: "App", path: "/Users/early/app" },
    early.token,
  );
  assert.equal(added.status, 201);
  assert.equal(added.data.createdRoutine, null);
  // Only the first account of the preferred kinds is used: LinkedIn before Instagram.
  const linkedIn = await onboarded([
    { name: "Founder IG", url: "https://instagram.com/li-founder", kind: "instagram" },
    { name: "Founder on LinkedIn", url: "https://linkedin.com/in/founder", kind: "linkedin" },
  ]);
  assert.equal(
    (
      await request(
        "/brand-profile/projects",
        "POST",
        { name: "App", path: "/Users/li/app" },
        linkedIn.token,
      )
    ).data.createdRoutine.account,
    "Founder on LinkedIn",
  );
});

test("desktop file tools read only the founder's project folders; desktop_status answers even offline", async () => {
  const founder = await onboarded([
    { name: "Founder on X", url: "https://x.com/tools-founder", kind: "x" },
  ]);
  await request(
    "/brand-profile/projects",
    "POST",
    { name: "App", path: "/Users/founder/app" },
    founder.token,
  );
  const task = await createTask(fixture.db, founder.id, "work", "Ideas from my work");
  const turn = await createTurn(fixture.db, founder.id, task.id, "Find ideas");
  const context = { userId: founder.id, taskId: task.id, turnId: turn.id };
  const run = (name: string, args: unknown) =>
    executeTool(fixture.db, context, name, args) as Promise<any>;
  // Offered in every kind of task.
  for (const kind of ["chat", "onboarding", "work"] as const)
    for (const name of ["desktop_status", "list_dir", "read_file", "git_activity", "recent_files"])
      assert.ok(toolsForTask(kind).some((tool) => tool.name === name), name);

  assert.deepEqual(await run("desktop_status", {}), {
    available: false,
    reason: "The desktop app is not open or not signed in.",
  });
  await assert.rejects(
    run("git_activity", { path: "/Users/founder/app" }),
    /The desktop app is not connected/,
  );

  const deviceToken = (
    await request("/desktop/device-token", "POST", { deviceId: randomUUID() }, founder.token)
  ).data.token;
  const ws = new WebSocket(
    `${base.replace(/^http/, "ws")}/desktop/socket?token=${encodeURIComponent(deviceToken)}`,
  );
  const calls: any[] = [];
  ws.on("message", async (raw) => {
    const { data: call } = JSON.parse(raw.toString());
    calls.push(call);
    await request(
      "/desktop/tool-result",
      "POST",
      { executionId: call.executionId, ok: true, result: { tool: call.tool } },
      deviceToken,
    );
  });
  await once(ws, "open");
  try {
    assert.deepEqual(await run("desktop_status", {}), { tool: "desktop_status" });
    await run("git_activity", { path: "/Users/founder/app", since: "2026-10-25T18:00:00Z" });
    await run("recent_files", { path: "/Users/founder/app", hours: 48 });
    await run("read_file", { path: "/Users/founder/app/README.md" });
    await run("list_dir", {});
    // The server adds the founder's project folders; desktop_status gets none.
    assert.deepEqual(calls[0].arguments, {});
    assert.deepEqual(calls[1].arguments, {
      path: "/Users/founder/app",
      since: "2026-10-25T18:00:00Z",
      roots: ["/Users/founder/app"],
    });
    assert.deepEqual(calls[2].arguments.roots, ["/Users/founder/app"]);
    assert.deepEqual(calls[3].arguments.roots, ["/Users/founder/app"]);
    assert.deepEqual(calls[4].arguments, { roots: ["/Users/founder/app"] });
    assert.equal(calls[1].timeoutMs, 30_000);
    // The model can't choose the folders, and arguments are checked first.
    await assert.rejects(
      run("read_file", { path: "/etc/passwd", roots: ["/etc"] }),
      /Unrecognized key/,
    );
    await assert.rejects(
      run("git_activity", { path: "/Users/founder/app", commit: "--all" }),
      /commit hash/,
    );
    await assert.rejects(
      run("recent_files", { path: "/Users/founder/app", hours: 0 }),
    );
    assert.equal(calls.length, 5);
  } finally {
    ws.close();
  }
});

test("capture tools check their target and reach the desktop without project folders", async () => {
  const founder = await onboarded([
    { name: "Founder on X", url: "https://x.com/capture-founder", kind: "x" },
  ]);
  await request(
    "/brand-profile/projects",
    "POST",
    { name: "App", path: "/Users/founder/app" },
    founder.token,
  );
  const task = await createTask(fixture.db, founder.id, "work", "Demo shots");
  const turn = await createTurn(fixture.db, founder.id, task.id, "Capture the demo");
  const context = { userId: founder.id, taskId: task.id, turnId: turn.id };
  const run = (name: string, args: unknown) =>
    executeTool(fixture.db, context, name, args) as Promise<any>;
  const names = ["list_capture_targets", "screen_capture", "screen_record_start", "screen_record_stop"];
  for (const kind of ["chat", "onboarding", "work"] as const)
    for (const name of names)
      assert.ok(toolsForTask(kind).some((tool) => tool.name === name), name);
  await assert.rejects(
    run("screen_capture", { target: { type: "screen" } }),
    /The desktop app is not connected/,
  );

  const deviceToken = (
    await request("/desktop/device-token", "POST", { deviceId: randomUUID() }, founder.token)
  ).data.token;
  const ws = new WebSocket(
    `${base.replace(/^http/, "ws")}/desktop/socket?token=${encodeURIComponent(deviceToken)}`,
  );
  const calls: any[] = [];
  ws.on("message", async (raw) => {
    const { data: call } = JSON.parse(raw.toString());
    calls.push(call);
    await request(
      "/desktop/tool-result",
      "POST",
      { executionId: call.executionId, ok: true, result: { tool: call.tool } },
      deviceToken,
    );
  });
  await once(ws, "open");
  try {
    await run("list_capture_targets", {});
    await run("screen_capture", { target: { type: "window", window_id: 42 } });
    await run("screen_record_start", { target: { type: "simulator" } });
    await run("screen_record_stop", { id: "rec_1234abcd" });
    assert.deepEqual(
      calls.map((call) => [call.tool, call.arguments, call.timeoutMs]),
      [
        ["list_capture_targets", {}, 30_000],
        ["screen_capture", { target: { type: "window", window_id: 42 } }, 60_000],
        ["screen_record_start", { target: { type: "simulator" } }, 30_000],
        ["screen_record_stop", { id: "rec_1234abcd" }, 360_000],
      ],
    );
    // Targets are checked before anything reaches the desktop.
    for (const target of [
      { type: "camera" },
      { type: "window" },
      { type: "window", window_id: "42; rm -rf ~" },
      { type: "screen", display: 0 },
      { type: "simulator", udid: "--help" },
      { type: "screen", window_id: 42 },
    ])
      await assert.rejects(run("screen_record_start", { target }));
    await assert.rejects(run("screen_record_stop", {}));
    assert.equal(calls.length, 4);
  } finally {
    ws.close();
  }
});

test("file transfer tools validate arguments and protect registered sources during downloads", async () => {
  const founder = await onboarded([
    { name: "Founder on X", url: "https://x.com/transfer-founder", kind: "x" },
  ]);
  await request(
    "/brand-profile/projects",
    "POST",
    { name: "App", path: "/Users/founder/app" },
    founder.token,
  );
  const task = await createTask(fixture.db, founder.id, "work", "Collect files");
  const turn = await createTurn(fixture.db, founder.id, task.id, "Collect the files");
  const context = { userId: founder.id, taskId: task.id, turnId: turn.id };
  const run = (name: string, args: unknown) =>
    executeTool(fixture.db, context, name, args) as Promise<any>;
  for (const kind of ["chat", "onboarding", "work"] as const)
    for (const name of ["upload_file", "download_file"])
      assert.ok(toolsForTask(kind).some((tool) => tool.name === name), name);

  const deviceToken = (
    await request("/desktop/device-token", "POST", { deviceId: randomUUID() }, founder.token)
  ).data.token;
  const ws = new WebSocket(
    `${base.replace(/^http/, "ws")}/desktop/socket?token=${encodeURIComponent(deviceToken)}`,
  );
  const calls: any[] = [];
  ws.on("message", async (raw) => {
    const { data: call } = JSON.parse(raw.toString());
    calls.push(call);
    await request(
      "/desktop/tool-result",
      "POST",
      { executionId: call.executionId, ok: true, result: { tool: call.tool } },
      deviceToken,
    );
  });
  await once(ws, "open");
  try {
    await run("upload_file", { path: "demos/idea/2-payoff.mov" });
    await run("download_file", {
      url: "https://example.com/track.mp3",
      filename: "track.mp3",
      source_url: "https://example.com/music",
    });
    assert.deepEqual(
      calls.map((call) => [call.tool, call.arguments, call.timeoutMs]),
      [
        ["upload_file", { path: "demos/idea/2-payoff.mov" }, 240_000],
        [
          "download_file",
          {
            url: "https://example.com/track.mp3",
            filename: "track.mp3",
            source_url: "https://example.com/music",
            read_only_roots: ["/Users/founder/app"],
          },
          240_000,
        ],
      ],
    );
    for (const args of [
      { url: "file:///etc/passwd" },
      { url: "javascript:alert(1)" },
      { url: "https://example.com/a.mp3", source_url: "ftp://example.com" },
      { url: "https://example.com/a.mp3", directory: "/tmp" },
    ])
      await assert.rejects(run("download_file", args));
    await assert.rejects(run("upload_file", {}));
    await assert.rejects(run("upload_file", { path: "a.mov", roots: ["/etc"] }));
    assert.equal(calls.length, 2);
  } finally {
    ws.close();
  }
});

test("a project owns multiple source folders and content keeps its project through follow-ups and schedules", async () => {
  const { createWorkTask, taskDetail } = await import(
    "../src/repositories/tasks.js"
  );
  const { completeTurn } = await import("../src/repositories/turns.js");
  const { queueIdeaContent, startRoutineRun } = await import(
    "../src/repositories/routines.js"
  );
  const { schedulePost } = await import("../src/repositories/publications.js");
  const founder = await account();
  const other = await account();
  const folders = [
    "/Users/founder/mobile",
    "/Users/founder/site",
    "/Users/founder/designs",
  ];
  const added = await request(
    "/brand-profile/projects",
    "POST",
    { name: "Scholar", folders },
    founder.token,
  );
  assert.equal(added.status, 201);
  const project = added.data.project;
  assert.deepEqual(project.folders, folders);
  assert.equal(project.path, folders[0]);
  assert.equal(
    (
      await request(
        "/brand-profile/projects",
        "POST",
        { name: "No folders" },
        founder.token,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await request(
        "/brand-profile/projects",
        "POST",
        { name: "Duplicates", folders: ["/a", "/a"] },
        founder.token,
      )
    ).status,
    400,
  );
  const changed = await request(
    `/brand-profile/projects/${project.id}`,
    "PATCH",
    { name: "Scholar", folders: folders.slice(1) },
    founder.token,
  );
  assert.equal(changed.status, 200);
  assert.deepEqual(changed.data.folders, folders.slice(1));
  assert.equal(changed.data.path, folders[1]);
  // Legacy metadata updates preserve every folder.
  await request(
    `/brand-profile/projects/${project.id}`,
    "PATCH",
    { name: "KG Scholar" },
    founder.token,
  );
  const profile = (
    await request("/brand-profile", "GET", undefined, founder.token)
  ).data;
  assert.deepEqual(profile.projects[0].folders, folders.slice(1));
  assert.equal(
    (
      await request(
        `/brand-profile/projects/${project.id}`,
        "PATCH",
        { name: "Stolen", folders: ["/other"] },
        other.token,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await request(
        `/brand-profile/projects/${project.id}`,
        "PATCH",
        { name: "Empty", folders: [] },
        founder.token,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await request(
        "/tasks",
        "POST",
        { kind: "work", title: "Foreign", project_id: project.id },
        other.token,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await request(
        "/tasks",
        "POST",
        { kind: "onboarding", title: "Wrong kind", project_id: project.id },
        founder.token,
      )
    ).status,
    400,
  );
  await assert.rejects(
    createWorkTask(
      fixture.db,
      other.id,
      "Foreign",
      "Work",
      undefined,
      "content",
      project.id,
    ),
    /Project not found/,
  );
  const { task, turn } = await createWorkTask(
    fixture.db,
    founder.id,
    "Release video",
    "Plan a video",
    undefined,
    "content",
    project.id,
  );
  const unscoped = await createTask(
    fixture.db,
    founder.id,
    "work",
    "Existing work",
  );
  const second = (
    await request(
      "/brand-profile/projects",
      "POST",
      { name: "Other product", folders: ["/Users/founder/other"] },
      founder.token,
    )
  ).data.project;
  await createTask(
    fixture.db,
    founder.id,
    "work",
    "Other work",
    "content",
    second.id,
  );
  const scoped = await request(
    `/tasks?kind=work&project_id=${project.id}`,
    "GET",
    undefined,
    founder.token,
  );
  assert.deepEqual(
    scoped.data.map((row: any) => row.id),
    [task.id],
  );
  assert.equal(scoped.data[0].project_name, "KG Scholar");
  assert.ok(
    (
      await request("/tasks?kind=work", "GET", undefined, founder.token)
    ).data.some(
      (row: any) => row.id === unscoped.id && row.project_id === null,
    ),
  );
  await completeTurn(fixture.db, turn.id);
  await createTurn(fixture.db, founder.id, task.id, "Make it shorter");
  const detail = await taskDetail(fixture.db, founder.id, task.id);
  assert.equal(detail.project_id, project.id);
  assert.equal(detail.turns.length, 2);
  const context = { userId: founder.id, taskId: task.id, turnId: turn.id };
  const readProfile = (await executeTool(
    fixture.db,
    context,
    "read_brand_profile",
    {},
  )) as any;
  assert.deepEqual(
    readProfile.projects.map((row: any) => row.id),
    [project.id],
  );
  assert.deepEqual(readProfile.active_project.folders, folders.slice(1));
  const {
    rows: [idea],
  } = await fixture.db.query(
    "INSERT INTO artifacts(task_id,turn_id,kind,title,content) VALUES ($1,$2,'idea','Launch','Announce release') RETURNING id",
    [task.id, turn.id],
  );
  const scheduled = await queueIdeaContent(
    fixture.db,
    founder.id,
    task.id,
    idea.id,
  );
  assert.equal(scheduled.project_id, project.id);
  const { transaction } = await import("../src/db.js");
  const { rows: [routine] } = await fixture.db.query("SELECT * FROM routines WHERE id=$1", [scheduled.id]);
  const run = (await transaction(fixture.db, (client) => startRoutineRun(client, routine, "schedule", routine.run_at)))!;
  assert.equal(
    (await taskDetail(fixture.db, founder.id, run.taskId)).project_id,
    project.id,
  );
  const {
    rows: [document],
  } = await fixture.db.query(
    "INSERT INTO artifacts(task_id,turn_id,kind,title,content) VALUES ($1,$2,'document','Release post','We shipped') RETURNING id",
    [task.id, turn.id],
  );
  const publication = await schedulePost(
    fixture.db,
    founder.id,
    task.id,
    document.id,
    {
      text: "We shipped",
      post_at: new Date(Date.now() + 3600000).toISOString(),
      publisher: "founder",
      platform: "X",
    },
  );
  const { rows: [published] } = await fixture.db.query("SELECT routine_id FROM publications WHERE id=$1", [publication.id]);
  const publishSchedule = (
    await request("/routines?once=true", "GET", undefined, founder.token)
  ).data.find((row: any) => row.id === published.routine_id);
  assert.equal(publishSchedule.project_id, project.id);
  // Removing a project preserves tasks, artifacts, schedules and follow-up history.
  assert.equal(
    (
      await request(
        `/brand-profile/projects/${project.id}`,
        "DELETE",
        undefined,
        founder.token,
      )
    ).status,
    204,
  );
  const retained = await taskDetail(fixture.db, founder.id, task.id);
  assert.equal(retained.project_id, null);
  assert.equal(retained.turns.length, 2);
  assert.equal(retained.turns[0].artifacts.length, 2);
});

test("project file tools pass all selected folders and exclude other products", async () => {
  const founder = await account();
  const folders = ["/Users/founder/app", "/Users/founder/docs"];
  const project = (
    await request(
      "/brand-profile/projects",
      "POST",
      { name: "App", folders },
      founder.token,
    )
  ).data.project;
  await request(
    "/brand-profile/projects",
    "POST",
    { name: "Other product", folders: ["/Users/founder/other"] },
    founder.token,
  );
  const task = await createTask(
    fixture.db,
    founder.id,
    "work",
    "Demo",
    "content",
    project.id,
  );
  const turn = await createTurn(
    fixture.db,
    founder.id,
    task.id,
    "Read both folders",
  );
  const deviceToken = (
    await request(
      "/desktop/device-token",
      "POST",
      { deviceId: randomUUID() },
      founder.token,
    )
  ).data.token;
  const ws = new WebSocket(
    `${base.replace(/^http/, "ws")}/desktop/socket?token=${encodeURIComponent(deviceToken)}`,
  );
  const calls: any[] = [];
  ws.on("message", async (raw) => {
    const { data: call } = JSON.parse(raw.toString());
    calls.push(call);
    await request(
      "/desktop/tool-result",
      "POST",
      { executionId: call.executionId, ok: true, result: {} },
      deviceToken,
    );
  });
  await once(ws, "open");
  try {
    await executeTool(
      fixture.db,
      { userId: founder.id, taskId: task.id, turnId: turn.id },
      "list_dir",
      { path: folders[1] },
    );
    assert.deepEqual(calls[0].arguments.roots, folders);
  } finally {
    ws.close();
  }
});

test("the workspace migration preserves IDs and backfills existing single-folder projects", async () => {
  const { readFile } = await import("node:fs/promises");
  const isolated = await temporaryPostgres();
  try {
    await isolated.db
      .query(`CREATE TABLE brand_projects(id uuid PRIMARY KEY, path text NOT NULL);
      CREATE TABLE tasks(id uuid PRIMARY KEY); CREATE TABLE routines(id uuid PRIMARY KEY);`);
    const id = randomUUID();
    await isolated.db.query(
      "INSERT INTO brand_projects(id,path) VALUES ($1,'/existing')",
      [id],
    );
    await isolated.db.query(
      await readFile(
        new URL(
          "../src/migrations/023_project_workspaces.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const {
      rows: [project],
    } = await isolated.db.query("SELECT * FROM brand_projects WHERE id=$1", [
      id,
    ]);
    assert.deepEqual(project.folders, ["/existing"]);
    assert.equal(project.path, "/existing");
    // Older callers may still insert only path, read through the fallback.
    await isolated.db.query(
      "INSERT INTO brand_projects(id,path) VALUES ($1,'/legacy')",
      [randomUUID()],
    );
    assert.equal(
      (await isolated.db.query("SELECT count(*)::int AS n FROM brand_projects"))
        .rows[0].n,
      2,
    );
  } finally {
    await isolated.close();
  }
});

test("project chats are persistent, owned, separate from onboarding and retain history when their project is removed", async () => {
  const { appendMessage, taskDetail } = await import("../src/repositories/tasks.js");
  const { completeTurn } = await import("../src/repositories/turns.js");
  const founder = await account();
  const stranger = await account();
  const add = async (name: string, path: string) => (await request("/brand-profile/projects", "POST", { name, folders: [path] }, founder.token)).data.project;
  const first = await add("First product", "/source/first");
  const second = await add("Second product", "/source/second");
  const legacy = await createTask(fixture.db, founder.id, "chat", "Previous general chat");
  const legacyTurn = await createTurn(fixture.db, founder.id, legacy.id, "Previous general history");
  await completeTurn(fixture.db, legacyTurn.id);
  const chats = await Promise.all(Array.from({ length: 8 }, () => request("/tasks", "POST", { kind: "chat", title: "Orca", project_id: first.id }, founder.token)));
  assert.ok(chats.every((response) => response.status === 201 && response.data.id === chats[0].data.id));
  const firstChat = chats[0].data;
  const secondChat = (await request("/tasks", "POST", { kind: "chat", title: "Orca", project_id: second.id }, founder.token)).data;
  assert.notEqual(firstChat.id, secondChat.id);
  assert.notEqual(firstChat.id, legacy.id);
  assert.equal(firstChat.project_id, first.id);
  assert.equal((await request("/tasks", "POST", { kind: "chat", title: "Orca", project_id: first.id }, stranger.token)).status, 404);
  assert.equal((await request(`/tasks/${firstChat.id}`, "GET", undefined, stranger.token)).status, 404);
  assert.equal((await request("/tasks", "POST", { kind: "onboarding", title: "Orca", project_id: first.id }, founder.token)).status, 400);
  const firstTurn = await createTurn(fixture.db, founder.id, firstChat.id, "First product message");
  await appendMessage(fixture.db, firstTurn.id, "assistant", { text: "First product response" });
  await completeTurn(fixture.db, firstTurn.id);
  const secondTurn = await createTurn(fixture.db, founder.id, secondChat.id, "Second product message");
  await completeTurn(fixture.db, secondTurn.id);
  const reopened = await createTask(fixture.db, founder.id, "chat", "Changed title", undefined, first.id);
  assert.equal(reopened.id, firstChat.id);
  const history = await taskDetail(fixture.db, founder.id, reopened.id);
  assert.deepEqual(history.turns[0].messages.map((message: any) => message.content.text), ["First product message", "First product response"]);
  assert.equal((await taskDetail(fixture.db, founder.id, secondChat.id)).turns[0].messages[0].content.text, "Second product message");
  // Retiring a project chat must not collide with the retained general chat.
  assert.equal((await request(`/brand-profile/projects/${first.id}`, "DELETE", undefined, founder.token)).status, 204);
  const retained = await taskDetail(fixture.db, founder.id, firstChat.id);
  assert.equal(retained.project_id, null);
  assert.ok(retained.archived_at);
  await assert.rejects(executeTool(fixture.db, { userId: founder.id, taskId: firstChat.id, turnId: firstTurn.id }, "start_task", { title: "Old work", instructions: "Continue" }), /conversation is archived/);
  assert.equal(retained.turns[0].messages.length, 2);
  assert.equal((await createTask(fixture.db, founder.id, "chat", "Orca")).id, legacy.id);
  assert.equal((await taskDetail(fixture.db, founder.id, legacy.id)).turns[0].messages[0].content.text, "Previous general history");
  const other = await taskDetail(fixture.db, founder.id, secondChat.id);
  assert.equal(other.project_id, second.id);
  assert.equal(other.archived_at, null);
  await request(`/brand-profile/projects/${second.id}`, "DELETE", undefined, founder.token);
  assert.ok((await taskDetail(fixture.db, founder.id, secondChat.id)).archived_at);
});

test("delegation inherits the chat's project even when another project is supplied, and follow-ups cannot cross projects", async () => {
  const founder = await account();
  const add = async (name: string) => (await request("/brand-profile/projects", "POST", { name, folders: [`/source/${name}`] }, founder.token)).data.project;
  const first = await add("one");
  const second = await add("two");
  const chat = await createTask(fixture.db, founder.id, "chat", "Orca", undefined, first.id);
  const chatTurn = await createTurn(fixture.db, founder.id, chat.id, "Make content");
  const dispatched: string[] = [];
  const context = { userId: founder.id, taskId: chat.id, turnId: chatTurn.id, dispatchTask: (taskId: string) => { dispatched.push(taskId); } };
  const result = await executeTool(fixture.db, context, "start_task", { title: "Video", instructions: "Make a video", work_type: "content", project_id: second.id }, context.dispatchTask) as any;
  const { taskDetail } = await import("../src/repositories/tasks.js");
  assert.equal((await taskDetail(fixture.db, founder.id, result.task_id)).project_id, first.id);
  assert.deepEqual(dispatched, [result.task_id]);
  const other = await createTask(fixture.db, founder.id, "work", "Other product", "content", second.id);
  await assert.rejects(executeTool(fixture.db, context, "get_task", { task_id: other.id }), /Task not found in this project/);
  await assert.rejects(executeTool(fixture.db, context, "follow_up_task", { task_id: other.id, message: "Change it" }), /Task not found in this project/);
  assert.deepEqual(dispatched, [result.task_id]);
});


test("account deletion still cascades with a legacy chat and multiple project chats", async () => {
  const founder = await account();
  await createTask(fixture.db, founder.id, "chat", "Previous chat");
  for (const name of ["one", "two"]) {
    const project = (await request("/brand-profile/projects", "POST", { name, folders: [`/source/${name}`] }, founder.token)).data.project;
    await createTask(fixture.db, founder.id, "chat", "Orca", undefined, project.id);
  }
  await fixture.db.query("DELETE FROM users WHERE id=$1", [founder.id]);
  assert.equal((await fixture.db.query("SELECT count(*)::int AS n FROM tasks WHERE user_id=$1", [founder.id])).rows[0].n, 0);
  assert.equal((await fixture.db.query("SELECT count(*)::int AS n FROM brand_projects WHERE user_id=$1", [founder.id])).rows[0].n, 0);
});

test("content writers receive all owned read-only roots, not just the active project's folders", async () => {
  const { callDesktop } = await import("../src/desktop/calls.js");
  const founder = await account();
  const other = await account();
  const add = async (owner: typeof founder, name: string, folders: string[]) =>
    (await request("/brand-profile/projects", "POST", { name, folders }, owner.token)).data.project;
  const project = await add(founder, "Active", ["/source/active", "/source/docs"]);
  await add(founder, "Other", ["/source/other"]);
  await add(other, "Foreign", ["/source/foreign"]);
  const task = await createTask(fixture.db, founder.id, "work", "Plan", "content", project.id);
  const turn = await createTurn(fixture.db, founder.id, task.id, "Plan content");
  const context = { db: fixture.db, userId: founder.id, taskId: task.id, turnId: turn.id };
  const deviceToken = (await request("/desktop/device-token", "POST", { deviceId: randomUUID() }, founder.token)).data.token;
  const ws = new WebSocket(`${base.replace(/^http/, "ws")}/desktop/socket?token=${encodeURIComponent(deviceToken)}`);
  const calls: any[] = [];
  ws.on("message", async (raw) => {
    const { data: sent } = JSON.parse(raw.toString()); calls.push(sent);
    await request("/desktop/tool-result", "POST", { executionId: sent.executionId, ok: true, result: { folder: "Content/Plan", path: "/output/Content/Plan/plan.md" } }, deviceToken);
  });
  await once(ws, "open");
  try {
    await executeTool(fixture.db, context, "save_content_file", { name: "plan.md", text: "# Plan" });
    for (const name of ["screen_record_stop", "video_export"])
      await callDesktop(context, name, { timeoutMs: 1000 }, { content_folder: "Content/Plan" });
    for (const call of calls)
      assert.deepEqual(call.arguments.read_only_roots, ["/source/active", "/source/docs", "/source/other"]);
    await assert.rejects(executeTool(fixture.db, context, "save_content_file", { name: "plan.md", text: "x", read_only_roots: [] }), /Unrecognized key/);
    const profile = await executeTool(fixture.db, context, "read_brand_profile", {}) as any;
    assert.deepEqual(profile.folder_access, { source_folders: "read_only", working_folder: "read_write" });
    assert.equal(calls.length, 3);
  } finally { ws.close(); }
});
