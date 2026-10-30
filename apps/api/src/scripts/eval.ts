/** External observer CLI. No routes, database tables, or product runtime changes. */
import "../env.js";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { builtinCases, renderParameters } from "../evals/shared/catalog.js";
import { caseSchema } from "../evals/shared/contracts.js";
import { maybeJson, readJson, sha } from "../evals/shared/io.js";
import { EvalRunner } from "../evals/shared/runner.js";
import {
  benchmark,
  html,
  loadAttempts,
  markdown,
  nextCase,
  readPlan,
  writePlan,
  planFile,
} from "../evals/shared/benchmark.js";
import { settings } from "../settings.js";

const repo = fileURLToPath(new URL("../../../../", import.meta.url));
const invocation = process.env.INIT_CWD ?? process.cwd();
const args = process.argv.slice(2);
const mode = args.shift() ?? "list";
const selected = args[0]?.startsWith("--") ? undefined : args.shift();
const flags: Record<string, string> = {};
while (args.length) {
  const key = args.shift()!;
  const value = args.shift();
  if (!key.startsWith("--") || !value || value.startsWith("--") || flags[key])
    throw new Error(`Invalid option ${key}`);
  flags[key] = value;
}
for (const key of Object.keys(flags))
  if (
    ![
      "--root",
      "--config",
      "--review",
      "--task",
      "--reason",
      "--triage",
      "--out",
      "--plan",
      "--model",
      "--cases",
      "--repeats",
    ].includes(key)
  )
    throw new Error(`Unknown option ${key}`);
const path = (value: string) => resolve(invocation, value);
const configSchema = z
  .object({
    model: z.string().min(1),
    parameters: z.record(z.string(), z.string()).default({}),
    readiness: z
      .record(
        z.string(),
        z
          .object({
            reason: z.string().trim().min(1),
            checked_at: z.iso.datetime({ offset: true }),
          })
          .strict(),
      )
      .default({}),
    attempt: z.number().int().positive().default(1),
    nonce: z.string().default("project-notes"),
    case: z.unknown().optional(),
    // Add observer hooks/fixture pins to a built-in case; never replace its criteria.
    fixture: caseSchema.shape.fixture.optional(),
    verifier: caseSchema.shape.verifier.optional(),
  })
  .strict();
const root = flags["--root"]
  ? path(flags["--root"])
  : join(repo, ".data/evals");
const runner = new EvalRunner(root, {
  api: process.env.POSTORCA_EVAL_API,
  token: process.env.POSTORCA_EVAL_TOKEN,
});
const git = (...a: string[]) =>
  execFileSync("git", a, {
    cwd: repo,
    encoding: "utf8",
    windowsHide: true,
  }).trim();
async function runtime(model: string) {
  const names = execFileSync(
    "git",
    ["ls-files", "-co", "--exclude-standard", "-z"],
    { cwd: repo, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  )
    .split("\0")
    .filter(Boolean)
    .sort();
  const files = await Promise.all(
    names.map(async (file) => [file, sha(await readFile(join(repo, file)))]),
  );
  const commit = git("rev-parse", "HEAD");
  return {
    model,
    platform: process.platform,
    commit,
    dirty: git("status", "--porcelain"),
    fingerprint: sha(
      JSON.stringify({ model, platform: process.platform, commit, files }),
    ),
  };
}
async function prepare(caseId: string, model?: string) {
  const config = configSchema.parse(await readJson(path(flags["--config"])));
  if (model && config.model !== model)
    throw new Error(
      `The config declares ${config.model}; this plan runs ${model}`,
    );
  const original = config.case
    ? caseSchema.parse(config.case)
    : builtinCases(config.attempt, config.nonce).find((c) => c.id === caseId);
  if (!original || original.id !== caseId)
    throw new Error("Unknown or mismatched case ID");
  const entry = renderParameters(
    caseSchema.parse({
      ...original,
      ...(config.fixture ? { fixture: config.fixture } : {}),
      ...(config.verifier ? { verifier: config.verifier } : {}),
    }),
    config.parameters,
  );
  // Freeze resolved absolute paths; hooks execute from the attempt folder.
  if (entry.fixture)
    entry.fixture.files = entry.fixture.files.map((f) => ({
      ...f,
      path: path(f.path),
    }));
  return runner.prepare(entry, await runtime(config.model), config.readiness);
}

if (mode === "list") {
  console.log(
    JSON.stringify(
      builtinCases()
        .filter(
          (c) =>
            !selected ||
            c.plugin === selected ||
            selected === `level-${c.level}`,
        )
        .map((c) => ({
          id: c.id,
          category: c.plugin,
          title: c.title,
          turns: c.turns.length,
          prerequisites: c.prerequisites,
          platform: c.platform,
          level: c.level,
        })),
      null,
      2,
    ),
  );
} else if (mode === "prepare") {
  if (!selected || !flags["--config"])
    throw new Error("prepare <case-id> --config <observer-config.json>");
  console.log(JSON.stringify(await prepare(selected), null, 2));
} else if (mode === "run") {
  if (!selected) throw new Error("run <attempt-id>");
  const { run } = await runner.load(selected);
  console.log(
    JSON.stringify(
      await runner.run(selected, (await runtime(run.model)).fingerprint),
      null,
      2,
    ),
  );
} else if (mode === "collect") {
  if (!selected) throw new Error("collect <attempt-id>");
  await runner.collect(selected);
  console.log(JSON.stringify(await runner.grade(selected), null, 2));
} else if (mode === "inspect") {
  if (!selected) throw new Error(`${mode} <attempt-id>`);
  console.log(JSON.stringify(await runner.inspect(selected), null, 2));
} else if (mode === "regrade") {
  if (!selected || !flags["--reason"])
    throw new Error(
      'regrade <attempt-id> --reason "evidence-based correction reason"',
    );
  console.log(
    JSON.stringify(await runner.regrade(selected, flags["--reason"]), null, 2),
  );
} else if (mode === "triage") {
  if (!selected || !flags["--triage"])
    throw new Error("triage <attempt-id> --triage <diagnosis.json>");
  console.log(
    JSON.stringify(
      await runner.triage(selected, await readJson(path(flags["--triage"]))),
      null,
      2,
    ),
  );
} else if (mode === "review") {
  if (!selected || !flags["--review"])
    throw new Error("review <attempt-id> --review <completed-review.json>");
  console.log(
    JSON.stringify(
      await runner.review(selected, await readJson(path(flags["--review"]))),
      null,
      2,
    ),
  );
} else if (mode === "reconcile-task") {
  if (!selected || !flags["--task"])
    throw new Error("reconcile-task <attempt-id> --task <existing-task-id>");
  await runner.reconcileTask(selected, flags["--task"]);
} else if (mode === "report") {
  console.log(JSON.stringify(await runner.report(), null, 2));
} else if (mode === "benchmark") {
  const { attempts, skipped } = await loadAttempts(root);
  const plan = flags["--plan"] ? await readPlan(root, flags["--plan"]) : null;
  const report = benchmark(
    plan ? attempts.filter((a) => plan.attempts.includes(a.id)) : attempts,
  );
  if (flags["--out"]) {
    const out = path(flags["--out"]);
    await mkdir(dirname(out), { recursive: true });
    await writeFile(
      out,
      out.endsWith(".html") ? html(report) : markdown(report),
    );
  }
  console.log(JSON.stringify({ ...report, plan, skipped }, null, 2));
} else if (mode === "benchmark-plan") {
  if (!selected || !flags["--model"] || !flags["--cases"])
    throw new Error(
      "benchmark-plan <name> --model <model> --cases <category|level-N|case,case> [--repeats 3]",
    );
  if (await maybeJson(planFile(root, selected)))
    throw new Error(`Plan ${selected} already exists`);
  const all = builtinCases();
  const wanted = flags["--cases"].split(",");
  const cases = all
    .filter((c) =>
      wanted.some(
        (w) => w === c.id || w === c.plugin || w === `level-${c.level}`,
      ),
    )
    .map((c) => c.id);
  const unknown = wanted.filter(
    (w) =>
      !all.some(
        (c) => w === c.id || w === c.plugin || w === `level-${c.level}`,
      ),
  );
  if (unknown.length || !cases.length)
    throw new Error(`Unknown cases: ${unknown.join(", ") || flags["--cases"]}`);
  const plan = {
    name: selected,
    model: flags["--model"],
    cases,
    repeats: Number(flags["--repeats"] ?? 3),
    created_at: new Date().toISOString(),
    attempts: [],
  };
  await writePlan(root, plan);
  console.log(JSON.stringify(plan, null, 2));
} else if (mode === "benchmark-next") {
  if (!selected || !flags["--config"])
    throw new Error("benchmark-next <plan> --config <observer-config.json>");
  const plan = await readPlan(root, selected);
  if (settings.orca.model !== plan.model)
    throw new Error(
      `Plan ${plan.name} is for ${plan.model}, but settings.orca in this checkout is ${settings.orca.model}`,
    );
  const next = await nextCase(root, plan);
  if (!next) {
    console.log(JSON.stringify({ plan: plan.name, done: true }, null, 2));
  } else {
    const run = await prepare(next, plan.model);
    await writePlan(root, { ...plan, attempts: [...plan.attempts, run.id] });
    console.log(
      JSON.stringify(
        {
          plan: plan.name,
          attempt: run.id,
          case_id: next,
          next: `npm run eval -- run ${run.id}`,
        },
        null,
        2,
      ),
    );
  }
} else if (mode === "recover-writer") {
  if (!selected) throw new Error("recover-writer <attempt-id>");
  await runner.recoverWriter(selected);
} else if (mode === "cleanup") {
  if (!selected) throw new Error("cleanup <attempt-id>");
  console.log(JSON.stringify(await runner.retryCleanup(selected), null, 2));
} else
  throw new Error(
    "Use list [plugin] | prepare <case> --config <file> | run <attempt> | collect <attempt> | inspect <attempt> | review <attempt> --review <file> | regrade <attempt> --reason <reason> | triage <attempt> --triage <file> | report | benchmark [--plan <name>] [--out <file.html|.md>] | benchmark-plan <name> --model <m> --cases <list> [--repeats N] | benchmark-next <plan> --config <file> | reconcile-task <attempt> --task <id>",
  );
