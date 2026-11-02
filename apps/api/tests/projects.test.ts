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

test("file transfer tools validate their arguments and never send project folders", async () => {
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
