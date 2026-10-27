import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join, dirname, basename, resolve } from "node:path";
import { migrate } from "../src/migrate.js";
import { createUser } from "../src/repositories/users.js";
import {
  appendMessage,
  createTask,
  createTurn,
  taskContext,
  taskHistory,
  saveTaskContext,
  taskDetail,
} from "../src/repositories/tasks.js";
import { completeTurn } from "../src/repositories/turns.js";
import {
  fileRef,
  saveFile,
  loadFile,
  isUserFileKey,
  resolveUserFile,
  filePath,
} from "../src/storage.js";
import {
  loadModelContext,
  modelMessages,
  compactTask,
} from "../src/agent/context.js";
import type { Provider, StoredMessage } from "../src/providers/types.js";
import { OpenAIProvider } from "../src/providers/openai.js";
import { temporaryPostgres } from "./postgres.js";
let fixture: Awaited<ReturnType<typeof temporaryPostgres>>;
let db: Awaited<ReturnType<typeof temporaryPostgres>>["db"];
let folder: string;
const originalStorage = process.env.STORAGE_DIR;
before(async () => {
  fixture = await temporaryPostgres();
  db = fixture.db;
  await migrate(db);
  folder = await mkdtemp(join(tmpdir(), "postorca-context-storage-"));
  process.env.STORAGE_DIR = folder;
});
after(async () => {
  if (originalStorage === undefined) delete process.env.STORAGE_DIR;
  else process.env.STORAGE_DIR = originalStorage;
  await fixture?.close();
  if (folder) {
    assert.equal(dirname(resolve(folder)), resolve(tmpdir()));
    assert.ok(basename(folder).startsWith("postorca-context-storage-"));
    await rm(folder, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  }
});

const message = (
  id: number,
  kind: StoredMessage["kind"],
  content: unknown,
): StoredMessage => ({
  id: String(id),
  turn_id: "turn",
  kind,
  content,
  created_at: "",
});
const page = "x".repeat(30_000);

test("text tool results stay available across steps, including snapshot baselines and changes", () => {
  const messages = [message(1, "user", { text: "check my profile" })];
  for (let step = 0; step < 8; step++)
    messages.push(
      message(messages.length + 1, "assistant", { text: "" }),
      message(messages.length + 2, "tool_result", {
        callId: `c${step}`,
        result:
          step === 0
            ? { observation: "t1:1", snapshot: page }
            : {
                observation: `t1:${step + 1}`,
                baseline: "t1:1",
                changes: `Added post ${step}: ${page}`,
              },
      }),
      message(messages.length + 3, "tool_result", {
        callId: `s${step}`,
        result: { ok: true },
      }),
    );
  const shaped = modelMessages(messages, "Founder wants a profile check.");
  assert.match(shaped[0].content.text, /Founder wants a profile check\./);
  const results = shaped.filter((item) => item.kind === "tool_result");
  // Old full observations and later diffs remain usable together, without mutating history.
  assert.equal(results[0].content.result.snapshot, page);
  for (let step = 0; step < 8; step++) {
    assert.deepEqual(results[step * 2].content, messages[step * 3 + 2].content);
    assert.deepEqual(results[step * 2 + 1].content.result, { ok: true });
  }
  assert.equal(results[0].content.callId, "c0");
  // Stored messages are not modified.
  assert.equal(messages[2].content.result.snapshot, page);
});

test("a single oversized result is cut even in the current step", () => {
  const [, result] = modelMessages([
    message(1, "assistant", { text: "" }),
    message(2, "tool_result", { callId: "c", result: "y".repeat(200_000) }),
  ]);
  assert.ok(result.content.result.length < 90_000);
  assert.match(result.content.result, /truncated/);
});

/** A completed earlier turn with `steps` long assistant steps and snapshots. */
async function longHistory(steps: number) {
  const user = await createUser(
    db,
    "Founder",
    `founder-${Math.random()}@example.com`,
    "password-123",
  );
  const task = await createTask(db, user.id, "work", "Research");
  const turn = await createTurn(db, user.id, task.id, "Research competitors");
  for (let step = 0; step < steps; step++) {
    // Assistant text is never trimmed, so many long steps pass the window.
    await appendMessage(db, turn.id, "assistant", {
      text: `step ${step}: ${"w".repeat(10_000)}`,
    });
    await appendMessage(db, turn.id, "tool_call", {
      callId: `c${step}`,
      name: "browser_snapshot",
      arguments: "{}",
    });
    await appendMessage(db, turn.id, "tool_result", {
      callId: `c${step}`,
      result: { snapshot: "z".repeat(20_000) },
    });
  }
  await completeTurn(db, turn.id);
  return { user, task };
}

test("a request over the window compacts older messages into a saved checkpoint", async () => {
  const { user, task } = await longHistory(60);
  const compactions: string[] = [];
  const provider: Provider = {
    async respond({ instructions, messages, tools }) {
      assert.match(instructions, /compact the conversation/);
      assert.equal(tools.length, 0);
      compactions.push(messages[0].content.text);
      return { text: `Summary ${compactions.length}`, calls: [] };
    },
  };
  const signal = new AbortController().signal;
  const context = await loadModelContext(
    db,
    provider,
    { taskId: task.id, userId: user.id },
    {
      instructions: "system",
      signal,
    },
  );
  assert.equal(compactions.length, 1);
  assert.match(compactions[0], /Founder: Research competitors/);
  assert.match(compactions[0], /Orca called browser_snapshot/);
  // The summary comes first, followed by the last four steps verbatim.
  assert.match(context[0].content.text, /Summary 1/);
  assert.equal(context[1].kind, "assistant");
  assert.match(context[1].content.text, /^step 56:/);
  assert.equal(context.filter((item) => item.kind === "assistant").length, 4);
  const saved = await taskContext(db, task.id);
  assert.equal(saved?.summary, "Summary 1");
  assert.ok(Number(saved?.through_message_id) < Number(context[1].id));
  // Under the window, nothing is compacted again.
  const again = await loadModelContext(
    db,
    provider,
    { taskId: task.id, userId: user.id },
    {
      instructions: "system",
      signal,
    },
  );
  assert.equal(compactions.length, 1);
  assert.equal(again.length, context.length);
});

test("a tool's image is shown in the next model response only, then only its reference", async () => {
  const { user, task } = await longHistory(1);
  const other = await createUser(
    db,
    "Other",
    "other-shot@example.com",
    "pw-12345678",
  );
  const turn = await createTurn(db, user.id, task.id, "Look at the page");
  const image = Buffer.from("jpeg bytes");
  const file = await saveFile(user.id, "screenshots", image, "image/jpeg");
  const foreign = await saveFile(other.id, "screenshots", image, "image/jpeg");
  await appendMessage(db, turn.id, "assistant", { text: "" });
  await appendMessage(db, turn.id, "tool_result", {
    callId: "shot",
    result: {
      description: page,
      attachments: [
        { kind: "screenshot", file, mime_type: "image/jpeg" },
        // Another user's file is never loaded, whatever the result claims.
        { kind: "screenshot", file: foreign, mime_type: "image/jpeg" },
      ],
    },
  });
  const provider: Provider = {
    respond: async () => assert.fail("no compaction expected"),
  };
  const shown = async () =>
    (
      await loadModelContext(
        db,
        provider,
        { taskId: task.id, userId: user.id },
        { instructions: "system", signal: new AbortController().signal },
      )
    ).find((m) => m.content.callId === "shot")!;
  const first = await shown();
  assert.deepEqual(first.content.images, [
    { mime_type: "image/jpeg", base64: image.toString("base64") },
  ]);
  // The response that saw it notes what matters; after that only the reference stays,
  // so hiding it changes only the end of the history and the cached prompt is kept.
  await appendMessage(db, turn.id, "assistant", { text: "I see the page." });
  const later = await shown();
  assert.equal(later.content.images, undefined);
  // The result's text is the same shown or hidden, so hiding keeps the cached prompt.
  assert.match(later.content.result.images, /Shown to you once/);
  assert.deepEqual(later.content.result, first.content.result);
  // The model sees the file's ref, which the tools accept, not its storage key.
  assert.deepEqual(later.content.result.attachments[0], {
    ref: fileRef(file),
    kind: "screenshot",
    mime_type: "image/jpeg",
  });
  assert.equal(
    later.content.result.description,
    page,
    "text accompanying an expired image is retained",
  );
});

test("explicit one-step compaction keeps paired recent messages and leaves founder history intact", async () => {
  const { user, task } = await longHistory(2);
  const before = await taskHistory(db, task.id);
  const controller = new AbortController();
  let calls = 0;
  const trace = {
    taskId: task.id,
    turnId: before[0].turn_id,
    step: "retry-compaction",
  };
  const provider: Provider = {
    async respond(input) {
      calls++;
      assert.equal(input.signal, controller.signal);
      assert.deepEqual(input.trace, trace);
      assert.deepEqual(input.tools, []);
      assert.match(
        input.messages[0].content.text,
        /Founder: Research competitors/,
      );
      assert.match(input.messages[0].content.text, /Orca: step 0/);
      return { text: "Earlier research summary", calls: [] };
    },
  };
  assert.equal(
    await compactTask(db, provider, task.id, {
      keepSteps: 1,
      signal: controller.signal,
      trace,
    }),
    true,
  );
  assert.equal(calls, 1);
  const shaped = await loadModelContext(
    db,
    provider,
    { taskId: task.id, userId: user.id },
    { instructions: "system", signal: controller.signal },
  );
  assert.match(shaped[0].content.text, /Earlier research summary/);
  assert.match(shaped[1].content.text, /^step 1:/);
  assert.deepEqual(
    shaped.slice(1).map((item) => item.kind),
    ["assistant", "tool_call", "tool_result"],
  );
  assert.equal(shaped[2].content.callId, shaped[3].content.callId);
  assert.deepEqual(await taskHistory(db, task.id), before);
  const detail = await taskDetail(db, user.id, task.id);
  assert.equal(detail.turns[0].messages.length, before.length);
  assert.ok(
    detail.turns[0].messages.every(
      (item: any) => !item.content.text?.startsWith("[Summary of the earlier"),
    ),
  );
});

test("later compaction replaces its checkpoint using the earlier summary and newer founder instructions", async () => {
  const { user, task } = await longHistory(6);
  const transcripts: string[] = [];
  const provider: Provider = {
    async respond({ messages }) {
      transcripts.push(messages[0].content.text);
      return {
        text: `Founder research summary ${transcripts.length}`,
        calls: [],
      };
    },
  };
  const signal = new AbortController().signal;
  await compactTask(db, provider, task.id, { keepSteps: 2, signal });
  const first = await taskContext(db, task.id);
  const next = await createTurn(
    db,
    user.id,
    task.id,
    "Focus on independent builders now.",
  );
  for (let step = 0; step < 2; step++) {
    await appendMessage(db, next.id, "assistant", { text: `New step ${step}` });
    await appendMessage(db, next.id, "tool_call", {
      callId: `next-${step}`,
      name: "read_brand_profile",
      arguments: "{}",
    });
    await appendMessage(db, next.id, "tool_result", {
      callId: `next-${step}`,
      result: { company: "A product" },
    });
  }
  await compactTask(db, provider, task.id, { keepSteps: 1, signal });
  assert.match(transcripts[1], /Earlier summary:\nFounder research summary 1/);
  assert.match(transcripts[1], /Founder: Focus on independent builders now\./);
  const second = await taskContext(db, task.id);
  assert.equal(second?.summary, "Founder research summary 2");
  assert.ok(
    BigInt(second!.through_message_id) > BigInt(first!.through_message_id),
  );
  assert.equal(
    (await db.query("SELECT 1 FROM task_context WHERE task_id=$1", [task.id]))
      .rowCount,
    1,
  );
});

test("too little history or an empty summary never advances a checkpoint", async () => {
  const { task } = await longHistory(1);
  const signal = new AbortController().signal;
  const untouched: Provider = {
    respond: async () => assert.fail("Not enough history to compact"),
  };
  assert.equal(
    await compactTask(db, untouched, task.id, { keepSteps: 4, signal }),
    false,
  );
  assert.equal(await taskContext(db, task.id), undefined);
  const more = await longHistory(2);
  const blank: Provider = { respond: async () => ({ text: "  ", calls: [] }) };
  assert.equal(
    await compactTask(db, blank, more.task.id, { keepSteps: 1, signal }),
    false,
  );
  assert.equal(await taskContext(db, more.task.id), undefined);
});

test("compaction failure falls back to history while cancellation still propagates", async (context) => {
  const { user, task } = await longHistory(60);
  const warnings: unknown[] = [];
  context.mock.method(console, "warn", (...items: unknown[]) =>
    warnings.push(items),
  );
  const failing: Provider = {
    respond: async () => {
      throw new Error("Test provider failure");
    },
  };
  const history = await taskHistory(db, task.id);
  const loaded = await loadModelContext(
    db,
    failing,
    { taskId: task.id, userId: user.id },
    { instructions: "system", signal: new AbortController().signal },
  );
  assert.equal(warnings.length, 1);
  assert.deepEqual(loaded, modelMessages(history));
  assert.equal(await taskContext(db, task.id), undefined);
  const controller = new AbortController();
  const aborting: Provider = {
    respond: async () => {
      controller.abort(new Error("Test cancellation"));
      throw controller.signal.reason;
    },
  };
  await assert.rejects(
    loadModelContext(
      db,
      aborting,
      { taskId: task.id, userId: user.id },
      { instructions: "system", signal: controller.signal },
    ),
    /Test cancellation/,
  );
  assert.equal(await taskContext(db, task.id), undefined);
});

test("missing and downloaded images are skipped and file references stay scoped to their owner", async () => {
  const { user, task } = await longHistory(1);
  const own = await saveFile(
    user.id,
    "media",
    Buffer.from("owned image"),
    "image/png",
  );
  const downloaded = await saveFile(
    user.id,
    "media",
    Buffer.from("download image"),
    "image/png",
  );
  const missing = `users/${user.id}/media/${randomUUID()}.png`;
  const turn = await createTurn(db, user.id, task.id, "Inspect the image");
  await appendMessage(db, turn.id, "assistant", { text: "" });
  await appendMessage(db, turn.id, "tool_result", {
    callId: "images",
    result: {
      attachments: [
        { kind: "image", file: own, mime_type: "image/png" },
        { kind: "download", file: downloaded, mime_type: "image/png" },
        { kind: "image", file: missing, mime_type: "image/png" },
      ],
    },
  });
  const before = await taskHistory(db, task.id);
  const provider: Provider = {
    respond: async () => assert.fail("No compaction expected"),
  };
  const loaded = await loadModelContext(
    db,
    provider,
    { taskId: task.id, userId: user.id },
    { instructions: "system", signal: new AbortController().signal },
  );
  const result = loaded.find((item) => item.content.callId === "images")!;
  assert.deepEqual(result.content.images, [
    {
      mime_type: "image/png",
      base64: Buffer.from("owned image").toString("base64"),
    },
  ]);
  assert.equal(result.content.hadImages, true);
  assert.equal(result.content.result.attachments[0].ref, fileRef(own));
  assert.equal(result.content.result.attachments[0].file, undefined);
  assert.deepEqual(await taskHistory(db, task.id), before);
  assert.equal(await resolveUserFile(user.id, fileRef(own)), own);
  assert.equal(await resolveUserFile(randomUUID(), own), null);
  assert.equal(isUserFileKey(user.id, own), true);
  assert.equal(isUserFileKey(randomUUID(), own), false);
  await assert.rejects(loadFile("../../outside.png"), /Invalid file key/);
  const prefix = randomUUID().slice(0, 8);
  for (const directory of ["media", "screenshots"]) {
    const key = `users/${user.id}/${directory}/${prefix}-0000-4000-8000-000000000001.png`;
    await mkdir(dirname(filePath(key)), { recursive: true });
    await writeFile(filePath(key), "fixture");
  }
  assert.equal(await resolveUserFile(user.id, prefix), null);
});

test("checkpoint replacement persists and deleting its task cascades the saved summary", async () => {
  const { task } = await longHistory(1);
  await saveTaskContext(db, task.id, "First summary", "1");
  await saveTaskContext(db, task.id, "Replacement summary", "2");
  assert.deepEqual(await taskContext(db, task.id), {
    summary: "Replacement summary",
    through_message_id: "2",
  });
  await db.query("DELETE FROM tasks WHERE id=$1", [task.id]);
  assert.equal(await taskContext(db, task.id), undefined);
});

test("saved context summaries can be sent through the real Responses adapter", async (context) => {
  const user = await createUser(
    db,
    "Founder",
    `summary-${randomUUID()}@example.com`,
    "test-password",
  );
  const task = await createTask(db, user.id, "work", "Research");
  const turn = await createTurn(db, user.id, task.id, "Research competitors");
  await appendMessage(db, turn.id, "assistant", { text: "Earlier findings" });
  await appendMessage(db, turn.id, "assistant", { text: "Latest findings" });
  const signal = new AbortController().signal;
  await compactTask(
    db,
    {
      respond: async () => ({
        text: "Keep the founder's research preferences.",
        calls: [],
      }),
    },
    task.id,
    { keepSteps: 1, signal },
  );
  let request: any;
  context.mock.method(
    globalThis,
    "fetch",
    async (_url: unknown, init: RequestInit) => {
      request = JSON.parse(String(init.body));
      return new Response(
        JSON.stringify({
          id: "r",
          object: "response",
          status: "completed",
          output: [],
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    },
  );
  const provider = new OpenAIProvider("test-only-key", "test-model");
  const messages = await loadModelContext(
    db,
    provider,
    { taskId: task.id, userId: user.id },
    { instructions: "System", signal },
  );
  await provider.respond({
    instructions: "System",
    messages,
    tools: [],
    signal,
  });
  assert.match(
    request.input[0].content,
    /Keep the founder's research preferences/,
  );
  assert.ok(!request.input[0].content.startsWith("[Sent"));
  assert.deepEqual(request.input[1], {
    role: "assistant",
    content: "Latest findings",
  });
});
