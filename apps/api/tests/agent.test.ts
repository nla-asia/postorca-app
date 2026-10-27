import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app.js";
import { AgentLoop } from "../src/agent/loop.js";
import { createAgent, type AgentRouter } from "../src/agent/router.js";
import { configFromEnv } from "../src/config.js";
import { migrate } from "../src/migrate.js";
import { issueToken } from "../src/middleware/auth.js";
import {
  ContextTooLongError,
  type Provider,
  type StoredMessage,
  type ToolCall,
} from "../src/providers/types.js";
import { createUser } from "../src/repositories/users.js";
import {
  appendMessage,
  createTask,
  createTurn,
  createWorkTask,
  taskDetail,
} from "../src/repositories/tasks.js";
import { completeTurn } from "../src/repositories/turns.js";
import { temporaryPostgres } from "./postgres.js";

const secret = "agent-test-secret-at-least-32-characters";
let fixture: Awaited<ReturnType<typeof temporaryPostgres>>;
let storage: string;
const originalStorage = process.env.STORAGE_DIR;
let accountNumber = 0;

/** A scripted model: each test sets how it answers. Requests are recorded. */
type Request = Parameters<Provider["respond"]>[0];
let script: (request: Request) => Promise<Awaited<ReturnType<Provider["respond"]>>>;
const requests: Request[] = [];
const provider: Provider = {
  respond(request) {
    requests.push(request);
    return script(request);
  },
};
let agent: AgentRouter;
let server: Server;
let offline: Server;
let url: string;
let offlineUrl: string;

before(async () => {
  fixture = await temporaryPostgres();
  await migrate(fixture.db);
  storage = await mkdtemp(join(tmpdir(), "postorca-agent-storage-"));
  process.env.STORAGE_DIR = storage;
  const config = configFromEnv({ DATABASE_URL: fixture.url, JWT_SECRET: secret });
  agent = createAgent(fixture.db, provider);
  server = createApp(fixture.db, config, agent).listen(0, "127.0.0.1");
  offline = createApp(fixture.db, config).listen(0, "127.0.0.1");
  await Promise.all([once(server, "listening"), once(offline, "listening")]);
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/tasks`;
  offlineUrl = `http://127.0.0.1:${(offline.address() as AddressInfo).port}/api/tasks`;
});
after(async () => {
  await agent?.shutdown();
  for (const listener of [server, offline])
    if (listener)
      await new Promise<void>((resolve, reject) =>
        listener.close((error) => (error ? reject(error) : resolve())),
      );
  if (originalStorage === undefined) delete process.env.STORAGE_DIR;
  else process.env.STORAGE_DIR = originalStorage;
  await rm(storage, { recursive: true, force: true });
  await fixture?.close();
});

async function account() {
  const user = await createUser(
    fixture.db,
    "Founder",
    `agent-${++accountNumber}@example.com`,
    "agent-test-password",
  );
  return { id: user.id as string, token: issueToken(user.id, secret) };
}
async function post(base: string, path: string, body: unknown, token: string) {
  const response = await fetch(base + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return { status: response.status, data: (await response.json()) as any };
}
/** The task's detail once its latest turn has finished. */
async function settled(userId: string, taskId: string) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const detail = await taskDetail(fixture.db, userId, taskId);
    const turn = detail.turns.at(-1);
    if (turn && !["queued", "running"].includes(turn.status)) return detail;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("The turn did not finish.");
}
const call = (name: string, args: unknown, id = name): ToolCall => ({
  callId: `call-${id}`,
  name,
  arguments: typeof args === "string" ? args : JSON.stringify(args),
});
const reply = (text: string, calls: ToolCall[] = []) =>
  Promise.resolve({ text, calls });
const toolNames = (request: Request) => request.tools.map((tool) => tool.name);
const lastMessage = (request: Request): StoredMessage => request.messages.at(-1)!;

test("without a model, a follow-up is refused before any turn is created", async () => {
  const founder = await account();
  const chat = await createTask(fixture.db, founder.id, "chat", "Orca");
  const result = await post(offlineUrl, `/${chat.id}/turns`, { message: "Hi" }, founder.token);
  assert.equal(result.status, 503);
  assert.equal((await taskDetail(fixture.db, founder.id, chat.id)).turns.length, 0);
});

test("a chat message runs tools until Orca answers, keeping every step in order", async () => {
  const founder = await account();
  const chat = await createTask(fixture.db, founder.id, "chat", "Orca");
  requests.length = 0;
  script = async (request) => {
    const last = lastMessage(request);
    if (last.kind === "user")
      return {
        text: "Saving that.",
        calls: [
          call("save_memory", {
            path: "founder.md",
            content: "---\ndescription: Founder's post rules\n---\n- No emojis.\n",
          }),
        ],
        replay: [{ type: "reasoning", encrypted_content: "opaque" }],
      };
    return reply("Noted: no emojis.");
  };
  const started = await post(url, `/${chat.id}/turns`, { message: "Never use emojis" }, founder.token);
  assert.equal(started.status, 202);
  assert.equal(started.data.status, "queued");
  const detail = await settled(founder.id, chat.id);
  const turn = detail.turns[0];
  assert.equal(turn.status, "completed");
  assert.deepEqual(
    turn.messages.map((message: StoredMessage) => message.kind),
    ["user", "assistant", "tool_call", "tool_result", "assistant"],
  );
  assert.deepEqual(turn.messages[3].content.result, { path: "founder.md", chars: 55 });
  assert.equal(turn.messages[4].content.text, "Noted: no emojis.");
  // The model sees its own replay, and chat gets the chat tools and instructions.
  assert.equal(requests.length, 2);
  assert.deepEqual(
    requests[1].messages.find((message) => message.kind === "assistant")?.content.replay,
    [{ type: "reasoning", encrypted_content: "opaque" }],
  );
  for (const request of requests) {
    assert.equal(request.cacheKey, chat.id);
    assert.match(request.instructions, /^You are Orca/);
    assert.match(request.instructions, /delegate it with start_task/);
    assert.doesNotMatch(request.instructions, /brand onboarding/);
    assert.ok(toolNames(request).includes("start_task"));
  }
  // The memory index is read once, at the start of the turn.
  assert.match(requests[0].instructions, /Your memory is empty\./);
  assert.match(requests[1].instructions, /Your memory is empty\./);
  await post(url, `/${chat.id}/turns`, { message: "Thanks" }, founder.token);
  await settled(founder.id, chat.id);
  assert.match(requests.at(-1)!.instructions, /- founder\.md: Founder's post rules/);
});

test("tool failures go back to the model as messages it can correct", async () => {
  const founder = await account();
  const { task, turn } = await createWorkTask(fixture.db, founder.id, "Draft", "Draft a post");
  let results: unknown[] = [];
  script = async (request) => {
    const last = lastMessage(request);
    if (last.kind === "user")
      return reply("", [
        call("send_email", {}, "unknown"),
        call("create_artifact", "{not json", "json"),
        call("create_artifact", { kind: "document", title: "" }, "invalid"),
        call("read_artifact", { id: "00000000-0000-4000-8000-000000000001" }, "missing"),
      ]);
    results = request.messages
      .filter((message) => message.kind === "tool_result")
      .map((message) => message.content.result);
    return reply("Done.");
  };
  await new AgentLoop(fixture.db, provider).run(task.id, turn.id, founder.id);
  assert.equal(results.length, 4);
  assert.deepEqual(results[0], { error: "Unknown tool send_email." });
  assert.deepEqual(results[1], { error: "The arguments are not valid JSON." });
  assert.match((results[2] as { error: string }).error, /^Invalid arguments:\n/);
  assert.deepEqual(results[3], { error: "No artifact with that id in this task." });
  assert.equal((await settled(founder.id, task.id)).turns[0].status, "completed");
});

test("onboarding uses its own instructions, and a question ends the turn until the founder answers", async () => {
  const founder = await account();
  const opened = await post(url, "", { kind: "onboarding", title: "Orca" }, founder.token);
  assert.equal(opened.status, 201);
  const onboarding = opened.data.id;
  requests.length = 0;
  script = async () =>
    reply("Saved. Next:", [
      call("update_brand_profile", { company: "Customer feedback tool" }),
      call("request_user_input", {
        questions: [{ question: "Which platforms?", options: ["Instagram", "LinkedIn", "X"], multiple: true }],
      }),
    ]);
  await post(url, `/${onboarding}/turns`, { message: "A customer feedback tool" }, founder.token);
  const detail = await settled(founder.id, onboarding);
  // The fixed opening needed no model call; the answer needed exactly one.
  assert.equal(requests.length, 1);
  assert.match(requests[0].instructions, /Guide the founder through brand onboarding/);
  assert.match(requests[0].instructions, /"onboarding_status":"in_progress"/);
  assert.equal(detail.turns.length, 2);
  assert.equal(detail.turns[1].status, "completed");
  assert.equal(
    detail.turns[1].messages.at(-1).content.result.status,
    "awaiting_user_input",
  );
  const { rows } = await fixture.db.query("SELECT company FROM brand_profiles WHERE user_id=$1", [founder.id]);
  assert.equal(rows[0].company, "Customer feedback tool");
});

test("chat delegates background work that runs with work instructions and no chat-only tools", async () => {
  const founder = await account();
  const chat = await createTask(fixture.db, founder.id, "chat", "Orca");
  requests.length = 0;
  script = async (request) => {
    const last = lastMessage(request);
    if (request.cacheKey === chat.id)
      return last.kind === "user"
        ? reply("", [call("start_task", { title: "Weekly post", instructions: "Draft this week's X post", platform: "X" })])
        : reply("It's running; you'll find it in your Inbox.");
    // The background work task.
    if (last.kind === "user")
      return reply("", [call("create_artifact", { kind: "document", title: "X post", content: "Draft" })]);
    return reply("Drafted one post for review.");
  };
  await post(url, `/${chat.id}/turns`, { message: "Write my weekly X post" }, founder.token);
  const chatDetail = await settled(founder.id, chat.id);
  const started = chatDetail.turns[0].messages.find(
    (message: StoredMessage) => message.kind === "tool_result",
  ).content.result;
  const work = await settled(founder.id, started.task_id);
  assert.equal(work.kind, "work");
  assert.equal(work.platform, "X");
  assert.equal(work.turns[0].status, "completed");
  assert.equal(work.turns[0].artifacts[0].title, "X post");
  const workRequests = requests.filter((request) => request.cacheKey === work.id);
  assert.equal(workRequests.length, 2);
  for (const request of workRequests) {
    assert.match(request.instructions, /This is an Inbox work item for X,/);
    assert.ok(!toolNames(request).includes("start_task"));
    assert.ok(!toolNames(request).includes("request_user_input"));
  }
});

test("the last step offers no tools, so a long turn still ends with an answer", async () => {
  const founder = await account();
  const chat = await createTask(fixture.db, founder.id, "chat", "Orca");
  const turn = await createTurn(fixture.db, founder.id, chat.id, "Research everything");
  requests.length = 0;
  script = async (request) =>
    request.tools.length
      ? reply("Still looking.", [call("search_memory", {}, String(requests.length))])
      : reply("Here is what I found so far; the rest is unfinished.");
  await new AgentLoop(fixture.db, provider).run(chat.id, turn.id, founder.id);
  assert.equal(requests.length, 30);
  assert.match(requests.at(-1)!.instructions, /This is the last step of this turn/);
  assert.doesNotMatch(requests[0].instructions, /last step/);
  const detail = await settled(founder.id, chat.id);
  assert.equal(detail.turns[0].status, "completed");
  assert.match(detail.turns[0].messages.at(-1).content.text, /unfinished/);

  // A model that still answers with calls on that step fails the turn plainly.
  const stubborn = await createTurn(fixture.db, founder.id, chat.id, "Again");
  script = async () => reply("", [call("search_memory", {}, String(requests.length))]);
  await new AgentLoop(fixture.db, provider).run(chat.id, stubborn.id, founder.id);
  const failed = (await settled(founder.id, chat.id)).turns.at(-1);
  assert.equal(failed.status, "failed");
  assert.equal(failed.error, "Orca reached the action limit for this turn.");
});

test("provider failures fail the turn with a short message and keep internals out", async () => {
  const founder = await account();
  const { task, turn } = await createWorkTask(fixture.db, founder.id, "Draft", "Draft");
  script = async () => {
    throw new Error("connect ECONNREFUSED 10.0.0.1:443");
  };
  await new AgentLoop(fixture.db, provider).run(task.id, turn.id, founder.id);
  const failed = (await settled(founder.id, task.id)).turns[0];
  assert.equal(failed.status, "failed");
  assert.equal(failed.error, "Orca could not complete this turn. Please try a follow-up.");
  // A failed turn leaves the task ready for a follow-up.
  await createTurn(fixture.db, founder.id, task.id, "Try again");
});

test("a turn is claimed once, however often it is dispatched", async () => {
  const founder = await account();
  const { task, turn } = await createWorkTask(fixture.db, founder.id, "Draft", "Draft");
  requests.length = 0;
  script = () => reply("Done.");
  const loop = new AgentLoop(fixture.db, provider);
  await Promise.all([1, 2, 3].map(() => loop.run(task.id, turn.id, founder.id)));
  await loop.run(task.id, turn.id, founder.id);
  assert.equal(requests.length, 1);
  assert.equal((await settled(founder.id, task.id)).turns[0].messages.length, 2);
});

test("stopping the server fails running turns with a follow-up message", async () => {
  const founder = await account();
  const { task, turn } = await createWorkTask(fixture.db, founder.id, "Draft", "Draft");
  let started!: () => void;
  const running = new Promise<void>((resolve) => (started = resolve));
  // Like the real SDK, a request rejects when its signal aborts.
  script = ({ signal }) =>
    new Promise((_, reject) => {
      started();
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
  const loop = new AgentLoop(fixture.db, provider);
  const run = loop.run(task.id, turn.id, founder.id);
  await running;
  loop.stop();
  await run;
  const failed = (await settled(founder.id, task.id)).turns[0];
  assert.equal(failed.status, "failed");
  assert.equal(
    failed.error,
    "The server restarted while Orca was working on this turn. Send a follow-up to continue.",
  );
});

test("a context-length error compacts down to the latest step and retries once", async () => {
  const founder = await account();
  const { task, turn: first } = await createWorkTask(fixture.db, founder.id, "Research", "Research competitors");
  for (let step = 0; step < 2; step++)
    await appendMessage(fixture.db, first.id, "assistant", { text: `step ${step}: ${"w".repeat(10_000)}` });
  await completeTurn(fixture.db, first.id);
  const turn = await createTurn(fixture.db, founder.id, task.id, "Continue");
  let compactions = 0;
  let attempts = 0;
  script = async ({ instructions, messages }) => {
    if (instructions.includes("compact the conversation")) {
      compactions++;
      return reply("Earlier research summary");
    }
    attempts++;
    if (attempts === 1) throw new ContextTooLongError();
    assert.match(messages[0].content.text, /Earlier research summary/);
    return reply("Done");
  };
  await new AgentLoop(fixture.db, provider).run(task.id, turn.id, founder.id);
  assert.equal((await settled(founder.id, task.id)).turns.at(-1).status, "completed");
  assert.equal(compactions, 1);
  assert.equal(attempts, 2);

  // Without anything older to compact, the error fails the turn.
  const fresh = await createWorkTask(fixture.db, founder.id, "Short", "Short");
  script = async () => {
    throw new ContextTooLongError();
  };
  await new AgentLoop(fixture.db, provider).run(fresh.task.id, fresh.turn.id, founder.id);
  assert.equal((await settled(founder.id, fresh.task.id)).turns[0].status, "failed");
});

test("with no plugins enabled, routine work can still read core skills", async () => {
  const founder = await account();
  const { task, turn: queued } = await createWorkTask(
    fixture.db,
    founder.id,
    "Find fresh ideas",
    "Read the find-content-ideas skill with read_skill, then follow it.",
  );
  requests.length = 0;
  script = async (request) =>
    lastMessage(request).kind === "user"
      ? { text: "", calls: [call("read_skill", { name: "find-content-ideas" })] }
      : reply("Read it.");
  await fixture.db.query("UPDATE plugins SET enabled=false");
  let turn;
  try {
    agent.dispatch(task.id, queued.id, founder.id);
    turn = (await settled(founder.id, task.id)).turns[0];
  } finally {
    await fixture.db.query("UPDATE plugins SET enabled=true");
  }
  assert.match(turn.messages[3].content.result.content, /^# Find content ideas\n/);
  const tools = toolNames(requests[0]);
  assert.ok(tools.includes("read_skill"));
  assert.ok(!tools.includes("activate_plugin"));
  assert.match(
    requests[0].instructions,
    /\nSkills: when a task names a skill, or its work matches one, read it with read_skill first and follow it\.\n- conversations-to-join: [^\n]+\n- create-content: [^\n]+\n- find-content-ideas: Find up to five content ideas/,
  );
  assert.doesNotMatch(requests[0].instructions, /Plugins:/);
});
