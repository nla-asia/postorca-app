import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  benchmark,
  cell,
  failureCause,
  html,
  latestBatch,
  loadAttempts,
  markdown,
  median,
  nextCase,
  readPlan,
  writePlan,
  type BenchmarkAttempt,
} from "../src/evals/shared/benchmark.js";
import { caseSchema } from "../src/evals/shared/contracts.js";
import { json } from "../src/evals/shared/io.js";
import { gradingPolicyVersion } from "../src/evals/shared/judge.js";
import { EvalRunner } from "../src/evals/shared/runner.js";

let n = 0;
function attempt(overrides: Partial<BenchmarkAttempt> = {}): BenchmarkAttempt {
  n++;
  return {
    id: `a-${n}`,
    case_id: "writing-post-in-voice",
    category: "writing",
    level: 2,
    model: "muse-spark-1.3",
    created_at: new Date(Date.UTC(2026, 9, 1, 0, n)).toISOString(),
    commit: "c1",
    outcome: "passed",
    cause: null,
    elapsed_ms: 60_000,
    tool_calls: 10,
    failed_tool_calls: 0,
    cost: null,
    ...overrides,
  };
}
const failed = (cause: BenchmarkAttempt["cause"], o = {}) =>
  attempt({ outcome: "failed", cause, ...o });
const result = (findings: any[] | null, checks: any[]) => ({
  checks,
  triage: findings
    ? { status: "recorded", findings }
    : { status: "awaiting_triage", findings: [] },
});
const finding = (side: string, ids: string[]) => ({ side, check_ids: ids });

test("a failure is the agent's when any agent finding covers a failing check", () => {
  const checks = [
    { id: "demo-2", verdict: "failed" },
    { id: "demo-5", verdict: "failed" },
    { id: "downloads", verdict: "passed" },
  ];
  assert.equal(
    failureCause(
      result(
        [finding("infrastructure", ["demo-5"]), finding("agent", ["demo-2"])],
        checks,
      ),
    ),
    "agent",
  );
  // Recovered tool errors blamed on the agent do not make an infra failure the agent's.
  assert.equal(
    failureCause(
      result(
        [
          finding("infrastructure", ["demo-2", "demo-5"]),
          finding("agent", ["tool-error:t:c"]),
        ],
        checks,
      ),
    ),
    "infrastructure",
  );
  assert.equal(
    failureCause(
      result(
        [finding("eval", ["demo-2"]), finding("infrastructure", ["demo-5"])],
        checks,
      ),
    ),
    "infrastructure",
  );
  assert.equal(
    failureCause(result([finding("eval", ["demo-2", "demo-5"])], checks)),
    "eval",
  );
  assert.equal(
    failureCause(
      result(
        [finding("eval", ["demo-2"]), finding("unclassified", ["demo-5"])],
        checks,
      ),
    ),
    "untriaged",
  );
  assert.equal(failureCause(result(null, checks)), "untriaged");
});

test("pass rate leaves out eval and infrastructure failures but shows them", () => {
  const c = cell("m", "writing", 2, [
    attempt(),
    failed("agent"),
    failed("eval"),
    failed("infrastructure"),
    failed("untriaged"),
    attempt({ outcome: "blocked" }),
    attempt({ outcome: "awaiting_review" }),
    attempt({ outcome: "stale" }),
    attempt(),
  ]);
  assert.equal(c.attempts, 9);
  assert.equal(c.passed, 2);
  assert.deepEqual(c.failed, {
    agent: 1,
    infrastructure: 1,
    eval: 1,
    untriaged: 1,
  });
  assert.equal(c.scored, 4);
  assert.equal(c.pass_rate, 0.5);
  assert.equal(c.blocked, 1);
  assert.equal(c.awaiting_review, 1);
  assert.equal(c.stale, 1);
  // Excluded attempts after the untriaged failure do not reset the streak.
  assert.equal(c.streak, 1);
  assert.equal(cell("m", "writing", 2, []).pass_rate, null);
});

test("streak counts the newest scored passes; medians use graded attempts", () => {
  const c = cell("m", "media", 2, [
    attempt({ elapsed_ms: 10, tool_calls: 1 }),
    failed("agent", { elapsed_ms: 20, tool_calls: 3 }),
    attempt({ elapsed_ms: 30, tool_calls: 5 }),
    failed("eval", { elapsed_ms: 40, tool_calls: 7 }),
    attempt({ elapsed_ms: 50, tool_calls: 9 }),
    attempt({ outcome: "blocked", elapsed_ms: 1e9, tool_calls: 1e9 }),
  ]);
  assert.equal(c.streak, 2);
  assert.equal(c.median_elapsed_ms, 30);
  assert.equal(c.median_tool_calls, 5);
  assert.equal(c.median_cost, null);
  assert.equal(median([4, null, 1, 3, 2]), 2.5);
  assert.equal(median([]), null);
});

test("latest batch keeps each model's newest run of a case and its repeats", () => {
  const old = failed("agent", { case_id: "x", commit: "c1" });
  const oldOther = attempt({ case_id: "y", commit: "c1" });
  const repeatA = attempt({ case_id: "x", commit: "c2" });
  const repeatB = failed("agent", { case_id: "x", commit: "c2" });
  const luna = attempt({ case_id: "x", model: "gpt-6-luna", commit: "c1" });
  const kept = latestBatch([old, oldOther, repeatA, repeatB, luna]);
  // Case x: the c2 batch replaces the c1 run; case y keeps its only run;
  // another model's batch is chosen on its own.
  assert.deepEqual(
    kept.map((a) => a.id),
    [oldOther.id, repeatA.id, repeatB.id, luna.id],
  );
  const c = cell(
    "muse-spark-1.3",
    "writing",
    2,
    kept.filter((a) => a.model === "muse-spark-1.3"),
  );
  assert.equal(c.pass_rate, 2 / 3);
});

test("rows by category and level, with a lead only on a clear, sufficient gap", () => {
  const a = "muse-spark-1.3";
  const b = "gpt-6-luna";
  const attempts = [
    // Writing L2: b 3/3, a 1/3 → b leads.
    ...[0, 1, 2].map(() => attempt({ model: b })),
    attempt({ model: a }),
    failed("agent", { model: a }),
    failed("agent", { model: a }),
    // Writing L1: a 2/2, b 0/2 → too few scored for a lead.
    ...[0, 1].map(() =>
      attempt({ model: a, level: 1, case_id: "writing-tools" }),
    ),
    ...[0, 1].map(() =>
      failed("agent", { model: b, level: 1, case_id: "writing-tools" }),
    ),
    // Computer L2: a 3/3, b 3/3 → tie, no lead.
    ...[a, a, a, b, b, b].map((model) =>
      attempt({ model, category: "computer", case_id: "computer-demo" }),
    ),
    // Browser L2: a 3/3; b's only failures are eval defects → b unscored.
    ...[0, 1, 2].map(() =>
      attempt({ model: a, category: "browser", case_id: "browser-x" }),
    ),
    ...[0, 1, 2].map(() =>
      failed("eval", { model: b, category: "browser", case_id: "browser-x" }),
    ),
  ];
  const report = benchmark(attempts);
  assert.deepEqual(report.models, [b, a]);
  assert.deepEqual(
    report.rows.map((r) => [r.category, r.level, r.leader]),
    [
      ["browser", 2, null],
      ["computer", 2, null],
      ["writing", 1, null],
      ["writing", 2, b],
      ["writing", null, null],
    ],
  );
  const all = report.rows.at(-1)!;
  assert.equal(all.cells.find((c) => c.model === a)!.pass_rate, 3 / 5);
  assert.equal(all.cells.find((c) => c.model === b)!.pass_rate, 3 / 5);
  // Over all writing levels both are 3/5: no lead.
  assert.equal(all.leader, null);
  assert.deepEqual(report.strengths, [
    { model: b, leads: ["Writing L2"] },
    { model: a, leads: [] },
  ]);
  const browser = report.rows[0].cells.find((c) => c.model === b)!;
  assert.equal(browser.scored, 0);
  assert.equal(browser.failed.eval, 3);
  assert.equal(report.cases.length, 4);
  assert.equal(report.overall.find((c) => c.model === a)!.scored, 11);

  // Category first, each over all its levels, holding its levels and cases.
  assert.deepEqual(
    report.categories.map((c) => [
      c.category,
      c.leader,
      c.levels.map((l) => l.level),
      c.cases.map((x) => x.case_id),
    ]),
    [
      ["browser", null, [2], ["browser-x"]],
      ["computer", null, [2], ["computer-demo"]],
      ["writing", null, [1, 2], ["writing-post-in-voice", "writing-tools"]],
    ],
  );
  const md = markdown(report);
  assert.match(md, /\| Category \| gpt-6-luna \| muse-spark-1\.3 \|/);
  assert.match(md, /\| Writing \| 60% \(3\/5\) \| 60% \(3\/5\) \|/);
  assert.match(md, /<details><summary>Writing<\/summary>/);
  assert.match(md, /\| Level 2 \| \*\*100% \(3\/3\)\*\* \| 33% \(1\/3\) \|/);
  // Only an unscored dash for b's eval-defect failures; no detail report.
  assert.match(md, /\| browser-x \| – \| 100% \(3\/3\) \|/);
  assert.doesNotMatch(md, /streak|not counted|root cause/i);
  const page = html(report);
  assert.match(page, /<title>Model benchmark<\/title>/);
  // Only the Writing L2 level row has a leader; it is hidden until expanded.
  assert.equal((page.match(/class="lead"/g) ?? []).length, 1);
  assert.equal((page.match(/<tr class="head">/g) ?? []).length, 3);
  assert.match(page, /aria-expanded="false">Writing<\/button>/);
  assert.doesNotMatch(page, /streak|not counted|root cause/i);
});

async function sandbox(t: any) {
  const path = await mkdtemp(join(tmpdir(), "postorca-benchmark-"));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}
const runtime = (model: string) => ({
  model,
  platform: process.platform,
  commit: "abc",
  dirty: "",
  fingerprint: "fp",
});
const sample = caseSchema.parse({
  id: "sample",
  plugin: "writing",
  level: 2,
  title: "Write a post",
  turns: [{ brief: "Write the post." }],
  criteria: [{ id: "voice", text: "Sounds like the founder." }],
});

test("loads stored results read-only, marks changed evidence stale, skips prepared", async (t) => {
  const root = await sandbox(t);
  const runner = new EvalRunner(root);
  await runner.prepare(sample, runtime("m"));
  const graded = await runner.prepare(sample, runtime("m"));
  const changed = await runner.prepare(sample, runtime("m"));
  for (const run of [graded, changed]) {
    const folder = join(root, run.id);
    await json(join(folder, "run.json"), { ...run, execution: "completed" });
    await json(join(folder, "evidence.json"), {
      task: { turns: [] },
      calls: [],
      downloads: [],
    });
    await runner.grade(run.id);
  }
  await writeFile(join(root, changed.id, "evidence", "late.txt"), "changed");
  const { attempts, skipped } = await loadAttempts(root);
  assert.deepEqual(skipped, []);
  assert.deepEqual(
    attempts.map((a) => [a.id, a.category, a.level, a.outcome]).sort(),
    [
      [graded.id, "writing", 2, "failed"],
      [changed.id, "writing", 2, "stale"],
    ].sort(),
  );
  const stored = JSON.parse(
    await readFile(join(root, graded.id, "result.json"), "utf8"),
  );
  assert.equal(stored.grading_policy_version, gradingPolicyVersion);
});

test("a plan prepares one case at a time and waits for review", async (t) => {
  const root = await sandbox(t);
  const runner = new EvalRunner(root);
  const plan = {
    name: "luna-writing",
    model: "gpt-6-luna",
    cases: ["sample", "other"],
    repeats: 2,
    created_at: new Date().toISOString(),
    attempts: [] as string[],
  };
  await writePlan(root, plan);
  assert.equal(
    await nextCase(root, await readPlan(root, "luna-writing")),
    "sample",
  );
  const first = await runner.prepare(sample, runtime("gpt-6-luna"));
  plan.attempts.push(first.id);
  await assert.rejects(nextCase(root, plan), /Run and collect/);
  const folder = join(root, first.id);
  await json(join(folder, "run.json"), { ...first, execution: "completed" });
  await json(join(folder, "evidence.json"), {
    task: { turns: [] },
    calls: [],
    downloads: [],
  });
  await runner.grade(first.id);
  // A graded attempt is settled; awaiting_review would stop the plan.
  assert.equal(await nextCase(root, plan), "other");
  await assert.rejects(writePlan(root, { ...plan, name: "../x" }));
});

test("runs refuse when the API serves a different model than the attempt declares", async (t) => {
  const root = await sandbox(t);
  const runner = new EvalRunner(root, {
    token: "t",
    fetch: (async () =>
      Response.json({ ok: true, orca: "muse-spark-1.3" })) as any,
  });
  const run = await runner.prepare(sample, runtime("gpt-6-luna"));
  const blocked = await runner.run(run.id, "fp");
  assert.equal(blocked.execution, "blocked");
  assert.match(
    blocked.error!,
    /The API runs Orca on muse-spark-1.3, but this attempt declares gpt-6-luna/,
  );
});
