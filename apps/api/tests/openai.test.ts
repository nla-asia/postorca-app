import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { OpenAIProvider } from "../src/providers/openai.js";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, dirname, basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { turnTraceDirectory } from "../src/agent/trace.js";
import {
  ContextTooLongError,
  type StoredMessage,
} from "../src/providers/types.js";
import { contextWindowStats, estimateTokens } from "../src/agent/tokens.js";

function cleanTrace(
  context: TestContext,
  trace: { taskId: string; turnId: string; step: number },
) {
  const directory = turnTraceDirectory(trace);
  context.after(async () => {
    const taskDirectory = dirname(directory);
    const root = resolve(
      fileURLToPath(new URL("../.data/agent-traces/", import.meta.url)),
    );
    assert.equal(dirname(taskDirectory), root);
    assert.equal(basename(taskDirectory), trace.taskId);
    assert.equal(basename(directory), trace.turnId);
    assert.match(trace.taskId, /^[0-9a-f-]{36}$/);
    await rm(taskDirectory, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  });
  return directory;
}

test("agent-initiated Responses requests have developer input without inventing a user message", async (context) => {
  const requests: any[] = [];
  context.mock.method(
    globalThis,
    "fetch",
    async (_url: unknown, init: RequestInit) => {
      requests.push(JSON.parse(String(init.body)));
      return new Response(
        JSON.stringify({
          id: "resp_test",
          object: "response",
          status: "completed",
          output: [
            {
              id: "msg_test",
              type: "message",
              role: "assistant",
              status: "completed",
              content: [
                {
                  type: "output_text",
                  text: "Which platforms?",
                  annotations: [],
                },
              ],
            },
          ],
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    },
  );
  const provider = new OpenAIProvider("test-only-key", "test-model");
  const input = {
    instructions: "Start onboarding.",
    messages: [],
    tools: [],
    signal: new AbortController().signal,
  };
  const response = await provider.respond(input);
  assert.equal(response.text, "Which platforms?");
  assert.equal(requests[0].input.length, 1);
  assert.equal(requests[0].input[0].role, "developer");
  assert.equal(input.messages.length, 0);
  await provider.respond({
    ...input,
    messages: [
      {
        id: "1",
        turn_id: "turn_test",
        created_at: "2026-10-21T00:00:00Z",
        kind: "user",
        content: { text: "Threads" },
      },
    ],
  });
  // Each founder message carries its send time, so the instructions never change.
  assert.deepEqual(requests[1].input, [
    { role: "user", content: "[Sent 2026-10-21 00:00 UTC]\nThreads" },
  ]);
  assert.equal(requests[1].prompt_cache_key, undefined);
  // A task's requests share a cache key so its growing prompt is reused step to step.
  await provider.respond({ ...input, cacheKey: "task-1" });
  assert.equal(requests[2].prompt_cache_key, "task-1");
});

test("turn traces retain the exact context and changing tools for every model call, including failures", async (context) => {
  const trace = { taskId: randomUUID(), turnId: randomUUID(), step: 1 };
  const directory = cleanTrace(context, trace);
  const requests: any[] = [];
  context.mock.method(
    globalThis,
    "fetch",
    async (_url: unknown, init: RequestInit) => {
      requests.push(JSON.parse(String(init.body)));
      if (requests.length === 3)
        return new Response(
          JSON.stringify({
            error: {
              message: "Invalid request",
              type: "invalid_request_error",
            },
          }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          },
        );
      return new Response(
        JSON.stringify({
          id: `resp_${requests.length}`,
          object: "response",
          status: "completed",
          model: "test-model",
          output: [],
          usage: { input_tokens: 125, output_tokens: 10, total_tokens: 135 },
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    },
  );
  const provider = new OpenAIProvider("test-secret-not-for-logs", "test-model");
  const input = {
    instructions: "System instructions and brand context.",
    messages: [
      {
        id: "1",
        turn_id: trace.turnId,
        kind: "user" as const,
        content: { text: "Read a page" },
        created_at: "2026-10-21T00:00:00Z",
      },
    ],
    tools: [
      {
        name: "activate_plugin",
        description: "Activate a plugin",
        parameters: { type: "object" },
      },
    ],
    signal: new AbortController().signal,
    trace,
  };
  await provider.respond(input);
  await provider.respond({
    ...input,
    trace: { ...trace, step: 2 },
    tools: [],
    messages: [
      ...input.messages,
      {
        id: "2",
        turn_id: trace.turnId,
        kind: "assistant",
        content: {
          replay: [
            {
              type: "function_call",
              call_id: "call_1",
              name: "activate_plugin",
              arguments: "{}",
            },
          ],
        },
        created_at: "2026-10-21T00:00:01Z",
      },
      {
        id: "3",
        turn_id: trace.turnId,
        kind: "tool_result",
        content: {
          callId: "call_1",
          result: { active_plugin: "browser" },
        },
        created_at: "2026-10-21T00:00:02Z",
      },
    ],
  });
  await assert.rejects(
    provider.respond({ ...input, trace: { ...trace, step: 3 } }),
  );
  for (const step of [1, 2, 3]) {
    const raw = await readFile(
      join(directory, `0${step}.request.json`),
      "utf8",
    );
    assert.deepEqual(JSON.parse(raw), requests[step - 1]);
    assert.ok(!raw.includes("test-secret-not-for-logs"));
  }
  const first = JSON.parse(
    await readFile(join(directory, "01.result.json"), "utf8"),
  );
  assert.deepEqual(first.usage, {
    input_tokens: 125,
    output_tokens: 10,
    total_tokens: 135,
  });
  // Context window size: provider count against the window, plus our estimate.
  assert.equal(first.context.input_tokens, 125);
  assert.equal(first.context.window_tokens, 100_000);
  assert.equal(first.context.used_percent, 0.1);
  assert.equal(
    first.context.estimated_tokens,
    first.context.estimated_breakdown.instructions +
      first.context.estimated_breakdown.messages +
      first.context.estimated_breakdown.tools,
  );
  const failed = JSON.parse(
    await readFile(join(directory, "03.result.json"), "utf8"),
  );
  assert.deepEqual(
    {
      status: failed.status,
      error: failed.error,
      http_status: failed.http_status,
    },
    { status: "failed", error: "Error", http_status: 400 },
  );
  // A failed request still records its estimated size, without a provider count.
  assert.equal(failed.context.input_tokens, null);
  assert.ok(failed.context.estimated_tokens > 0);
  const requestFile = await stat(join(directory, "01.request.json"));
  assert.ok(requestFile.isFile());
  // Windows uses ACLs and does not expose POSIX mode bits faithfully.
  if (process.platform !== "win32")
    assert.equal(requestFile.mode & 0o777, 0o600);
});

test("tool images follow the step's function outputs as one user message", async (context) => {
  const requests: any[] = [];
  context.mock.method(
    globalThis,
    "fetch",
    async (_url: unknown, init: RequestInit) => {
      requests.push(JSON.parse(String(init.body)));
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
  const message = (id: string, kind: any, content: unknown) => ({
    id,
    turn_id: "t",
    created_at: "",
    kind,
    content,
  });
  await new OpenAIProvider("test-only-key", "test-model").respond({
    instructions: "",
    tools: [],
    signal: new AbortController().signal,
    messages: [
      message("1", "assistant", {
        text: "",
        replay: [
          {
            type: "function_call",
            call_id: "a",
            name: "browser_screenshot",
            arguments: "{}",
          },
          {
            type: "function_call",
            call_id: "b",
            name: "browser_snapshot",
            arguments: "{}",
          },
        ],
      }),
      // Stored tool calls sit between the results; they must not split the step.
      message("2", "tool_call", { callId: "a", name: "browser_screenshot" }),
      message("3", "tool_result", {
        callId: "a",
        result: { attachments: [{ file: "k" }] },
        images: [{ mime_type: "image/jpeg", base64: "QUJD" }],
        hadImages: true,
      }),
      message("4", "tool_call", { callId: "b", name: "browser_snapshot" }),
      message("5", "tool_result", { callId: "b", result: { ok: true } }),
    ],
  });
  const input = requests[0].input;
  assert.deepEqual(
    input.map((item: any) => item.type ?? item.role),
    [
      "function_call",
      "function_call",
      "function_call_output",
      "function_call_output",
      "user",
    ],
  );
  assert.deepEqual(input[2].output, [
    {
      type: "input_text",
      text: JSON.stringify({ attachments: [{ file: "k" }] }),
    },
  ]);
  // The step's last output marks a cache breakpoint before the images, which later
  // requests drop.
  assert.deepEqual(input[3].output, [
    {
      type: "input_text",
      text: JSON.stringify({ ok: true }),
      prompt_cache_breakpoint: { mode: "explicit" },
    },
  ]);
  assert.deepEqual(input[4].content[1], {
    type: "input_image",
    detail: "auto",
    image_url: "data:image/jpeg;base64,QUJD",
  });
  // Once the image is hidden, the outputs and their breakpoint stay exactly as they
  // were, so the next request reuses the cached prompt up to there.
  await new OpenAIProvider("test-only-key", "test-model").respond({
    instructions: "",
    tools: [],
    signal: new AbortController().signal,
    messages: [
      message("1", "assistant", {
        text: "",
        replay: requests[0].input.slice(0, 2),
      }),
      message("3", "tool_result", {
        callId: "a",
        result: { attachments: [{ file: "k" }] },
        hadImages: true,
      }),
      message("5", "tool_result", { callId: "b", result: { ok: true } }),
      message("6", "assistant", { text: "I see the page." }),
    ],
  });
  assert.deepEqual(requests[1].input.slice(0, 4), input.slice(0, 4));
  assert.equal(requests[1].input[4].role, "assistant");
});

const input = () => ({
  instructions: "Follow the saved instructions.",
  messages: [],
  tools: [],
  signal: new AbortController().signal,
});
const jsonResponse = (
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });

test("responses preserve encrypted replay and tool calls without mutating stored history", async (context) => {
  const requests: any[] = [];
  context.mock.method(
    globalThis,
    "fetch",
    async (_url: unknown, init: RequestInit) => {
      requests.push(JSON.parse(String(init.body)));
      return jsonResponse({
        id: "r",
        object: "response",
        status: "completed",
        output: [
          {
            type: "reasoning",
            id: "reasoning_1",
            summary: [],
            encrypted_content: "opaque-reasoning",
          },
          {
            type: "function_call",
            id: "fc_1",
            call_id: "call_1",
            name: "read_brand_profile",
            arguments: "{}",
            status: "completed",
            parsed_arguments: { sdkOnly: true },
          },
          {
            type: "message",
            id: "msg_1",
            role: "assistant",
            status: "completed",
            content: [
              {
                type: "output_text",
                text: "Saved answer",
                annotations: [],
                parsed: { sdkOnly: true },
              },
            ],
          },
        ],
      });
    },
  );
  const messages: StoredMessage[] = [
    {
      id: "1",
      turn_id: "t",
      created_at: "2026-10-27T00:00:00Z",
      kind: "user",
      content: { text: "Read my profile" },
    },
  ];
  const before = structuredClone(messages);
  const provider = new OpenAIProvider("test-only-key", "test-model");
  const result = await provider.respond({
    ...input(),
    messages,
    cacheKey: "task-1",
    tools: [
      {
        name: "read_brand_profile",
        description: "Read the profile",
        parameters: { type: "object", properties: {} },
      },
    ],
  });
  assert.equal(result.text, "Saved answer");
  assert.deepEqual(result.calls, [
    { callId: "call_1", name: "read_brand_profile", arguments: "{}" },
  ]);
  assert.deepEqual(messages, before);
  assert.equal(requests[0].model, "test-model");
  assert.equal(requests[0].store, false);
  assert.deepEqual(requests[0].include, ["reasoning.encrypted_content"]);
  assert.equal(requests[0].tools[0].type, "function");
  assert.equal(requests[0].tools[0].strict, false);
  assert.deepEqual(requests[0].tools[0].parameters, {
    type: "object",
    properties: {},
  });
  const replay = result.replay as any[];
  assert.equal(replay[0].encrypted_content, "opaque-reasoning");
  assert.equal(replay[1].parsed_arguments, undefined);
  assert.equal(replay[2].content[0].parsed, undefined);
  await provider.respond({
    ...input(),
    messages: [
      ...messages,
      {
        id: "2",
        turn_id: "t",
        created_at: "",
        kind: "assistant",
        content: { text: result.text, replay },
      },
      {
        id: "3",
        turn_id: "t",
        created_at: "",
        kind: "tool_call",
        content: result.calls[0],
      },
      {
        id: "4",
        turn_id: "t",
        created_at: "",
        kind: "tool_result",
        content: { callId: "call_1", result: { company: "A product" } },
      },
    ],
  });
  assert.deepEqual(requests[1].input.slice(1, 4), replay);
  assert.equal(
    requests[1].input.filter((item: any) => item.type === "function_call")
      .length,
    1,
  );
  assert.equal(requests[1].input.at(-1).call_id, "call_1");
});

test("context-length failures remain distinguishable from ordinary API failures", async (context) => {
  let calls = 0;
  context.mock.method(globalThis, "fetch", async () => {
    calls++;
    return jsonResponse(
      {
        error: {
          message: "Too much context",
          type: "invalid_request_error",
          code: "context_length_exceeded",
        },
      },
      400,
    );
  });
  await assert.rejects(
    new OpenAIProvider("test-only-key", "test-model").respond(input()),
    ContextTooLongError,
  );
  assert.equal(calls, 1);
  context.mock.method(globalThis, "fetch", async () =>
    jsonResponse(
      {
        error: {
          message: "Invalid key",
          type: "invalid_request_error",
          code: "invalid_api_key",
        },
      },
      401,
    ),
  );
  await assert.rejects(
    new OpenAIProvider("test-only-key", "test-model").respond(input()),
    (error) => {
      assert.ok(!(error instanceof ContextTooLongError));
      assert.equal((error as { status: number }).status, 401);
      return true;
    },
  );
});

test("incomplete model output is not accepted as a finished response", async (context) => {
  context.mock.method(globalThis, "fetch", async () =>
    jsonResponse({
      id: "r",
      object: "response",
      status: "incomplete",
      output: [],
    }),
  );
  await assert.rejects(
    new OpenAIProvider("test-only-key", "test-model").respond(input()),
    /model did not complete/,
  );
});

test("an already-aborted request never reaches the model transport", async (context) => {
  let calls = 0;
  context.mock.method(globalThis, "fetch", async () => {
    calls++;
    throw new Error("Transport must not run");
  });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    new OpenAIProvider("test-only-key", "test-model").respond({
      ...input(),
      signal: controller.signal,
    }),
  );
  assert.equal(calls, 0);
});

test("the SDK retries transient failures while retaining the original request", async (context) => {
  const requests: unknown[] = [];
  context.mock.method(
    globalThis,
    "fetch",
    async (_url: unknown, init: RequestInit) => {
      requests.push(JSON.parse(String(init.body)));
      if (requests.length < 4)
        return jsonResponse(
          { error: { message: "Try again", type: "rate_limit_error" } },
          429,
          { "retry-after-ms": "1" },
        );
      return jsonResponse({
        id: "r",
        object: "response",
        status: "completed",
        output: [],
      });
    },
  );
  await new OpenAIProvider("test-only-key", "test-model").respond(input());
  assert.equal(requests.length, 4);
  assert.ok(
    requests.every(
      (request) => JSON.stringify(request) === JSON.stringify(requests[0]),
    ),
  );
});

test("failed diagnostic writes never prevent a completed model response", async (context) => {
  const trace = { taskId: randomUUID(), turnId: randomUUID(), step: 1 };
  const directory = cleanTrace(context, trace);
  await mkdir(dirname(directory), { recursive: true });
  await writeFile(directory, "This path is deliberately not a directory.");
  const warnings: string[] = [];
  context.mock.method(console, "warn", (message: string) =>
    warnings.push(message),
  );
  context.mock.method(console, "info", () => {});
  context.mock.method(globalThis, "fetch", async () =>
    jsonResponse({
      id: "r",
      object: "response",
      status: "completed",
      output: [],
    }),
  );
  const response = await new OpenAIProvider(
    "test-only-key",
    "test-model",
  ).respond({ ...input(), trace });
  assert.equal(response.text, "");
  assert.ok(warnings.length >= 2);
});

test("token estimates omit opaque data and usage reports prefer the provider count", () => {
  assert.equal(
    estimateTokens({
      text: "hello",
      encrypted_content: "x",
      image_url: "data:x",
    }),
    estimateTokens({
      text: "hello",
      encrypted_content: "x".repeat(10000),
      image_url: "data:y".repeat(10000),
    }),
  );
  const request = {
    instructions: "Instructions",
    input: [
      {
        role: "user",
        content: [
          { type: "input_image", image_url: "data:image/png;base64,ABC" },
          { type: "input_text", text: "Describe this" },
        ],
      },
    ],
    tools: [],
  };
  const estimated = contextWindowStats(request);
  assert.equal(estimated.images, 1);
  assert.equal(estimated.window_tokens, 100000);
  assert.equal(estimated.input_tokens, null);
  assert.equal(
    estimated.estimated_tokens,
    Object.values(estimated.estimated_breakdown).reduce(
      (sum, value) => sum + value,
      0,
    ),
  );
  const counted = contextWindowStats(request, 25000);
  assert.equal(counted.used_percent, 25);
  assert.equal(counted.input_tokens, 25000);
  assert.equal(contextWindowStats(request, 0).used_percent, 0);
});
