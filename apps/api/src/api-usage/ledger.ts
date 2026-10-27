import {
  CreditError,
  reserveApiCredits,
  settleApiCredits,
} from "../billing/credits.js";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import {
  mkdir,
  readdir,
  readFile,
  writeFile,
  unlink,
  rename,
} from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { z } from "zod";
import type { Database } from "../db.js";
import { openAIUsage } from "./openai.js";
import { estimateCost, loadRates, matchRate } from "./pricing.js";

const context = new AsyncLocalStorage<{
  db: Database;
  userId?: string;
  taskId?: string;
  turnId?: string;
  /** Isolates recovery files for temporary databases and tests. */
  recoveryDirectory?: string;
}>();
/** Also usable by paid CLI smoke/eval calls; context remains isolated across turns. */
export function withApiUsage<T>(
  scope: NonNullable<ReturnType<typeof context.getStore>>,
  work: () => T,
): T {
  return context.run(scope, work);
}
const recoveryDirectory = fileURLToPath(
  new URL("../../.data/api-usage-recovery/", import.meta.url),
);
const safeId = (v: unknown): string | null =>
  typeof v === "string" && /^[a-zA-Z0-9_.:/-]{1,255}$/.test(v) ? v : null;
function numericTree(value: unknown): unknown {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0)
    return value;
  if (value && typeof value === "object" && !Array.isArray(value))
    return Object.fromEntries(
      Object.entries(value)
        .map(([k, v]) => [k, numericTree(v)])
        .filter(([, v]) => v !== undefined),
    );
  return undefined;
}
const patchSchema = z.object({
  id: z.uuid(),
  status: z.enum(["succeeded", "failed", "interrupted"]),
  httpStatus: z.number().int().nullable(),
  requestId: z.string().nullable(),
  responseId: z.string().nullable(),
  errorCode: z.string().nullable(),
  settings: z.record(z.string(), z.unknown()),
  usage: z.record(z.string(), z.unknown()),
  pricing: z.unknown(),
  cost: z.string().nullable(),
  currency: z.string().nullable(),
  finishedAt: z.iso.datetime(),
  duration: z.number().int().nonnegative(),
});
type Patch = z.infer<typeof patchSchema>;
async function update(db: Database, p: Patch) {
  await db.query(
    `UPDATE api_requests SET status=$2,http_status=$3,provider_request_id=$4,
    provider_response_id=$5,error_code=$6,settings=$7,usage_data=$8,pricing_snapshot=$9,
    estimated_cost=$10,estimated_currency=$11,finished_at=$12,duration_ms=$13
    WHERE id=$1 AND status='started'`,
    [
      p.id,
      p.status,
      p.httpStatus,
      p.requestId,
      p.responseId,
      p.errorCode,
      p.settings,
      p.usage,
      p.pricing,
      p.cost,
      p.currency,
      p.finishedAt,
      p.duration,
    ],
  );
  await settleApiCredits(db, p.id);
}
/** Fixed structured patches, never SQL or credentials. Replay is idempotent. */
export async function recoverApiUsage(
  db: Database,
  directory = recoveryDirectory,
) {
  const files = await readdir(directory).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    },
  );
  for (const name of files.filter((name) =>
    /^[a-f0-9-]{36}\.json$/.test(name),
  )) {
    let contents;
    try {
      contents = await readFile(join(directory, name), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    await update(db, patchSchema.parse(JSON.parse(contents)));
    await unlink(join(directory, name)).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      },
    );
  }
}

/** Transport instrumentation preserves request bodies, response bodies and SDK retries.
 * Rows represent HTTP outcomes, including incomplete model responses with billable usage.
 * Outside an explicit accounting scope this is the normal fetch (e.g. unit tests).
 */
export const usageFetch: typeof fetch = async (input, init) => {
  const scope = context.getStore();
  if (!scope) return globalThis.fetch(input, init);
  const url = new URL(input instanceof Request ? input.url : String(input));
  const provider =
    url.hostname === "api.openai.com"
      ? "openai"
      : url.hostname === "api.elevenlabs.io"
        ? "elevenlabs"
        : null;
  if (!provider) return globalThis.fetch(input, init);
  const body = init?.body;
  let args: Record<string, unknown> = {};
  if (typeof body === "string") {
    try {
      args = JSON.parse(body);
    } catch {
      /* metadata unavailable */
    }
  } else if (body instanceof FormData)
    args = Object.fromEntries(body.entries());
  const operation =
    url.pathname === "/v1/responses"
      ? "responses"
      : url.pathname === "/v1/images/generations"
        ? "image.generate"
        : url.pathname === "/v1/images/edits"
          ? "image.edit"
          : url.pathname.startsWith("/v1/text-to-speech/")
            ? "speech"
            : url.pathname === "/v1/sound-generation"
              ? "sound_effect"
              : url.pathname === "/v1/music"
                ? "music"
                : url.pathname === "/v1/speech-to-text"
                  ? "transcription"
                  : "catalog";
  const model = safeId(args.model ?? args.model_id) ?? "unspecified";
  const settings: Record<string, unknown> = {};
  for (const key of [
    "size",
    "quality",
    "service_tier",
    "prompt_cache_retention",
  ])
    if (typeof args[key] === "string") settings[key] = safeId(args[key]);
  if (operation === "responses")
    settings.cache_retention = args.prompt_cache_retention ?? "in-memory";
  const startedAt = new Date(),
    id = randomUUID();
  // Capture rates at dispatch, before an edit to configuration can change the cost.
  const rates = await loadRates();
  const recoveryPath = scope.recoveryDirectory ?? recoveryDirectory;
  await recoverApiUsage(scope.db, recoveryPath);
  const retry = Number(
    new Headers(init?.headers).get("x-stainless-retry-count") ?? 0,
  );
  await scope.db.query(
    `INSERT INTO api_requests
    (id,user_id,task_id,turn_id,provider,model,operation,retry_count,settings,started_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      id,
      scope.userId ?? null,
      scope.taskId ?? null,
      scope.turnId ?? null,
      provider,
      model,
      operation,
      Number.isSafeInteger(retry) && retry >= 0 ? retry : 0,
      settings,
      startedAt,
    ],
  );
  if (scope.userId && operation !== "catalog") {
    try {
      await reserveApiCredits(scope.db, {
        id,
        userId: scope.userId,
        provider,
        model,
        operation,
        args,
      });
    } catch (error) {
      if (!(error instanceof CreditError)) throw error;
      await scope.db.query(
        `UPDATE api_requests SET status='failed',credit_state='blocked',http_status=402,error_code=$2,estimated_cost=0,estimated_currency='USD',settings=settings || '{"dispatch":"blocked"}'::jsonb,finished_at=clock_timestamp(),duration_ms=$3 WHERE id=$1`,
        [id, error.code, Date.now() - startedAt.getTime()],
      );
      // A 402 prevents the SDK from retrying an allowance rejection as a connection error.
      return Response.json(
        {
          error: { code: error.code, message: error.message },
          detail: { code: error.code },
        },
        { status: 402, headers: { "x-postorca-credit-error": error.code } },
      );
    }
  }
  let response: Response | undefined, failure: unknown;
  try {
    response = await globalThis.fetch(input, init);
  } catch (error) {
    failure = error;
  }
  const p: Patch = {
    id,
    status: response
      ? response.ok
        ? "succeeded"
        : "failed"
      : init?.signal?.aborted
        ? "interrupted"
        : "failed",
    httpStatus: response?.status ?? null,
    requestId: safeId(
      response?.headers.get("x-request-id") ??
        response?.headers.get("request-id"),
    ),
    responseId: null,
    errorCode: failure
      ? (safeId((failure as Error)?.name) ?? "transport_error")
      : null,
    settings,
    usage: { meters: {} },
    pricing: null,
    cost: null,
    currency: null,
    finishedAt: new Date().toISOString(),
    duration: Date.now() - startedAt.getTime(),
  };
  try {
    let data: Record<string, any> | undefined;
    if (response?.headers.get("content-type")?.includes("application/json")) {
      try {
        data = (await response.clone().json()) as Record<string, any>;
      } catch {
        p.errorCode = "unreadable_usage";
      }
    }
    p.responseId = safeId(data?.id);
    if (!response?.ok)
      p.errorCode ??=
        safeId(data?.error?.code) ??
        (response ? "http_error" : "transport_error");
    if (operation === "responses") {
      settings.actual_model = safeId(data?.model);
      settings.actual_service_tier = safeId(data?.service_tier);
      settings.response_status = safeId(data?.status);
    }
    const usage = openAIUsage(numericTree(data?.usage));
    if (provider === "elevenlabs" && response?.ok) {
      const characterCost = response.headers.get("character-cost");
      if (
        characterCost !== null &&
        /^\d+(\.\d+)?$/.test(characterCost) &&
        Number.isFinite(Number(characterCost))
      )
        usage.meters.billed_characters = Number(characterCost);
      if (typeof args.text === "string")
        usage.meters.accepted_characters = [...args.text].length;
      if (operation === "speech") {
        settings.billing_basis =
          usage.meters.billed_characters === undefined
            ? "accepted-input-characters-estimate"
            : "provider-character-cost";
        usage.meters.billed_characters ??= usage.meters.accepted_characters;
      }
      if (
        operation === "sound_effect" &&
        typeof args.duration_seconds === "number"
      )
        usage.meters.accepted_audio_seconds = args.duration_seconds;
      if (operation === "music" && typeof args.music_length_ms === "number") {
        usage.meters.requested_audio_seconds = args.music_length_ms / 1000;
        usage.meters.accepted_audio_seconds = args.music_length_ms / 1000;
        settings.audio_duration_basis = "accepted-requested-duration-estimate";
      }
    }
    p.usage = usage as unknown as Record<string, unknown>;
    const rate = matchRate(rates, {
      provider,
      model,
      operation,
      settings,
      startedAt,
      meters: usage.meters,
    });
    if (rate) {
      p.pricing = rate;
      p.cost = estimateCost(rate, usage.meters);
      p.currency = rate.currency;
    }
  } catch {
    p.errorCode ??= "accounting_metadata_error";
  }
  p.finishedAt = new Date().toISOString();
  p.duration = Date.now() - startedAt.getTime();
  try {
    await update(scope.db, p);
  } catch {
    // Returning the paid response prevents accounting outages causing another charge.
    try {
      await mkdir(recoveryPath, { recursive: true, mode: 0o700 });
      await writeFile(join(recoveryPath, `${id}.tmp`), JSON.stringify(p), {
        mode: 0o600,
      });
      await rename(
        join(recoveryPath, `${id}.tmp`),
        join(recoveryPath, `${id}.json`),
      );
      console.error(`API usage ${id} queued for database recovery.`);
    } catch {
      console.error(
        `API usage ${id} could not be finalized; reconcile its started row.`,
      );
    }
  }
  if (!response) throw failure;
  return response;
};
