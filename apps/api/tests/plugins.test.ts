import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { z } from "zod";
import { createApp } from "../src/app.js";
import { createAgent, type AgentRouter } from "../src/agent/router.js";
import { configFromEnv } from "../src/config.js";
import { attachDesktopSocket } from "../src/desktop/connections.js";
import { callDesktop } from "../src/desktop/calls.js";
import { migrate } from "../src/migrate.js";
import { issueToken } from "../src/middleware/auth.js";
import { catalogDrift, pluginDefinitions } from "../src/plugins/catalog.js";
import { executePluginTool, loadPluginState, releaseComputer } from "../src/plugins/service.js";
import type { PluginDefinition } from "../src/plugins/types.js";
import type { Provider } from "../src/providers/types.js";
import { createWorkTask } from "../src/repositories/tasks.js";
import { createUser } from "../src/repositories/users.js";
import { loadSkill } from "../src/skills/load.js";
import { temporaryPostgres } from "./postgres.js";

/** A plugin defined only for these tests: one desktop tool, one server tool, one skill. */
const demoPlugin: PluginDefinition = {
  code: "demo",
  name: "Demo",
  description: "Open demo pages on the founder's computer.",
  skills: [loadSkill(new URL("./fixtures/plugins/demo-use/", import.meta.url))],
  tools: [
    {
      name: "demo_open",
      description: "Open a page on the founder's computer.",
      parameters: {
        type: "object",
        properties: { url: { type: "string" } },
        required: ["url"],
        additionalProperties: false,
      },
      args: z.object({ url: z.url() }).strict(),
      runsOn: "desktop",
      timeoutMs: 75_000,
    },
    {
      name: "demo_echo",
      description: "Echo text back from the server.",
      parameters: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
        additionalProperties: false,
      },
      args: z.object({ text: z.string().max(20) }).strict(),
      runsOn: "server",
      run: async (context, args: { text: string }) => ({
        echo: args.text,
        task: context.taskId,
      }),
    },
  ],
};

const secret = "plugins-test-secret-at-least-32-characters";
let fixture: Awaited<ReturnType<typeof temporaryPostgres>>;
let storage: string;
const previousStorage = process.env.STORAGE_DIR;
let agent: AgentRouter;
let server: Server;
let socket: ReturnType<typeof attachDesktopSocket>;
let base: string;
let accountNumber = 0;

// Each founder message makes the model call `script` in order, one call per
// response; then it answers. `offered` and `prompts` record each response's tools
// and instructions.
type Call = { name: string; arguments: string };
let script: Call[] = [];
let queue: Call[] = [];
let offered: string[][] = [];
let prompts: string[] = [];
let modelDown = false;
const provider: Provider = {
  async respond({ instructions, messages, tools }) {
    if (modelDown) throw new Error("The model is unavailable.");
    offered.push(tools.map((tool) => tool.name));
    prompts.push(instructions);
    const last = messages.at(-1)!;
    if (last.kind === "user") queue = [...script];
    if (!tools.length) return { text: "final answer", calls: [] };
    const next = queue.shift();
    if (!next) return { text: "done", calls: [] };
    return { text: "", calls: [{ callId: `call-${last.id}`, ...next }] };
  },
};
const call = (name: string, args: object = {}): Call => ({
  name,
  arguments: JSON.stringify(args),
});

before(async () => {
  pluginDefinitions.push(demoPlugin);
  fixture = await temporaryPostgres();
  await migrate(fixture.db);
  storage = await mkdtemp(join(tmpdir(), "postorca-plugins-storage-"));
  process.env.STORAGE_DIR = storage;
  agent = createAgent(fixture.db, provider);
  server = createApp(
    fixture.db,
    configFromEnv({ DATABASE_URL: fixture.url, JWT_SECRET: secret }),
    agent,
  ).listen(0, "127.0.0.1");
  socket = attachDesktopSocket(server, secret);
  await once(server, "listening");
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
after(async () => {
  pluginDefinitions.splice(pluginDefinitions.indexOf(demoPlugin), 1);
  await agent?.shutdown();
  socket?.close();
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
    `plugins-${++accountNumber}@example.com`,
    "plugins-test-password",
  );
  return { id: user.id as string, token: issueToken(user.id, secret) };
}
async function request(
  path: string,
  method = "GET",
  body?: unknown,
  token?: string,
  headers: Record<string, string> = { "Content-Type": "application/json" },
): Promise<{ status: number; data: any }> {
  const response = await fetch(base + path, {
    method,
    headers: { ...headers, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined
      ? {}
      : { body: Buffer.isBuffer(body) ? body : JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, data: text ? JSON.parse(text) : null };
}
/** Sends a chat message and returns the result of the turn's last tool call. */
async function ask(token: string) {
  const chat = (
    await request("/tasks", "POST", { kind: "chat", title: "Orca" }, token)
  ).data;
  assert.equal(
    (
      await request(
        `/tasks/${chat.id}/turns`,
        "POST",
        { message: "go" },
        token,
      )
    ).status,
    202,
  );
  for (let attempt = 0; attempt < 400; attempt++) {
    const task = (await request(`/tasks/${chat.id}`, "GET", undefined, token))
      .data;
    if (["completed", "failed"].includes(task.status))
      return task.turns
        .at(-1)
        .messages.filter((message: any) => message.kind === "tool_result")
        .at(-1)?.content.result;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out");
}
/** A fake desktop install connected over the real WebSocket, answering calls with `answer`. */
async function desktop(
  token: string,
  answer: (call: any) => object | Promise<object>,
  deviceId: string = randomUUID(),
) {
  const deviceToken = (
    await request("/desktop/device-token", "POST", { deviceId }, token)
  ).data.token;
  const ws = new WebSocket(
    `${base.replace(/^http/, "ws")}/desktop/socket?token=${encodeURIComponent(deviceToken)}`,
  );
  const calls: any[] = [];
  const notifications: any[] = [];
  ws.on("message", async (raw) => {
    const message = JSON.parse(raw.toString());
    if (message.type === "notification")
      return void notifications.push(message.data);
    assert.equal(message.type, "desktop_tool_execution");
    calls.push(message.data);
    const posted = await request(
      "/desktop/tool-result",
      "POST",
      { executionId: message.data.executionId, ...(await answer(message.data)) },
      deviceToken,
    );
    assert.equal(posted.status, 204);
  });
  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  const closed = new Promise<number>((resolve) => ws.once("close", resolve));
  return { deviceId, deviceToken, ws, calls, notifications, closed };
}
/** Activates the demo plugin on the founder's chat. */
async function activate(token: string) {
  script = [call("activate_plugin", { code: "demo" })];
  assert.equal((await ask(token)).active_plugin, "demo");
}

test("migrate projects the code-defined plugin catalog and core skills into the database", async () => {
  const { rows: plugins } = await fixture.db.query(
    "SELECT code,enabled FROM plugins ORDER BY code",
  );
  assert.deepEqual(plugins, [
    { code: "browser", enabled: true },
    { code: "computer", enabled: true },
    { code: "demo", enabled: true },
  ]);
  const { rows: tools } = await fixture.db.query(
    `SELECT t.name,t.runs_on,t.timeout_ms FROM plugin_tools p JOIN tools t ON t.name=p.tool_name
     WHERE p.plugin_code='demo' ORDER BY p.position`,
  );
  assert.deepEqual(tools, [
    { name: "demo_open", runs_on: "desktop", timeout_ms: 75_000 },
    { name: "demo_echo", runs_on: "server", timeout_ms: null },
  ]);
  // Core skills belong to no plugin; the plugin's skill keeps its folder.
  const { rows: skills } = await fixture.db.query(
    `SELECT s.name,s.dir,p.plugin_code FROM skills s LEFT JOIN plugin_skills p ON p.skill_name=s.name
     WHERE s.enabled ORDER BY s.name`,
  );
  assert.deepEqual(skills, [
    { name: "browser-use", dir: "plugins/browser/skills/browser-use", plugin_code: "browser" },
    { name: "computer-use", dir: "plugins/computer/skills/computer-use", plugin_code: "computer" },
    { name: "conversations-to-join", dir: "skills/conversations-to-join", plugin_code: null },
    { name: "create-content", dir: "skills/create-content", plugin_code: null },
    { name: "demo-use", dir: "../tests/fixtures/plugins/demo-use", plugin_code: "demo" },
    { name: "find-content-ideas", dir: "skills/find-content-ideas", plugin_code: null },
    { name: "weekly-strategy-research", dir: "skills/weekly-strategy-research", plugin_code: null },
    { name: "work-content-ideas", dir: "skills/work-content-ideas", plugin_code: null },
  ]);
  // In sync after a migration; a stale schema is reported until the next one.
  assert.deepEqual(await catalogDrift(fixture.db), []);
  await fixture.db.query("UPDATE tools SET schema='{}'::jsonb WHERE name='demo_open'");
  assert.deepEqual(await catalogDrift(fixture.db), ["tool demo_open has changed"]);
  // Re-running is idempotent.
  await migrate(fixture.db);
  assert.deepEqual(await catalogDrift(fixture.db), []);
  assert.equal(
    (await fixture.db.query("SELECT 1 FROM plugin_tools WHERE plugin_code='demo'"))
      .rowCount,
    2,
  );
});

test("plugin tools and skills are available only while the task's plugin is active", async () => {
  const founder = await account();
  const install = await desktop(founder.token, (call) => ({
    ok: true,
    result: { opened: call.arguments.url },
  }));
  try {
    // Not active: not offered, and a call anyway is rejected before the desktop.
    offered = [];
    prompts = [];
    script = [call("demo_open", { url: "https://example.com" })];
    assert.deepEqual(await ask(founder.token), {
      error:
        "demo_open belongs to a plugin that is not active. Activate it with activate_plugin first.",
    });
    assert.ok(offered[0].includes("activate_plugin"));
    assert.ok(offered[0].includes("read_skill"));
    assert.ok(!offered[0].includes("demo_open"));
    assert.equal(install.calls.length, 0);
    assert.match(
      prompts[0],
      /Plugins: activate the plugin[\s\S]*Active plugin: none\nAvailable:\n- browser: Use the founder's own web browser[^\n]*\n- computer: [^\n]*\n- demo: Open demo pages on the founder's computer\.\nSkills: when a task names a skill[\s\S]*- find-content-ideas: /,
    );

    // Activation is task state; tools and skills are offered from the next response.
    offered = [];
    prompts = [];
    script = [call("activate_plugin", { code: "demo" })];
    const activated = await ask(founder.token);
    assert.equal(activated.active_plugin, "demo");
    assert.deepEqual(activated.skills, [
      { name: "demo-use", description: "How to use the demo plugin's tools." },
    ]);
    assert.ok(!offered[0].includes("demo_open"));
    assert.ok(offered[1].includes("demo_open"));
    assert.ok(offered[1].includes("demo_echo"));
    assert.match(
      prompts[1],
      /Active plugin: Demo \(demo\)[\s\S]*Skills of the active plugin:\n- demo-use: How to use the demo plugin's tools\./,
    );

    // It lasts for the task: a later turn reads the skill and uses the tools directly.
    script = [call("read_skill", { name: "demo-use" })];
    assert.match((await ask(founder.token)).content, /^# Demo use\n/);
    script = [call("demo_open", { url: "https://example.com/page" })];
    assert.deepEqual(await ask(founder.token), {
      opened: "https://example.com/page",
    });
    assert.equal(install.calls[0].tool, "demo_open");
    assert.deepEqual(install.calls[0].arguments, {
      url: "https://example.com/page",
    });
    assert.equal(install.calls[0].timeoutMs, 75_000);
    assert.ok(install.calls[0].taskId && install.calls[0].turnId);
    // Server tools run here, with validated arguments, and never reach the desktop.
    script = [call("demo_echo", { text: "hello" })];
    const echoed = await ask(founder.token);
    assert.equal(echoed.echo, "hello");
    script = [call("demo_open", { url: "not a url" })];
    assert.ok((await ask(founder.token)).error);
    assert.equal(install.calls.length, 1);

    // Unknown plugins cannot be activated; null deactivates.
    script = [call("activate_plugin", { code: "email" })];
    assert.deepEqual(await ask(founder.token), {
      error: "Plugin email is not available.",
    });
    offered = [];
    script = [call("activate_plugin", { code: null })];
    assert.equal((await ask(founder.token)).active_plugin, null);
    assert.ok(!offered[1].includes("demo_open"));
    script = [call("read_skill", { name: "demo-use" })];
    assert.deepEqual(await ask(founder.token), {
      error: "Skill demo-use is not a core skill or part of the active plugin.",
    });
    // Core skills stay readable with no plugin active, including reference files.
    script = [call("read_skill", { name: "find-content-ideas" })];
    const skill = await ask(founder.token);
    assert.match(skill.content, /^# Find content ideas/);
    assert.deepEqual(skill.files, ["references/review.md"]);
    script = [
      call("read_skill", {
        name: "find-content-ideas",
        file: "references/review.md",
      }),
    ];
    assert.equal((await ask(founder.token)).file, "references/review.md");
  } finally {
    script = [];
    install.ws.close();
  }
});

test("desktop tools fail clearly when no desktop is connected or the desktop reports an error", async () => {
  const founder = await account();
  await activate(founder.token);
  script = [call("demo_open", { url: "https://example.com" })];
  assert.deepEqual(await ask(founder.token), {
    error: "The desktop app is not connected.",
  });
  const install = await desktop(founder.token, () => ({
    ok: false,
    error: "Disk on fire",
  }));
  assert.deepEqual(await ask(founder.token), {
    error: "Desktop tool demo_open failed: Disk on fire",
  });
  // The call is no longer waiting: a repeated delivery is rejected.
  assert.equal(
    (
      await request(
        "/desktop/tool-result",
        "POST",
        { executionId: install.calls[0].executionId, ok: true, result: {} },
        install.deviceToken,
      )
    ).status,
    404,
  );
  install.ws.close();
});

test("the socket and desktop routes only accept a device-bound token", async () => {
  const founder = await account();
  const ws = new WebSocket(
    `${base.replace(/^http/, "ws")}/desktop/socket?token=${encodeURIComponent(founder.token)}`,
  );
  const error = await new Promise<Error>((resolve) => ws.once("error", resolve));
  assert.match(error.message, /401/);
  assert.equal(
    (
      await request(
        "/desktop/tool-result",
        "POST",
        { executionId: randomUUID(), ok: true, result: {} },
        founder.token,
      )
    ).status,
    401,
  );
  // A device token is minted only for a signed-in founder and a valid device ID.
  assert.equal(
    (await request("/desktop/device-token", "POST", { deviceId: randomUUID() }))
      .status,
    401,
  );
  assert.equal(
    (
      await request(
        "/desktop/device-token",
        "POST",
        { deviceId: "laptop" },
        founder.token,
      )
    ).status,
    400,
  );
});

test("calls stay with their user and device", async () => {
  const owner = await account();
  const other = await account();
  await activate(owner.token);
  const otherInstall = await desktop(other.token, () => {
    throw new Error("received another founder's call");
  });
  // Another founder's device cannot answer the owner's call.
  let intruded = 0;
  const ownerInstall = await desktop(owner.token, (call) => {
    void request(
      "/desktop/tool-result",
      "POST",
      { executionId: call.executionId, ok: true, result: { who: "intruder" } },
      otherInstall.deviceToken,
    ).then((response) => {
      assert.equal(response.status, 404);
      intruded++;
    });
    return { ok: true, result: { who: "owner" } };
  });
  script = [call("demo_open", { url: "https://example.com" })];
  assert.deepEqual(await ask(owner.token), { who: "owner" });
  assert.equal(otherInstall.calls.length, 0);
  ownerInstall.ws.close();
  otherInstall.ws.close();
  for (let attempt = 0; attempt < 100 && !intruded; attempt++)
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(intruded, 1);
});

test("a reconnecting device replaces its previous connection, and calls go to the newest desktop", async () => {
  const founder = await account();
  await activate(founder.token);
  const first = await desktop(founder.token, () => ({ ok: true, result: "first" }));
  const second = await desktop(
    founder.token,
    () => ({ ok: true, result: "second" }),
    first.deviceId,
  );
  assert.equal(await first.closed, 1012);
  script = [call("demo_open", { url: "https://example.com" })];
  assert.equal(await ask(founder.token), "second");
  const laptop = await desktop(founder.token, () => ({ ok: true, result: "laptop" }));
  assert.equal(await ask(founder.token), "laptop");
  second.ws.close();
  laptop.ws.close();
});

test("a device uploads screenshots to file storage and gets back a file key", async () => {
  const founder = await account();
  const deviceToken = (
    await request(
      "/desktop/device-token",
      "POST",
      { deviceId: randomUUID() },
      founder.token,
    )
  ).data.token;
  const png = Buffer.from("89504e470d0a1a0a0000", "hex");
  const saved = await request("/desktop/files", "POST", png, deviceToken, {
    "Content-Type": "image/png",
  });
  assert.equal(saved.status, 201);
  assert.match(
    saved.data.file,
    new RegExp(`^users/${founder.id}/screenshots/[0-9a-f-]{36}\\.png$`),
  );
  assert.deepEqual(await readFile(join(storage, saved.data.file)), png);
  // Only images, and only from a device.
  assert.equal(
    (
      await request("/desktop/files", "POST", Buffer.from("text"), deviceToken, {
        "Content-Type": "text/plain",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request("/desktop/files", "POST", png, founder.token, {
        "Content-Type": "image/png",
      })
    ).status,
    401,
  );
});

test("finished Inbox work notifies the founder's desktops; chat does not", async () => {
  const founder = await account();
  const other = await account();
  const install = await desktop(founder.token, () => ({ ok: true, result: {} }));
  const received: { title: string; body: string; taskId: string }[] =
    install.notifications;
  const laptop = await desktop(founder.token, () => ({ ok: true, result: {} }));
  const stranger = await desktop(other.token, () => ({ ok: true, result: {} }));
  script = [];
  await ask(founder.token);
  assert.deepEqual(install.notifications, []);
  const settledWork = async (title: string) => {
    const { task, turn } = await createWorkTask(fixture.db, founder.id, title, "Do it");
    agent.dispatch(task.id, turn.id, founder.id);
    for (let attempt = 0; attempt < 80 && install.notifications.length < 1; attempt++)
      await new Promise((resolve) => setTimeout(resolve, 25));
    return task.id;
  };
  const done = await settledWork("Draft a post");
  // Every desktop the founder has online hears it, and nobody else's.
  for (let attempt = 0; attempt < 40 && !laptop.notifications.length; attempt++)
    await new Promise((resolve) => setTimeout(resolve, 25));
  const ready = { title: "Draft a post", body: "Ready for your review.", taskId: done };
  assert.deepEqual(install.notifications, [ready]);
  assert.deepEqual(laptop.notifications, [ready]);
  assert.deepEqual(stranger.notifications, []);
  // A failed run says how it ended.
  received.length = 0;
  modelDown = true;
  try {
    const failed = await settledWork("Research launches");
    assert.deepEqual(received, [
      {
        title: "Research launches",
        body: "Orca could not complete this turn. Please try a follow-up.",
        taskId: failed,
      },
    ]);
  } finally {
    modelDown = false;
  }
  for (const socket of [install, laptop, stranger]) socket.ws.close();
});

test("the browser plugin offers its desktop tools and skill, and validates calls before the desktop", async () => {
  const founder = await account();
  const install = await desktop(founder.token, (call) => ({
    ok: true,
    result: { tool: call.tool, arguments: call.arguments },
  }));
  try {
    offered = [];
    script = [call("activate_plugin", { code: "browser" })];
    const activated = await ask(founder.token);
    assert.equal(activated.active_plugin, "browser");
    assert.deepEqual(
      activated.skills.map((skill: { name: string }) => skill.name),
      ["browser-use"],
    );
    assert.deepEqual(
      offered[1].filter((name) => name.startsWith("browser_")),
      [
        "browser_fetch_file",
        "browser_open",
        "browser_snapshot",
        "browser_screenshot",
        "browser_click",
        "browser_type",
        "browser_press",
        "browser_scroll",
        "browser_close",
      ],
    );

    script = [call("read_skill", { name: "browser-use" })];
    const skill = await ask(founder.token);
    assert.match(skill.content, /^# Browser\n/);
    assert.deepEqual(skill.files, ["references/review.md"]);

    // Valid calls go to the desktop with each tool's timeout.
    script = [call("browser_open", { url: "https://example.com/feed" })];
    assert.deepEqual(await ask(founder.token), {
      tool: "browser_open",
      arguments: { url: "https://example.com/feed" },
    });
    script = [call("browser_type", { tab: "t1", ref: "e12", text: "hello", replace: true })];
    assert.equal((await ask(founder.token)).tool, "browser_type");
    script = [call("browser_fetch_file", { tab: "t1", ref: "e3", filename: "logo.png" })];
    assert.equal((await ask(founder.token)).tool, "browser_fetch_file");
    assert.deepEqual(
      install.calls.map((sent) => [sent.tool, sent.timeoutMs]),
      [
        ["browser_open", 75_000],
        ["browser_type", 45_000],
        ["browser_fetch_file", 240_000],
      ],
    );

    // Invalid tabs, refs, URLs and keys never reach it.
    for (const invalid of [
      call("browser_open", { url: "javascript:alert(1)" }),
      call("browser_open", { url: "file:///etc/passwd" }),
      call("browser_snapshot", { tab: "tab1" }),
      call("browser_click", { tab: "t1", ref: "12" }),
      call("browser_press", { tab: "t1", key: "Control A" }),
      call("browser_scroll", { tab: "t1", direction: "left" }),
      call("browser_fetch_file", { tab: "t1" }),
      call("browser_fetch_file", { tab: "t1", ref: "e3", url: "https://example.com/a.pdf" }),
      call("browser_fetch_file", { tab: "t1", url: "ftp://example.com/a.pdf" }),
    ]) {
      script = [invalid];
      assert.ok((await ask(founder.token)).error, invalid.arguments);
    }
    assert.equal(install.calls.length, 3);
  } finally {
    script = [];
    install.ws.close();
  }
});

test("computer tools require activation, validate input, and release control between turns", async () => {
  const founder = await account();
  const install = await desktop(founder.token, (sent) => ({
    ok: true,
    result: { tool: sent.tool, arguments: sent.arguments },
  }));
  try {
    script = [call("computer_list_apps")];
    assert.match((await ask(founder.token)).error, /plugin that is not active/);
    assert.equal(install.calls.length, 0);

    offered = [];
    script = [call("activate_plugin", { code: "computer" })];
    const activated = await ask(founder.token);
    assert.equal(activated.active_plugin, "computer");
    assert.deepEqual(activated.skills.map((skill: any) => skill.name), ["computer-use"]);
    assert.deepEqual(offered[1].filter((name) => name.startsWith("computer_")), [
      "computer_list_apps", "computer_open", "computer_observe", "computer_click",
      "computer_type", "computer_press", "computer_scroll",
    ]);
    assert.ok(offered.every((names) => !names.includes("desktop_computer_session")));
    assert.deepEqual(install.calls.map((sent) => sent.arguments), [
      { active: true }, { active: false },
    ]);

    script = [call("read_skill", { name: "computer-use" })];
    assert.match((await ask(founder.token)).content, /^# Computer Use/);
    const before = install.calls.length;
    script = [call("computer_observe", { window: "7", accessibility: true, wait_ms: 5 })];
    assert.equal((await ask(founder.token)).tool, "computer_observe");
    assert.deepEqual(install.calls.slice(before).map((sent) => [sent.tool, sent.timeoutMs]), [
      ["desktop_computer_session", 20_000],
      ["computer_observe", 60_000],
      ["desktop_computer_session", 5_000],
    ]);
    assert.notEqual(install.calls[0].turnId, install.calls[before].turnId);

    const count = install.calls.length;
    for (const invalid of [
      call("computer_open", { app_id: "" }),
      call("computer_observe", { window: "7", wait_ms: 10001 }),
      call("computer_click", { window: "7", observation: "invented", x: 1, y: 2 }),
      call("computer_type", { window: "7", observation: "o1_abcdef", text: "" }),
      call("computer_press", { window: "7", observation: "o1_abcdef", key: "F99" }),
      call("computer_scroll", { window: "7", observation: "o1_abcdef", x: 1, y: 2, max_steps: 21 }),
    ]) {
      script = [invalid];
      assert.match((await ask(founder.token)).error, /Invalid arguments/);
    }
    assert.equal(install.calls.length, count);
  } finally {
    script = [];
    install.ws.close();
  }
});

test("a computer turn stays on its desktop when another device connects", async () => {
  const founder = await account();
  let laptop: Awaited<ReturnType<typeof desktop>> | undefined;
  const install = await desktop(founder.token, async (sent) => {
    if (sent.tool === "computer_list_apps")
      laptop = await desktop(founder.token, () => ({ ok: true, result: "wrong device" }));
    return { ok: true, result: { tool: sent.tool } };
  });
  try {
    script = [
      call("activate_plugin", { code: "computer" }),
      call("computer_list_apps"),
      call("computer_observe", { window: "7" }),
    ];
    assert.equal((await ask(founder.token)).tool, "computer_observe");
    assert.ok(laptop);
    assert.equal(laptop.calls.length, 0);
    assert.deepEqual(install.calls.map((sent) => sent.tool), [
      "desktop_computer_session", "desktop_computer_session", "computer_list_apps",
      "desktop_computer_session", "computer_observe", "desktop_computer_session",
    ]);
    assert.deepEqual(install.calls.at(-1).arguments, { active: false });
    assert.equal(new Set(install.calls.map((sent) => sent.turnId)).size, 1);
  } finally {
    script = [];
    install.ws.close();
    laptop?.ws.close();
  }
});

test("computer ownership is released on a plugin change, a question, and a model failure", async () => {
  for (const ending of ["switch", "question", "failure"] as const) {
    const founder = await account();
    const install = await desktop(founder.token, (sent) => {
      if (ending === "failure" && sent.arguments.active === true) modelDown = true;
      return { ok: true, result: {} };
    });
    try {
      script = [call("activate_plugin", { code: "computer" })];
      if (ending === "switch") script.push(call("activate_plugin", { code: "browser" }));
      if (ending === "question") script.push(call("request_user_input", {
        questions: [{ question: "Which app?", options: ["Calculator", "Notepad"] }],
      }));
      await ask(founder.token);
      assert.deepEqual(install.calls.map((sent) => [sent.tool, sent.arguments]), [
        ["desktop_computer_session", { active: true }],
        ["desktop_computer_session", { active: false }],
      ], ending);
    } finally {
      modelDown = false;
      script = [];
      install.ws.close();
    }
  }
});

test("computer activation fails offline and aborted desktop calls send no input", async () => {
  const founder = await account();
  script = [call("activate_plugin", { code: "computer" })];
  assert.equal((await ask(founder.token)).error, "The desktop app is not connected.");
  const install = await desktop(founder.token, () => ({ ok: true, result: {} }));
  try {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(callDesktop(
      { userId: founder.id, signal: controller.signal },
      "computer_click", { timeoutMs: 1000 }, {},
    ), /abort/i);
    assert.equal(install.calls.length, 0);
    await assert.rejects(callDesktop(
      { userId: founder.id }, "computer_list_apps",
      { timeoutMs: 1000, deviceId: randomUUID() }, {},
    ), /not connected/);
    assert.equal(install.calls.length, 0);

    // Stopping a turn must still send its release, without the aborted signal.
    const { task, turn } = await createWorkTask(fixture.db, founder.id, "Inspect an app", "Read its window");
    const abort = new AbortController();
    const context = {
      db: fixture.db, userId: founder.id, taskId: task.id, turnId: turn.id,
      signal: abort.signal,
    };
    try {
      await executePluginTool(context, await loadPluginState(fixture.db, task.id),
        "activate_plugin", { code: "computer" });
      abort.abort();
      await releaseComputer(context);
      assert.deepEqual(install.calls.map((sent) => sent.arguments), [
        { active: true }, { active: false },
      ]);
    } finally {
      await releaseComputer(context);
    }
  } finally {
    script = [];
    install.ws.close();
  }
});
