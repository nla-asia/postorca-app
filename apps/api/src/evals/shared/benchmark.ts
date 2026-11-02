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
  /** Git commit the attempt ran on; repeats on one commit form a batch. */
  commit: string;
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
        commit: run.commit,
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

/**
 * Where each model stands now: per model and case, only the latest batch, i.e.
 * the newest attempt and the others on the same commit. Older code's results
 * would otherwise keep counting after fixes land.
 */
export function latestBatch(attempts: BenchmarkAttempt[]) {
  const newest = new Map<string, BenchmarkAttempt>();
  for (const a of attempts) {
    const key = `${a.model}\0${a.case_id}`;
    const seen = newest.get(key);
    if (!seen || a.created_at > seen.created_at) newest.set(key, a);
  }
  return attempts.filter(
    (a) => newest.get(`${a.model}\0${a.case_id}`)!.commit === a.commit,
  );
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
  // Category first: every category over all its levels, with its levels and cases.
  const byCategory = [...new Set(keys.map((k) => k.category))].map(
    (category) => {
      const all = row(category, null, true);
      return {
        ...all,
        levels: rows.filter((r) => r.category === category && r.level),
        cases: cases.filter((c) => c.category === category),
      };
    },
  );
  return {
    grading_policy_version: gradingPolicyVersion,
    minimum_scored: minimumScored,
    models,
    categories: byCategory,
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

const title = (category: string) =>
  `${category[0].toUpperCase()}${category.slice(1)}`;
export const label = (category: string, level: number | null) =>
  `${title(category)}${level ? ` L${level}` : " (all levels)"}`;
const percent = (c: Cell) =>
  c.pass_rate == null
    ? "–"
    : `${Math.round(c.pass_rate * 100)}% (${c.passed}/${c.scored})`;

/** The scoreboard is pass rates only; the JSON keeps the rest. */
export function markdown(b: Benchmark) {
  const head = (first: string) =>
    `| ${first} | ${b.models.join(" | ")} |\n|---|${b.models.map(() => "---|").join("")}`;
  const rate = (c: Cell, lead = false) =>
    lead ? `**${percent(c)}**` : percent(c);
  return [
    "# Model benchmark",
    "",
    head("Category"),
    ...b.categories.map(
      (r) =>
        `| ${title(r.category)} | ${r.cells.map((c) => rate(c, r.leader === c.model)).join(" | ")} |`,
    ),
    `| Overall | ${b.overall.map((c) => rate(c)).join(" | ")} |`,
    "",
    ...b.categories.flatMap((r) => [
      `<details><summary>${title(r.category)}</summary>`,
      "",
      head("Level / case"),
      ...r.levels.map(
        (l) =>
          `| Level ${l.level} | ${l.cells.map((c) => rate(c, l.leader === c.model)).join(" | ")} |`,
      ),
      ...r.cases.map(
        (c) => `| ${c.case_id} | ${c.cells.map((x) => rate(x)).join(" | ")} |`,
      ),
      "",
      "</details>",
      "",
    ]),
  ].join("\n");
}

const escape = (s: string) =>
  s.replace(
    /[&<>"]/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!,
  );
export function html(b: Benchmark) {
  const td = (c: Cell, lead: boolean) =>
    c.pass_rate == null
      ? `<td class="muted">–</td>`
      : `<td class="${lead ? "lead" : ""}"><b>${Math.round(c.pass_rate * 100)}%</b> <span class="muted">${c.passed}/${c.scored}</span></td>`;
  const header = `<thead><tr><th>Category</th>${b.models.map((m) => `<th>${escape(m)}</th>`).join("")}</tr></thead>`;
  const category = (r: Benchmark["categories"][number]) => `<tbody>
<tr class="head"><th><button type="button" aria-expanded="false">${escape(title(r.category))}</button></th>${r.cells.map((c) => td(c, r.leader === c.model)).join("")}</tr>
${r.levels.map((l) => `<tr class="sub"><th>Level ${l.level}</th>${l.cells.map((c) => td(c, l.leader === c.model)).join("")}</tr>`).join("\n")}
${r.cases.map((c) => `<tr class="sub"><th class="case">${escape(c.case_id)}</th>${c.cells.map((x) => td(x, false)).join("")}</tr>`).join("\n")}
</tbody>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Model benchmark</title>
<style>
:root{--bg:#fff;--fg:#1d1d1f;--muted:#6e6e73;--line:#e5e5ea;--sub:#f7f7f9;--lead:#e7f6ec;--leadfg:#0b6b2b}
@media (prefers-color-scheme:dark){:root{--bg:#161618;--fg:#f2f2f7;--muted:#98989f;--line:#2c2c2e;--sub:#1e1e21;--lead:#12301d;--leadfg:#7ee2a0}}
body{margin:0;padding:24px 16px;background:var(--bg);color:var(--fg);font:14px/1.45 -apple-system,system-ui,sans-serif}
main{max-width:900px;margin:0 auto}h1{font-size:22px;margin:0 0 16px}.wrap{overflow-x:auto}
table{border-collapse:collapse;width:100%;min-width:360px}th,td{border-bottom:1px solid var(--line);padding:10px;text-align:left}
thead th{font-weight:600;color:var(--muted);font-size:12px}td b{font-size:16px}.muted{color:var(--muted)}
td.lead{background:var(--lead)}td.lead b{color:var(--leadfg)}
button{all:unset;cursor:pointer;font-weight:600}button::before{content:"▸";display:inline-block;width:1.2em;color:var(--muted);transition:transform .15s}
tbody.open button::before{transform:rotate(90deg)}button:focus-visible{outline:2px solid var(--leadfg);outline-offset:2px}
tr.sub{background:var(--sub)}tr.sub th{font-weight:500;padding-left:calc(10px + 1.2em)}tr.sub th.case{font-size:13px;color:var(--muted)}
tbody:not(.open) tr.sub{display:none}tr.total th{padding-left:calc(10px + 1.2em)}
</style></head><body><main>
<h1>Model benchmark</h1>
<div class="wrap"><table>${header}
${b.categories.map(category).join("\n")}
<tbody><tr class="total"><th>Overall</th>${b.overall.map((c) => td(c, false)).join("")}</tr></tbody>
</table></div>
</main>
<script>
for (const body of document.querySelectorAll("tbody")) {
  const head = body.querySelector("tr.head");
  head?.addEventListener("click", () => {
    const open = body.classList.toggle("open");
    head.querySelector("button").setAttribute("aria-expanded", String(open));
  });
}
</script>
</body></html>
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
