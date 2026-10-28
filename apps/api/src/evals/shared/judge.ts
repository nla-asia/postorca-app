// Adapted from Autopilot's programmatic_judge.ts assertion contract. Pure evidence
// input replaces its MessageRepository; budgets never conflate turns and calls.
import { isDeepStrictEqual } from "node:util";
import type { Call, Check, EvalCase, Verdict } from "./contracts.js";

export function pathValue(source: any, path: string): any {
  return path
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .reduce(
      (v, key) => (v != null && Object.hasOwn(v, key) ? v[key] : undefined),
      source,
    );
}
export function matches(actual: any, rule: any): boolean {
  if (!rule || typeof rule !== "object" || !("operator" in rule))
    return isDeepStrictEqual(actual, rule);
  const value = rule.value;
  const text =
    actual != null && typeof actual === "object"
      ? JSON.stringify(actual)
      : String(actual ?? "");
  switch (rule.operator) {
    case "equals":
      return isDeepStrictEqual(actual, value);
    case "exists":
      return actual !== undefined && actual !== null;
    case "contains":
      return actual != null && text.includes(String(value));
    case "starts_with":
      return actual != null && text.startsWith(String(value));
    case "regex":
      return actual != null && new RegExp(String(value)).test(text);
    case "includes_any":
      return (Array.isArray(value) ? value : [value]).some((v) =>
        Array.isArray(actual)
          ? actual.some((a) => isDeepStrictEqual(a, v))
          : actual != null && text.includes(String(v)),
      );
    case "array_min_length":
      return Array.isArray(actual) && actual.length >= Number(value);
    case "min":
      return typeof actual === "number" && actual >= Number(value);
    default:
      throw new Error(`Unknown matcher ${rule.operator}`);
  }
}
function objectMatches(actual: any, rules: any = {}) {
  return Object.entries(rules).every(([path, rule]) =>
    matches(pathValue(actual, path), rule),
  );
}
function matching(calls: Call[], a: any, forbidden = false) {
  return calls.filter(
    (c) =>
      c.name === a.tool_name &&
      (forbidden || a.require_success === false || !c.failed) &&
      objectMatches(c.args, a.args) &&
      objectMatches(c.result, a.result),
  );
}
function satisfied(calls: Call[], a: any) {
  const n = matching(calls, a).length;
  return (
    n >= (a.min_count ?? 1) && (a.max_count === undefined || n <= a.max_count)
  );
}
export function trajectoryChecks(entry: EvalCase, calls: Call[]): Check[] {
  const checks: Check[] = [];
  const add = (id: string, pass: boolean, reason: string) =>
    checks.push({
      id,
      verdict: pass ? "passed" : "failed",
      reason,
      evidence: ["evidence.json#/calls"],
    });
  const a = entry.trajectory;
  a.required_tool_calls.forEach((r, i) =>
    add(
      `required-${i}`,
      satisfied(calls, r),
      `${r.label ?? r.tool_name}: ${matching(calls, r).length} matching calls; minimum ${r.min_count ?? 1}, maximum ${r.max_count ?? "unbounded"}`,
    ),
  );
  a.required_any_tool_calls.forEach((r, i) =>
    add(
      `alternative-${i}`,
      r.alternatives.some((v) => satisfied(calls, v)),
      r.label,
    ),
  );
  a.forbidden_tool_calls.forEach((r, i) =>
    add(
      `forbidden-${i}`,
      !matching(calls, r, true).length,
      `${r.label ?? r.tool_name}: ${matching(calls, r, true).length} forbidden attempts`,
    ),
  );
  if (a.max_tool_calls !== undefined)
    add(
      "tool-budget",
      calls.length <= a.max_tool_calls,
      `${calls.length}/${a.max_tool_calls} tool calls`,
    );
  if (a.max_failed_tool_calls !== undefined)
    add(
      "tool-errors",
      calls.filter((c) => c.failed).length <= a.max_failed_tool_calls,
      `${calls.filter((c) => c.failed).length}/${a.max_failed_tool_calls} failed calls`,
    );
  return checks;
}
export function aggregate(checks: Check[]): Verdict {
  if (checks.some((c) => c.verdict === "failed")) return "failed";
  if (checks.some((c) => c.verdict === "blocked")) return "blocked";
  if (!checks.length || checks.some((c) => c.verdict === "awaiting_review"))
    return "awaiting_review";
  return "passed";
}
export function normalizeCalls(task: any): Call[] {
  return (task.turns ?? []).flatMap((turn: any) => {
    const results = new Map(
      (turn.messages ?? [])
        .filter((m: any) => m.kind === "tool_result")
        .map((m: any) => [m.content.callId, m.content.result]),
    );
    return (turn.messages ?? [])
      .filter((m: any) => m.kind === "tool_call")
      .map((m: any) => {
        let args = m.content.arguments ?? {};
        let malformed = false;
        try {
          if (typeof args === "string") args = JSON.parse(args);
        } catch {
          malformed = true;
        }
        const result: any = results.get(m.content.callId);
        return {
          id: m.content.callId,
          turn_id: turn.id,
          name: m.content.name,
          args,
          result: result ?? null,
          failed: malformed || result == null || result.error !== undefined,
        };
      });
  });
}
