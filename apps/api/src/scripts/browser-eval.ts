/**
 * Observer for one browser eval attempt, run by Orca as a normal Inbox work task.
 * Only the frozen brief is submitted; success criteria and results stay with the
 * observer. No model calls in prepare, inspect or diagnose.
 *
 *   npm run browser:eval -- prepare flights|hotels|x-post-research <readiness-json>
 *   npm run browser:eval -- start <run-folder>
 *   npm run browser:eval -- inspect <run-folder>
 *   npm run browser:eval -- diagnose <run-folder>
 *
 * The readiness JSON is the observer's check, at most five minutes old, that the
 * desktop is signed in and the browser extension is connected:
 *   {"checked_at": "<ISO time>", "desktop_signed_in": true, "browser_connected": true}
 * POSTORCA_EVAL_EMAIL selects the founder account when there is more than one.
 */
import "../env.js";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { turnTraceDirectory } from "../agent/trace.js";
import { configFromEnv } from "../config.js";
import { createDatabase } from "../db.js";
import {
  browserDiagnostics,
  type EfficiencyReview,
} from "../evals/browser-diagnostics.js";
import {
  isObservedCase,
  observedCaseIds,
  preparedCase,
  rollingWindow,
} from "../evals/browser-cases.js";
import { issueToken } from "../middleware/auth.js";

type Verdict = "passed" | "failed" | "blocked" | "not_reviewed";
type CriterionResult = {
  id: string;
  criterion: string;
  verdict: Verdict;
  reasoning: string;
  evidence: string[];
};
type RunRecord = {
  schema_version: 1;
  case_id: string;
  title: string;
  brief: string;
  success_criteria: string;
  parameters: { [name: string]: string };
  prepared_at: string;
  model: string;
  platform: string;
  commit: string;
  dirty: string;
  hashes: { [file: string]: string };
  runtime_limits: { model_requests: number; minutes: number };
  preflight: object;
  task_id?: string;
  turn_id?: string;
  launch_attempted_at?: string;
  launch_error?: string;
};

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const apiRoot = fileURLToPath(new URL("../../", import.meta.url));
// npm runs workspace scripts in the package; paths given on the command line are
// relative to where the command was typed.
const fromInvocation = (path: string) =>
  resolve(process.env.INIT_CWD ?? process.cwd(), path);
const runtimeFiles = [
  "apps/api/src/evals/browser-cases.ts",
  "apps/api/src/evals/browser-diagnostics.ts",
  "apps/api/src/scripts/browser-eval.ts",
  "apps/api/src/agent/loop.ts",
  "apps/api/src/agent/context.ts",
  "apps/api/src/agent/prompts/system.md",
  "apps/api/src/plugins/browser/skills/browser-use/SKILL.md",
  "apps/api/src/plugins/browser/skills/browser-use/references/review.md",
  "apps/api/src/plugins/browser/tools.ts",
  "apps/api/src/tools/index.ts",
  "apps/api/src/tools/desktop.ts",
  "apps/desktop/electron/plugins/browser/founder-browser.cjs",
  "apps/desktop/electron/plugins/browser/click.cjs",
  "apps/desktop/electron/plugins/browser/observations.cjs",
  "apps/desktop/electron/plugins/browser/keyboard.cjs",
  "apps/desktop/electron/plugins/browser/fetch-file.cjs",
  "apps/browser-extension/background.js",
  "apps/browser-extension/capture.js",
];
async function fingerprints() {
  return Object.fromEntries(
    await Promise.all(
      runtimeFiles.map(async (file) => [
        file,
        createHash("sha256")
          .update(await readFile(resolve(repoRoot, file)))
          .digest("hex"),
      ]),
    ),
  );
}
async function readReviews(folder: string): Promise<EfficiencyReview[]> {
  try {
    return JSON.parse(await readFile(join(folder, "call-review.json"), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}
/** Token usage the provider recorded in the turn's local traces; null without traces. */
async function recordedUsage(taskId: string, turnId: string) {
  const folder = turnTraceDirectory({ taskId, turnId, step: 0 });
  let files: string[];
  try {
    files = await readdir(folder);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const results = await Promise.all(
    files
      .filter((file) => /^\d+\.result\.json$/.test(file))
      .map(async (file) =>
        JSON.parse(await readFile(join(folder, file), "utf8")),
      ),
  );
  return results.reduce(
    (sum, result) => ({
      recorded_model_results: sum.recorded_model_results + 1,
      input_tokens: sum.input_tokens + (result.usage?.input_tokens ?? 0),
      output_tokens: sum.output_tokens + (result.usage?.output_tokens ?? 0),
      cached_input_tokens:
        sum.cached_input_tokens +
        (result.usage?.input_tokens_details?.cached_tokens ?? 0),
    }),
    {
      recorded_model_results: 0,
      input_tokens: 0,
      output_tokens: 0,
      cached_input_tokens: 0,
    },
  );
}

const usage = `Use prepare ${observedCaseIds.join("|")} <readiness-json> | start <run-folder> | inspect <run-folder> | diagnose <run-folder>.`;
const [mode, selected, readinessArgument] = process.argv.slice(2);
if (!["prepare", "start", "inspect", "diagnose"].includes(mode ?? ""))
  throw new Error(usage);

if (mode === "diagnose") {
  // Offline: works from the retained evidence; launches nothing.
  if (!selected) throw new Error("Provide an existing run folder.");
  const folder = fromInvocation(selected);
  const run: RunRecord = JSON.parse(
    await readFile(join(folder, "run.json"), "utf8"),
  );
  const task = JSON.parse(await readFile(join(folder, "evidence.json"), "utf8"));
  const turn = task.turns.find((t: any) => t.id === run.turn_id);
  if (!turn) throw new Error("Recorded turn is absent from evidence.");
  const diagnostics = browserDiagnostics(turn, await readReviews(folder));
  const result = {
    ...diagnostics,
    case_id: run.case_id,
    task_id: run.task_id,
    usage: await recordedUsage(run.task_id!, run.turn_id!),
  };
  await writeFile(
    join(folder, "diagnostics.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(
    JSON.stringify(
      {
        measured: result.measured,
        reviewer_assessment: result.reviewer_assessment,
        usage: result.usage,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const config = configFromEnv();
const api = `http://127.0.0.1:${config.port}/api`;
const db = createDatabase(config.databaseUrl);
try {
  const email = process.env.POSTORCA_EVAL_EMAIL;
  const users = (
    await db.query(
      email ? "SELECT id FROM users WHERE email=$1" : "SELECT id FROM users",
      email ? [email] : [],
    )
  ).rows;
  if (users.length !== 1)
    throw new Error("Select exactly one founder account with POSTORCA_EVAL_EMAIL.");
  const token = issueToken(users[0].id, config.jwtSecret);
  async function call(
    route: string,
    method = "GET",
    body?: unknown,
  ): Promise<any> {
    const response = await fetch(api + route, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok)
      throw new Error(`${method} ${route}: HTTP ${response.status}`);
    return response.json();
  }
  const activeTurns = async () =>
    (
      await db.query(
        "SELECT id,status FROM turns WHERE status IN ('queued','running')",
      )
    ).rows;

  if (mode === "prepare") {
    const caseId = selected ?? "";
    if (!isObservedCase(caseId))
      throw new Error(
        `Select ${observedCaseIds.join(", ")}; prepare does not start an eval.`,
      );
    if (!readinessArgument)
      throw new Error(
        "Provide the observer's current desktop/browser readiness record.",
      );
    const readiness = JSON.parse(
      await readFile(fromInvocation(readinessArgument), "utf8"),
    );
    const age = Date.now() - Date.parse(readiness.checked_at);
    if (
      !Number.isFinite(age) ||
      age < 0 ||
      age > 5 * 60_000 ||
      readiness.desktop_signed_in !== true ||
      readiness.browser_connected !== true
    )
      throw new Error(
        "Desktop/browser readiness must be verified within the past five minutes.",
      );
    if (!config.orca)
      throw new Error(
        "Model provider must be configured before preparing a live run.",
      );
    if (!(await call("/health")).ok) throw new Error("API health failed.");
    // The desktop may run its built renderer, so the dev server is only recorded.
    const rendererHealthy = await fetch("http://127.0.0.1:5173", {
      signal: AbortSignal.timeout(5000),
    }).then(
      (response) => response.ok,
      () => false,
    );
    const applied = new Set(
      (await db.query("SELECT name FROM schema_migrations")).rows.map(
        (row) => row.name,
      ),
    );
    const pending = (await readdir(resolve(apiRoot, "src/migrations"))).filter(
      (file) => file.endsWith(".sql") && !applied.has(file),
    );
    if (pending.length)
      throw new Error(`Pending migrations: ${pending.join(", ")}`);
    const active = await activeTurns();
    if (active.length)
      throw new Error(
        "Other queued/running turns exist; do not overlap the evaluated run.",
      );

    const now = new Date();
    const entry = preparedCase(caseId, now);
    const localDay = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Bangkok",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
    const folder = resolve(
      repoRoot,
      ".data/browser-evals",
      `${localDay}-${caseId}`,
      now.toISOString().replace(/[:.]/g, "-"),
    );
    await mkdir(folder, { recursive: true });
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();
    const record: RunRecord = {
      schema_version: 1,
      case_id: entry.id,
      title: entry.title,
      brief: entry.brief,
      success_criteria: entry.success_criteria,
      parameters: entry.parameters,
      prepared_at: now.toISOString(),
      model: config.orca.model,
      platform: process.platform,
      commit: git("rev-parse", "HEAD"),
      dirty: git("status", "--porcelain"),
      hashes: await fingerprints(),
      runtime_limits: { model_requests: 100, minutes: 45 },
      preflight: {
        api_healthy: true,
        renderer_healthy: rendererHealthy,
        pending_migrations: pending,
        active_turns: active,
        ...readiness,
        date_basis: entry.date_basis,
      },
    };
    const criteria: CriterionResult[] = entry.success_criteria
      .split("\n")
      .map((line, index) => ({
        id: `${caseId}-${index + 1}`,
        criterion: line.replace(/^- /, ""),
        verdict: "not_reviewed",
        reasoning: "Run has not started.",
        evidence: [],
      }));
    await writeFile(join(folder, "run.json"), JSON.stringify(record, null, 2), {
      flag: "wx",
    });
    await writeFile(
      join(folder, "judgment.json"),
      JSON.stringify(
        {
          schema_version: 1,
          case_id: record.case_id,
          overall_verdict: "not_reviewed",
          judged_at: null,
          judge: "observer",
          criteria,
          limitations: [],
        },
        null,
        2,
      ),
      { flag: "wx" },
    );
    console.log(
      JSON.stringify({
        folder,
        brief: record.brief,
        criteria: criteria.length,
        ready: true,
      }),
    );
  } else {
    if (!selected) throw new Error("A prepared run folder is required.");
    const folder = fromInvocation(selected);
    const recordFile = join(folder, "run.json");
    const record: RunRecord = JSON.parse(await readFile(recordFile, "utf8"));
    if (!isObservedCase(record.case_id))
      throw new Error(
        `This observer supports only ${observedCaseIds.join(", ")}.`,
      );
    const save = () => writeFile(recordFile, JSON.stringify(record, null, 2));

    if (mode === "start") {
      if (record.launch_attempted_at || record.task_id || record.turn_id)
        throw new Error(
          "Launch already attempted; inspect instead of starting another run.",
        );
      if (JSON.stringify(await fingerprints()) !== JSON.stringify(record.hashes))
        throw new Error("Eval/runtime sources changed since prepare.");
      if (record.model !== config.orca?.model)
        throw new Error("Model changed since prepare.");
      if ((await activeTurns()).length)
        throw new Error("Another turn is active; do not start.");
      record.launch_attempted_at = new Date().toISOString();
      if (record.case_id === "x-post-research")
        Object.assign(
          record.parameters,
          rollingWindow(record.launch_attempted_at),
        );
      await save();
      try {
        const task = await call("/tasks", "POST", {
          kind: "work",
          title: record.title,
        });
        record.task_id = task.id;
        await save();
        // Only the natural user request crosses into the agent task.
        const turn = await call(`/tasks/${task.id}/turns`, "POST", {
          message: record.brief,
        });
        record.turn_id = turn.id;
        await save();
        console.log(
          JSON.stringify({
            task_id: task.id,
            turn_id: turn.id,
            model: record.model,
          }),
        );
      } catch (error) {
        record.launch_error = String(error);
        await save();
        throw error;
      }
    } else {
      if (!record.task_id) throw new Error("No task has been started.");
      const task = await call(`/tasks/${record.task_id}`);
      await writeFile(
        join(folder, "evidence.json"),
        JSON.stringify(task, null, 2),
      );
      const turn = task.turns.find((t: any) => t.id === record.turn_id);
      if (!turn)
        throw new Error("Recorded turn not found; inspect launch before retrying.");
      await writeFile(
        join(folder, "diagnostics.json"),
        JSON.stringify(
          browserDiagnostics(turn, await readReviews(folder)),
          null,
          2,
        ),
      );
      const calls = turn.messages.filter((m: any) => m.kind === "tool_call");
      const results = new Map(
        turn.messages
          .filter((m: any) => m.kind === "tool_result")
          .map((m: any) => [m.content.callId, m.content.result]),
      );
      const paired = calls.map((m: any) => ({
        message_id: m.id,
        call_id: m.content.callId,
        name: m.content.name,
        arguments: m.content.arguments,
        result: results.get(m.content.callId),
      }));
      await writeFile(
        join(folder, "calls.json"),
        JSON.stringify(paired, null, 2),
      );
      const settled = ["completed", "failed"].includes(turn.status);
      const current = await fingerprints();
      const summary = {
        schema_version: 1,
        case_id: record.case_id,
        task_id: task.id,
        turn_id: turn.id,
        inspected_at: new Date().toISOString(),
        status: turn.status,
        error: turn.error,
        started_at: turn.started_at,
        finished_at: turn.finished_at,
        seconds: turn.finished_at
          ? (Date.parse(turn.finished_at) - Date.parse(turn.started_at)) / 1000
          : null,
        tool_calls: calls.length,
        tool_counts: calls.reduce((counts: any, m: any) => {
          counts[m.content.name] = (counts[m.content.name] ?? 0) + 1;
          return counts;
        }, {}),
        errors: paired.filter(
          (c: any) =>
            c.result?.error || c.result?.ok === false || (!c.result && settled),
        ),
        pending_calls: paired.filter((c: any) => !c.result && !settled),
        artifacts: turn.artifacts.map((a: any) => ({
          id: a.id,
          kind: a.kind,
          title: a.title,
        })),
        final_message:
          turn.messages
            .filter((m: any) => m.kind === "assistant" && m.content.text)
            .at(-1)?.content.text ?? null,
        changed_source_files: Object.entries(current)
          .filter(([file, hash]) => record.hashes[file] !== hash)
          .map(([file]) => file),
      };
      await writeFile(
        join(folder, "summary.json"),
        JSON.stringify(summary, null, 2),
      );
      console.log(JSON.stringify(summary, null, 2));
    }
  }
} finally {
  await db.end();
}
