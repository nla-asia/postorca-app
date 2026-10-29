/** External observer CLI. No routes, database tables, or product runtime changes. */
import "../env.js";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { builtinCases, renderParameters } from "../evals/shared/catalog.js";
import { caseSchema } from "../evals/shared/contracts.js";
import { readJson, sha } from "../evals/shared/io.js";
import { EvalRunner } from "../evals/shared/runner.js";

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
  const config = configSchema.parse(await readJson(path(flags["--config"])));
  const original = config.case
    ? caseSchema.parse(config.case)
    : builtinCases(config.attempt, config.nonce).find((c) => c.id === selected);
  if (!original || original.id !== selected)
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
  console.log(
    JSON.stringify(
      await runner.prepare(
        entry,
        await runtime(config.model),
        config.readiness,
      ),
      null,
      2,
    ),
  );
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
} else if (mode === "recover-writer") {
  if (!selected) throw new Error("recover-writer <attempt-id>");
  await runner.recoverWriter(selected);
} else if (mode === "cleanup") {
  if (!selected) throw new Error("cleanup <attempt-id>");
  console.log(JSON.stringify(await runner.retryCleanup(selected), null, 2));
} else
  throw new Error(
    "Use list [plugin] | prepare <case> --config <file> | run <attempt> | collect <attempt> | inspect <attempt> | review <attempt> --review <file> | regrade <attempt> --reason <reason> | triage <attempt> --triage <file> | report | reconcile-task <attempt> --task <id>",
  );
