import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { temporaryPostgres } from "./postgres.js";
import { migrate } from "../src/migrate.js";
import {
  usageFetch,
  withApiUsage,
  recoverApiUsage,
} from "../src/api-usage/ledger.js";
import { apiUsageReport } from "../src/api-usage/report.js";
import {
  estimateCost,
  matchRate,
  loadRates,
} from "../src/api-usage/pricing.js";
import { openAIUsage } from "../src/api-usage/openai.js";
import { MetaProvider } from "../src/providers/meta.js";
import { OpenAIProvider } from "../src/providers/openai.js";
import { OpenAIImageProvider } from "../src/providers/openai-image.js";
import { ElevenLabsProvider } from "../src/providers/elevenlabs.js";
import type { Database } from "../src/db.js";

let recoveryDirectory: string;
let fixture: Awaited<ReturnType<typeof temporaryPostgres>>;
before(async () => {
  recoveryDirectory = await mkdtemp(join(tmpdir(), "postorca-usage-recovery-"));
  fixture = await temporaryPostgres();
  await migrate(fixture.db);
});
after(async () => {
  await fixture?.close();
  if (recoveryDirectory)
    await rm(recoveryDirectory, { recursive: true, force: true });
});
async function scope() {
  const db = fixture.db;
  const {
    rows: [u],
  } = await db.query(
    "INSERT INTO users(name,email,password_hash) VALUES ('Founder',gen_random_uuid()::text,'hash') RETURNING id",
  );
  const {
    rows: [task],
  } = await db.query(
    "INSERT INTO tasks(user_id,kind,title) VALUES ($1,'work','Accounting test') RETURNING id",
    [u.id],
  );
  const {
    rows: [turn],
  } = await db.query("INSERT INTO turns(task_id) VALUES ($1) RETURNING id", [
    task.id,
  ]);
  return {
    db,
    recoveryDirectory,
    userId: u.id as string,
    taskId: task.id as string,
    turnId: turn.id as string,
  };
}
const usage = {
  input_tokens: 1000,
  input_tokens_details: { cached_tokens: 400, cache_write_tokens: 100 },
  output_tokens: 200,
  output_tokens_details: { reasoning_tokens: 50 },
};
const result = () => ({
  id: "resp_usage",
  model: "gpt-6-luna",
  status: "completed",
  service_tier: "default",
  usage,
  output: [],
});
const post = (model = "gpt-6-luna") => ({
  method: "POST",
  body: JSON.stringify({
    model,
    instructions: "PRIVATE PROMPT",
    input: "PRIVATE INPUT",
  }),
  headers: { authorization: "Bearer PRIVATE_KEY" },
});

test("records usage without sensitive payloads, keeps response readable, and reports exact saved cost", async (t) => {
  const s = await scope();
  t.mock.method(globalThis, "fetch", async () =>
    Response.json(result(), { headers: { "x-request-id": "req_usage" } }),
  );
  const response = await withApiUsage(s, () =>
    usageFetch("https://api.openai.com/v1/responses", post()),
  );
  assert.deepEqual(await response.json(), result());
  const {
    rows: [row],
  } = await s.db.query("SELECT * FROM api_requests WHERE turn_id=$1", [
    s.turnId,
  ]);
  assert.equal(row.status, "succeeded");
  assert.equal(row.credit_state, "settled");
  assert.equal(row.credit_charged, "0.005550000");
  assert.equal(row.user_id, s.userId);
  assert.equal(row.task_id, s.taskId);
  assert.equal(row.provider_request_id, "req_usage");
  assert.equal(row.provider_response_id, "resp_usage");
  assert.equal(row.estimated_cost, "0.000166500000");
  assert.equal(row.usage_data.meters.ordinary_input_tokens, 500);
  assert.equal(row.usage_data.meters.reasoning_tokens, 50);
  assert.equal(row.pricing_snapshot.prices[0].amount, "0.10");
  assert.ok(!JSON.stringify(row).includes("PRIVATE"));
  const [report] = await apiUsageReport(s.db, { task: s.taskId });
  assert.equal(report.attempts, 1);
  assert.equal(report.estimated_cost, row.estimated_cost);
  assert.equal(report.unknown_cost, 0);
  assert.equal(report.output_tokens, "200");
  await assert.rejects(
    apiUsageReport(s.db, {
      from: "2026-10-28T00:00:00Z",
      to: "2026-10-27T00:00:00Z",
    }),
  );
});

test("unknown model/missing meters/nondefault tiers remain unknown; long-context boundary and ambiguity are explicit", async (t) => {
  const s = await scope();
  let value: any = result();
  t.mock.method(globalThis, "fetch", async () => Response.json(value));
  await withApiUsage(s, async () => {
    await withApiUsage({ ...s, userId: undefined }, () =>
      usageFetch("https://api.openai.com/v1/responses", post("unpriced-model")),
    );
    value = { ...result(), usage: { output_tokens: 10 } };
    await usageFetch("https://api.openai.com/v1/responses", post());
    value = { ...result(), service_tier: "priority" };
    await usageFetch("https://api.openai.com/v1/responses", post());
  });
  const rows = (
    await s.db.query(
      "SELECT estimated_cost FROM api_requests WHERE turn_id=$1",
      [s.turnId],
    )
  ).rows;
  assert.equal(rows.length, 3);
  assert.ok(rows.every((r) => r.estimated_cost === null));
  const rates = await loadRates(undefined);
  const base = {
    provider: "openai",
    model: "gpt-6-luna",
    operation: "responses",
    settings: { actual_service_tier: "default", cache_retention: "in-memory" },
    startedAt: new Date("2026-10-28"),
  };
  const short = matchRate(rates, {
    ...base,
    meters: { input_tokens: 272000 },
  })!;
  const long = matchRate(rates, { ...base, meters: { input_tokens: 272001 } })!;
  assert.equal(short.prices[0].amount, "0.10");
  assert.equal(long.prices[0].amount, "0.20");
  assert.equal(estimateCost(short, { output_tokens: 10 }), null);
  assert.throws(
    () =>
      matchRate([short, short], { ...base, meters: { input_tokens: 1000 } }),
    /Ambiguous/,
  );
  assert.equal(
    openAIUsage({ ...usage, input_tokens_details: { cached_tokens: 2000 } })
      .meters.ordinary_input_tokens,
    undefined,
  );
});

test("Meta Model API turns go to Meta and are priced from its rates", async (t) => {
  const s = await scope();
  const urls: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: unknown) => {
    urls.push(String(url));
    return Response.json({
      ...result(),
      model: "muse-spark-1.3",
      usage: {
        input_tokens: 1000,
        input_tokens_details: { cached_tokens: 400 },
        output_tokens: 200,
        output_tokens_details: { reasoning_tokens: 50 },
      },
    });
  });
  await withApiUsage(s, () =>
    new MetaProvider("test-key", "muse-spark-1.3").respond({
      instructions: "Test",
      messages: [],
      tools: [],
      signal: new AbortController().signal,
    }),
  );
  assert.deepEqual(urls, ["https://api.meta.ai/v1/responses"]);
  const {
    rows: [row],
  } = await s.db.query("SELECT * FROM api_requests WHERE turn_id=$1", [
    s.turnId,
  ]);
  assert.equal(row.provider, "meta");
  assert.equal(row.model, "muse-spark-1.3");
  assert.equal(row.credit_state, "settled");
  // 600 uncached at $1.25, 400 cached at $0.15 and 200 output at $4.25 per million.
  assert.equal(row.estimated_cost, "0.001660000000");
});

test("SDK retries have separate rows; incomplete paid results retain usage", async (t) => {
  const s = await scope();
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    if (++calls === 1)
      return Response.json(
        { error: { code: "rate_limit_exceeded" } },
        {
          status: 429,
          headers: { "retry-after-ms": "1", "x-request-id": "req_retry" },
        },
      );
    return Response.json({ ...result(), status: "incomplete" });
  });
  await assert.rejects(
    withApiUsage(s, () =>
      new OpenAIProvider("test-key", "gpt-6-luna").respond({
        instructions: "Test",
        messages: [],
        tools: [],
        signal: new AbortController().signal,
      }),
    ),
    /did not complete/,
  );
  const rows = (
    await s.db.query(
      "SELECT * FROM api_requests WHERE turn_id=$1 ORDER BY started_at",
      [s.turnId],
    )
  ).rows;
  assert.equal(calls, 2);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].status, "failed");
  assert.equal(rows[0].error_code, "rate_limit_exceeded");
  assert.equal(rows[0].estimated_cost, null);
  assert.equal(rows[1].retry_count, 1);
  assert.equal(rows[1].settings.response_status, "incomplete");
  assert.equal(rows[1].estimated_cost, "0.000166500000");
});

test("parallel accounting scopes retain their account and task; aborts and network failures are visible", async (t) => {
  const a = await scope(),
    b = await scope();
  t.mock.method(globalThis, "fetch", async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    return Response.json(result());
  });
  await Promise.all(
    [a, b].map((s) =>
      withApiUsage(s, () =>
        usageFetch("https://api.openai.com/v1/responses", post()),
      ),
    ),
  );
  for (const s of [a, b]) {
    const [r] = await apiUsageReport(s.db, { user: s.userId, turn: s.turnId });
    assert.equal(r.attempts, 1);
  }
  const error = new TypeError("PRIVATE network error");
  t.mock.method(globalThis, "fetch", async () => {
    throw error;
  });
  await assert.rejects(
    withApiUsage(a, () =>
      usageFetch("https://api.openai.com/v1/responses", post()),
    ),
    (e) => e === error,
  );
  await assert.rejects(
    withApiUsage(a, () =>
      usageFetch("https://api.openai.com/v1/responses", {
        ...post(),
        signal: AbortSignal.abort(),
      }),
    ),
  );
  const statuses = (
    await a.db.query("SELECT status FROM api_requests WHERE turn_id=$1", [
      a.turnId,
    ])
  ).rows
    .map((r) => r.status)
    .sort();
  assert.deepEqual(statuses, ["failed", "interrupted", "succeeded"]);
});

test("image multipart uploads and ElevenLabs audio are accounted without consuming or storing their media", async (t) => {
  const s = await scope();
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB9sAAAAASUVORK5CYII=",
    "base64",
  );
  t.mock.method(
    globalThis,
    "fetch",
    async (url: unknown, init: RequestInit) => {
      if (String(url) === "data:,") return new Response("");
      if (String(url).includes("openai")) {
        if (String(url).endsWith("edits"))
          assert.ok((init.body as FormData).get("image") instanceof Blob);
        return Response.json({
          data: [{ b64_json: png.toString("base64") }],
          usage: {
            input_tokens: 100,
            input_tokens_details: { text_tokens: 30, image_tokens: 70 },
            output_tokens: 80,
          },
        });
      }
      return new Response(new Uint8Array([73, 68, 51, 1]), {
        headers: {
          "content-type": "audio/mpeg",
          "character-cost": "123",
          "request-id": "req_audio",
        },
      });
    },
  );
  await withApiUsage(s, async () => {
    const images = new OpenAIImageProvider("test-key");
    assert.deepEqual(
      (await images.generateImage({ prompt: "PRIVATE PROMPT" })).data,
      png,
    );
    await images.editImage({
      prompt: "PRIVATE EDIT",
      image: new Blob([png], { type: "image/png" }),
    });
    const audio = await new ElevenLabsProvider("test-key").generateSoundEffect({
      text: "PRIVATE EFFECT",
      modelId: "eleven_text_to_sound_v2",
      durationSeconds: 5,
    });
    assert.equal(audio.data.length, 4);
  });
  const rows = (
    await s.db.query(
      "SELECT * FROM api_requests WHERE turn_id=$1 ORDER BY started_at",
      [s.turnId],
    )
  ).rows;
  assert.deepEqual(
    rows.map((r) => r.operation),
    ["image.generate", "image.edit", "sound_effect"],
  );
  assert.equal(rows[0].estimated_cost, "0.003110000000");
  assert.equal(rows[1].model, "gpt-image-2.5-flare");
  assert.equal(rows[2].estimated_cost, "0.010000000000");
  assert.equal(rows[2].usage_data.meters.billed_characters, 123);
  assert.ok(!JSON.stringify(rows).includes("PRIVATE"));
});

test("database failure before dispatch prevents purchase; completion failure recovers without repeating the paid call", async (t) => {
  const s = await scope();
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return Response.json(result());
  });
  const unavailable = {
    query: async () => {
      throw new Error("database unavailable");
    },
  } as unknown as Database;
  await assert.rejects(
    withApiUsage({ ...s, db: unavailable }, () =>
      usageFetch("https://api.openai.com/v1/responses", post()),
    ),
  );
  assert.equal(calls, 0);
  const brokenUpdate = {
    connect: () => s.db.connect(),
    query: async (sql: string, values: unknown[]) => {
      if (sql.startsWith("UPDATE api_requests"))
        throw new Error("database unavailable");
      return s.db.query(sql, values);
    },
  } as unknown as Database;
  const r = await withApiUsage({ ...s, db: brokenUpdate }, () =>
    usageFetch("https://api.openai.com/v1/responses", post()),
  );
  assert.deepEqual(await r.json(), result());
  assert.equal(calls, 1);
  assert.equal(
    (await apiUsageReport(s.db, { turn: s.turnId }))[0].unfinished,
    1,
  );
  await recoverApiUsage(s.db, s.recoveryDirectory);
  await recoverApiUsage(s.db, s.recoveryDirectory);
  assert.equal(
    (await apiUsageReport(s.db, { turn: s.turnId }))[0].estimated_cost,
    "0.000166500000",
  );
  assert.equal(calls, 1);
});

test("speech settles provider character counts and tagged Unicode fallback estimates", async (t) => {
  const s = await scope();
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    const headers = new Headers({ "content-type": "audio/mpeg" });
    if (++calls === 1) headers.set("character-cost", "20");
    return new Response(new Uint8Array([73, 68, 51, 1]), { headers });
  });
  const provider = new ElevenLabsProvider("test-key");
  await withApiUsage(s, async () => {
    for (let n = 0; n < 2; n++)
      await provider.generateSpeech({
        text: "🌊".repeat(10),
        voiceId: "test-voice",
        modelId: "eleven_multilingual_v2",
      });
  });
  const rows = (
    await s.db.query(
      "SELECT * FROM api_requests WHERE turn_id=$1 ORDER BY started_at",
      [s.turnId],
    )
  ).rows;
  assert.equal(rows.length, 2);
  assert.equal(rows[0].estimated_cost, "0.001600000000");
  assert.equal(rows[0].settings.billing_basis, "provider-character-cost");
  assert.equal(rows[0].usage_data.meters.billed_characters, 20);
  assert.equal(rows[1].estimated_cost, "0.000800000000");
  assert.equal(
    rows[1].settings.billing_basis,
    "accepted-input-characters-estimate",
  );
  assert.equal(rows[1].usage_data.meters.billed_characters, 10);
  assert.ok(
    rows.every(
      (row) =>
        row.credit_state === "settled" && row.credit_reserved === "0.000000000",
    ),
  );
  assert.equal(rows[0].credit_charged, "0.053333334");
  assert.equal(rows[1].credit_charged, "0.026666667");
});

test("accepted music settles by duration; a rejected generation has no accepted-duration charge", async (t) => {
  const s = await scope();
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () =>
    ++calls === 1
      ? new Response(new Uint8Array([73, 68, 51, 1]), {
          headers: { "content-type": "audio/mpeg", "character-cost": "999999" },
        })
      : Response.json(
          { detail: { status: "invalid_request" } },
          { status: 422 },
        ),
  );
  const provider = new ElevenLabsProvider("test-key");
  const args = {
    prompt: "PRIVATE MUSIC PROMPT",
    modelId: "music_v1" as const,
    durationMs: 30000,
  };
  await withApiUsage(s, async () => {
    await provider.generateMusic(args);
    await assert.rejects(provider.generateMusic(args));
  });
  const rows = (
    await s.db.query(
      "SELECT * FROM api_requests WHERE turn_id=$1 ORDER BY started_at",
      [s.turnId],
    )
  ).rows;
  assert.equal(rows[0].estimated_cost, "0.075000000000");
  assert.equal(rows[0].credit_charged, "2.500000000");
  assert.equal(rows[0].credit_state, "settled");
  assert.equal(rows[0].usage_data.meters.accepted_audio_seconds, 30);
  assert.equal(
    rows[0].settings.audio_duration_basis,
    "accepted-requested-duration-estimate",
  );
  assert.equal(rows[1].estimated_cost, null);
  assert.equal(rows[1].credit_state, "released");
  assert.equal(rows[1].usage_data.meters.accepted_audio_seconds, undefined);
  assert.ok(!JSON.stringify(rows).includes("PRIVATE"));
});

test("transcription saves its price but keeps the hold without full audio duration", async (t) => {
  const s = await scope();
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({
      language_code: "en",
      text: "PRIVATE TRANSCRIPT",
      words: [{ text: "PRIVATE WORD", type: "word", start: 2, end: 3 }],
    }),
  );
  const provider = new ElevenLabsProvider("test-key");
  await withApiUsage(s, () =>
    provider.transcribe({
      modelId: "scribe_v2",
      sourceUrl: "https://example.test/private-audio.mp3",
    }),
  );
  const {
    rows: [row],
  } = await s.db.query("SELECT * FROM api_requests WHERE turn_id=$1", [
    s.turnId,
  ]);
  assert.equal(row.pricing_snapshot.prices[0].amount, "0.22");
  assert.equal(row.pricing_snapshot.prices[0].perUnits, 3600);
  assert.equal(row.estimated_cost, null);
  assert.equal(row.credit_state, "pending");
  assert.equal(row.usage_data.meters.billed_audio_seconds, undefined);
  assert.ok(!JSON.stringify(row).includes("PRIVATE"));
  assert.ok(!JSON.stringify(row).includes("private-audio"));
});
