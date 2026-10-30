/**
 * Model benchmark: read-only aggregation of stored attempts by model, category
 * and level. It never regrades or writes into an attempt; a result whose policy
 * or evidence changed since grading is counted as stale, not as a pass or fail.
 */
import { readdir, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { Verdict } from "./contracts.js";
import { gradingPolicyVersion } from "./judge.js";
import { evidenceHash, json, maybeJson, readJson } from "./io.js";
import { EvalRunner } from "./runner.js";

export const categories = [
  "browser",
  "computer",
  "media",
  "writing",
  "ideas",
  "content",
] as const;
export type Cause = "agent" | "infrastructure" | "eval" | "untriaged";
export type Outcome = Verdict | "stale" | "ungraded";
export type BenchmarkAttempt = {
  id: string;
  case_id: string;
  category: string;
  level: 1 | 2 | 3 | null;
  model: string;
  created_at: string;
  outcome: Outcome;
  /** Failed attempts only: who the failure is on. */
  cause: Cause | null;
  elapsed_ms: number | null;
  tool_calls: number | null;
  failed_tool_calls: number | null;
  cost: number | null;
};
export type Cell = {
  model: string;
  category: string;
  level: 1 | 2 | 3 | null;
  attempts: number;
  passed: number;
  failed: Record<Cause, number>;
  blocked: number;
  awaiting_review: number;
  stale: number;
  /** Attempts that count for the model: passes, agent and untriaged failures. */
  scored: number;
  /** passed / scored; eval and infrastructure failures are shown, not counted. */
  pass_rate: number | null;
  /** Current run of passes, newest first, over scored attempts. */
  streak: number;
  median_elapsed_ms: number | null;
  median_tool_calls: number | null;
  median_failed_tool_calls: number | null;
  median_cost: number | null;
};

/**
 * A failure is the agent's when any agent finding covers a failed or blocked
 * check. Otherwise it is infrastructure's or the eval's, and untriaged while a
 * covering finding is unclassified or the triage is missing or stale.
 */
export function failureCause(result: any): Cause {
  if (result.triage?.status !== "recorded") return "untriaged";
  const failing = new Set(
    (result.checks ?? [])
      .filter((c: any) => ["failed", "blocked"].includes(c.verdict))
      .map((c: any) => c.id),
  );
  const sides = new Set<string>(
    (result.triage.findings ?? [])
      .filter((f: any) => f.check_ids.some((id: string) => failing.has(id)))
      .map((f: any) => f.side),
  );
  if (sides.has("agent")) return "agent";
  if (!sides.size || sides.has("unclassified")) return "untriaged";
  if (sides.has("infrastructure")) return "infrastructure";
  return "eval";
}

/** Reads every executed attempt; prepared-only attempts are left out. */
export async function loadAttempts(root: string) {
  const runner = new EvalRunner(root);
  const attempts: BenchmarkAttempt[] = [];
  const skipped: { id: string; reason: string }[] = [];
  await mkdir(root, { recursive: true });
  for (const d of await readdir(root, { withFileTypes: true })) {
    if (!d.isDirectory() || !(await maybeJson(join(root, d.name, "run.json"))))
      continue;
    try {
      const { folder, run, entry } = await runner.load(d.name);
      if (run.execution === "prepared") continue;
      const result = await maybeJson(join(folder, "result.json"));
      const evidence = await maybeJson(join(folder, "evidence.json"));
      const stale =
        result &&
        ((result.grading_policy_version ?? 1) !== gradingPolicyVersion ||
          result.case_hash !== run.case_hash ||
          (evidence ? await evidenceHash(folder) : null) !==
            result.evidence_hash);
      const outcome: Outcome = !result
        ? "ungraded"
        : stale
          ? "stale"
          : result.verdict;
      attempts.push({
        id: run.id,
        case_id: run.case_id,
        category: entry.plugin,
        level: entry.level ?? null,
        model: run.model,
        created_at: run.created_at,
        outcome,
        cause: outcome === "failed" ? failureCause(result) : null,
        elapsed_ms: result?.metrics?.elapsed_ms ?? null,
        tool_calls: result?.metrics?.tool_calls ?? null,
        failed_tool_calls: result?.metrics?.failed_tool_calls ?? null,
        cost: result?.metrics?.cost ?? null,
      });
    } catch (e) {
      skipped.push({ id: d.name, reason: (e as Error).message });
    }
  }
  attempts.sort((a, b) => a.created_at.localeCompare(b.created_at));
  return { attempts, skipped };
}

export function median(values: (number | null)[]) {
  const v = values.filter((x): x is number => x != null).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}
const scored = (a: BenchmarkAttempt) =>
  a.outcome === "passed" ||
  (a.outcome === "failed" && (a.cause === "agent" || a.cause === "untriaged"));

export function cell(
  model: string,
  category: string,
  level: 1 | 2 | 3 | null,
  attempts: BenchmarkAttempt[],
): Cell {
  const failed = { agent: 0, infrastructure: 0, eval: 0, untriaged: 0 };
  for (const a of attempts) if (a.outcome === "failed") failed[a.cause!]++;
  const counted = attempts.filter(scored);
  const passed = attempts.filter((a) => a.outcome === "passed").length;
  let streak = 0;
  for (const a of [...counted].reverse()) {
    if (a.outcome !== "passed") break;
    streak++;
  }
  // Time and tool use are compared over finished, graded work only.
  const graded = attempts.filter((a) =>
    ["passed", "failed"].includes(a.outcome),
  );
  return {
    model,
    category,
    level,
    attempts: attempts.length,
    passed,
    failed,
    blocked: attempts.filter((a) => a.outcome === "blocked").length,
    awaiting_review: attempts.filter((a) => a.outcome === "awaiting_review")
      .length,
    stale: attempts.filter((a) => ["stale", "ungraded"].includes(a.outcome))
      .length,
    scored: counted.length,
    pass_rate: counted.length ? passed / counted.length : null,
    streak,
    median_elapsed_ms: median(graded.map((a) => a.elapsed_ms)),
    median_tool_calls: median(graded.map((a) => a.tool_calls)),
    median_failed_tool_calls: median(graded.map((a) => a.failed_tool_calls)),
    median_cost: median(graded.map((a) => a.cost)),
  };
}

export type Row = {
  category: string;
  /** null: every level of the category. */
  level: 1 | 2 | 3 | null;
  cells: Cell[];
  /** The model with the best pass rate, when the gap is clear and both have enough attempts. */
  leader: string | null;
};
const order = (category: string) => {
  const i = categories.indexOf(category as any);
  return i < 0 ? categories.length : i;
};

/** Below this many scored attempts a cell is shown but never called stronger. */
export const minimumScored = 3;
export function leader(cells: Cell[]) {
  const ranked = cells
    .filter((c) => c.scored >= minimumScored && c.pass_rate != null)
    .sort((a, b) => b.pass_rate! - a.pass_rate!);
  if (ranked.length < 2 || ranked[0].pass_rate === ranked[1].pass_rate)
    return null;
  return ranked[0].model;
}

export function benchmark(attempts: BenchmarkAttempt[]) {
  const models = [...new Set(attempts.map((a) => a.model))].sort();
  const keys = [
    ...new Set(attempts.map((a) => `${a.category}\0${a.level ?? ""}`)),
  ]
    .map((k) => {
      const [category, level] = k.split("\0");
      return { category, level: level ? (Number(level) as 1 | 2 | 3) : null };
    })
    .sort(
      (a, b) =>
        order(a.category) - order(b.category) ||
        a.category.localeCompare(b.category) ||
        (a.level ?? 0) - (b.level ?? 0),
    );
  const row = (category: string, level: 1 | 2 | 3 | null, all: boolean) => {
    const cells = models.map((m) =>
      cell(
        m,
        category,
        level,
        attempts.filter(
          (a) =>
            a.model === m &&
            a.category === category &&
            (all || a.level === level),
        ),
      ),
    );
    return { category, level, cells, leader: leader(cells) };
  };
  const rows: Row[] = [];
  for (const [i, k] of keys.entries()) {
    rows.push(row(k.category, k.level, false));
    const last = keys[i + 1]?.category !== k.category;
    const levels = keys.filter((x) => x.category === k.category).length;
    if (last && levels > 1) rows.push(row(k.category, null, true));
  }
  const cases = [...new Set(attempts.map((a) => a.case_id))]
    .sort()
    .map((id) => {
      const of = attempts.filter((a) => a.case_id === id);
      return {
        case_id: id,
        category: of[0].category,
        level: of[0].level,
        cells: models.map((m) =>
          cell(
            m,
            of[0].category,
            of[0].level,
            of.filter((a) => a.model === m),
          ),
        ),
      };
    });
  return {
    grading_policy_version: gradingPolicyVersion,
    minimum_scored: minimumScored,
    models,
    overall: models.map((m) =>
      cell(
        m,
        "all",
        null,
        attempts.filter((a) => a.model === m),
      ),
    ),
    rows,
    cases,
    strengths: models.map((m) => ({
      model: m,
      leads: rows
        .filter((r) => r.leader === m)
        .map((r) => label(r.category, r.level)),
    })),
  };
}
export type Benchmark = ReturnType<typeof benchmark>;

export const label = (category: string, level: number | null) =>
  `${category[0].toUpperCase()}${category.slice(1)}${level ? ` L${level}` : " (all levels)"}`;
const percent = (c: Cell) =>
  c.pass_rate == null
    ? "–"
    : `${Math.round(c.pass_rate * 100)}% (${c.passed}/${c.scored})`;
const minutes = (ms: number | null) =>
  ms == null ? "–" : `${(ms / 60_000).toFixed(1)} min`;
const number = (n: number | null) => (n == null ? "–" : String(n));
const excluded = (c: Cell) =>
  [
    c.failed.eval && `${c.failed.eval} eval`,
    c.failed.infrastructure && `${c.failed.infrastructure} infra`,
    c.blocked && `${c.blocked} blocked`,
    c.awaiting_review && `${c.awaiting_review} unreviewed`,
    c.stale && `${c.stale} stale`,
  ]
    .filter(Boolean)
    .join(", ") || "–";
const summary = (c: Cell) =>
  c.attempts
    ? `${percent(c)} · streak ${c.streak} · ${minutes(c.median_elapsed_ms)} · ${number(c.median_tool_calls)} calls`
    : "–";

export function markdown(b: Benchmark) {
  const head = (first: string) =>
    `| ${first} | ${b.models.join(" | ")} |\n|---|${b.models.map(() => "---|").join("")}`;
  const lines = [
    "# Model benchmark",
    "",
    `Pass rate counts passes, agent failures and untriaged failures. Eval-defect and infrastructure failures, blocked, unreviewed and stale attempts are listed but not counted. A model leads a row with at least ${b.minimum_scored} scored attempts and a strictly higher pass rate (**bold**). Cells: pass rate · current streak · median time · median tool calls.`,
    "",
    head("Category"),
    ...b.rows.map(
      (r) =>
        `| ${label(r.category, r.level)} | ${r.cells
          .map((c) => (r.leader === c.model ? `**${summary(c)}**` : summary(c)))
          .join(" | ")} |`,
    ),
    `| Overall | ${b.overall.map(summary).join(" | ")} |`,
    "",
    "## Failures by root cause",
    "",
    head("Model"),
    ...["agent", "untriaged", "infrastructure", "eval"].map(
      (cause) =>
        `| ${cause} | ${b.overall.map((c) => c.failed[cause as Cause]).join(" | ")} |`,
    ),
    "",
    "## Where each model is stronger",
    "",
    ...b.strengths.map(
      (s) =>
        `- **${s.model}**: ${s.leads.length ? s.leads.join(", ") : "no clear lead yet"}`,
    ),
    "",
    "## Cases",
    "",
    head("Case"),
    ...b.cases.map(
      (c) =>
        `| ${c.case_id} (${label(c.category, c.level)}) | ${c.cells
          .map((x) =>
            x.attempts ? `${percent(x)}; not counted: ${excluded(x)}` : "–",
          )
          .join(" | ")} |`,
    ),
    "",
  ];
  return lines.join("\n");
}

const escape = (s: string) =>
  s.replace(
    /[&<>"]/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!,
  );
export function html(b: Benchmark, generatedAt = new Date().toISOString()) {
  const td = (c: Cell, lead: boolean) =>
    c.attempts
      ? `<td class="${lead ? "lead" : ""}"><b>${escape(percent(c))}</b><small>streak ${c.streak} · ${minutes(c.median_elapsed_ms)} · ${number(c.median_tool_calls)} calls</small><small class="muted">not counted: ${escape(excluded(c))}</small></td>`
      : `<td class="muted">–</td>`;
  const header = (first: string) =>
    `<tr><th>${first}</th>${b.models.map((m) => `<th>${escape(m)}</th>`).join("")}</tr>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Model benchmark</title>
<style>
:root{--bg:#fff;--fg:#1d1d1f;--muted:#6e6e73;--line:#e5e5ea;--lead:#e7f6ec;--leadfg:#0b6b2b}
@media (prefers-color-scheme:dark){:root{--bg:#161618;--fg:#f2f2f7;--muted:#98989f;--line:#2c2c2e;--lead:#12301d;--leadfg:#7ee2a0}}
body{margin:0;padding:24px 16px;background:var(--bg);color:var(--fg);font:14px/1.45 -apple-system,system-ui,sans-serif}
main{max-width:1100px;margin:0 auto}h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:28px 0 8px}
p{color:var(--muted);max-width:760px}.wrap{overflow-x:auto}
table{border-collapse:collapse;width:100%;min-width:480px}th,td{border-bottom:1px solid var(--line);padding:8px 10px;text-align:left;vertical-align:top}
th{font-weight:600}td small{display:block;font-size:12px}.muted{color:var(--muted)}
td.lead{background:var(--lead)}td.lead b{color:var(--leadfg)}tr.all th{font-style:italic}
</style></head><body><main>
<h1>Model benchmark</h1>
<p>Generated ${escape(generatedAt)} from stored eval attempts (grading policy ${b.grading_policy_version}). Pass rate counts passes, agent failures and untriaged failures; eval-defect and infrastructure failures, blocked, unreviewed and stale attempts are shown but not counted. A highlighted cell leads its row: at least ${b.minimum_scored} scored attempts and a strictly higher pass rate. Times and tool calls are medians over graded attempts.</p>
<div class="wrap"><table>${header("Category")}
${b.rows.map((r) => `<tr class="${r.level ? "" : "all"}"><th>${escape(label(r.category, r.level))}</th>${r.cells.map((c) => td(c, r.leader === c.model)).join("")}</tr>`).join("\n")}
<tr class="all"><th>Overall</th>${b.overall.map((c) => td(c, false)).join("")}</tr>
</table></div>
<h2>Where each model is stronger</h2>
<ul>${b.strengths.map((s) => `<li><b>${escape(s.model)}</b>: ${s.leads.length ? escape(s.leads.join(", ")) : "no clear lead yet"}</li>`).join("")}</ul>
<h2>Failures by root cause</h2>
<div class="wrap"><table>${header("Cause")}
${(["agent", "untriaged", "infrastructure", "eval"] as Cause[]).map((cause) => `<tr><th>${cause}</th>${b.overall.map((c) => `<td>${c.failed[cause]}</td>`).join("")}</tr>`).join("\n")}
</table></div>
<h2>Cases</h2>
<div class="wrap"><table>${header("Case")}
${b.cases.map((c) => `<tr><th>${escape(c.case_id)}<small class="muted">${escape(label(c.category, c.level))}</small></th>${c.cells.map((x) => td(x, false)).join("")}</tr>`).join("\n")}
</table></div>
</main></body></html>
`;
}

/** A plan runs the same cases on one model a fixed number of times, one attempt at a time. */
export const planSchema = z
  .object({
    name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    model: z.string().min(1),
    cases: z.array(z.string().min(1)).min(1),
    repeats: z.number().int().positive().max(20),
    created_at: z.string(),
    attempts: z.array(z.string()).default([]),
  })
  .strict();
export type Plan = z.infer<typeof planSchema>;
export const planFile = (root: string, name: string) => {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name))
    throw new Error("Plan names are lowercase letters, digits and dashes");
  return join(root, "benchmarks", `${name}.json`);
};
export async function readPlan(root: string, name: string) {
  return planSchema.parse(await readJson(planFile(root, name)));
}
export async function writePlan(root: string, plan: Plan) {
  await json(planFile(root, plan.name), planSchema.parse(plan));
}

/**
 * The next case to prepare, or null when every case has its repeats. The previous
 * attempt must be graded and reviewed first: paid runs are never chained unseen.
 */
export async function nextCase(root: string, plan: Plan) {
  const runner = new EvalRunner(root);
  const counts = new Map(plan.cases.map((c) => [c, 0]));
  for (const id of plan.attempts) {
    const { run, folder } = await runner.load(id);
    counts.set(run.case_id, (counts.get(run.case_id) ?? 0) + 1);
    const result = await maybeJson(join(folder, "result.json"));
    if (!result || run.execution === "prepared" || run.execution === "running")
      throw new Error(
        `Run and collect ${id} before preparing the next attempt`,
      );
    if (result.verdict === "awaiting_review")
      throw new Error(`Review ${id} before preparing the next attempt`);
  }
  for (let round = 0; round < plan.repeats; round++)
    for (const c of plan.cases) if (counts.get(c)! <= round) return c;
  return null;
}
