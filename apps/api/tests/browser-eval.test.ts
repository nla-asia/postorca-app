import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  browserCase,
  browserCases,
  observedCaseIds,
  preparedCase,
  rollingWindow,
} from "../src/evals/browser-cases.js";
import {
  browserDiagnostics,
  type DiagnosedTurn,
} from "../src/evals/browser-diagnostics.js";

const apiRoot = fileURLToPath(new URL("../", import.meta.url));

test("the browser case catalog has distinct cases with reviewer-only bullet criteria", () => {
  assert.equal(browserCases.length, 6);
  assert.equal(new Set(browserCases.map((entry) => entry.id)).size, 6);
  for (const entry of browserCases) {
    assert.ok(entry.name && entry.brief, entry.id);
    const lines = entry.success_criteria.split("\n");
    assert.ok(lines.length >= 3, entry.id);
    for (const line of lines) assert.match(line, /^- \S/, entry.id);
    assert.doesNotMatch(
      `${entry.name}\n${entry.brief}\n${entry.success_criteria}`,
      /\bAsia\b|\bPBA\b/,
      entry.id,
    );
  }
  assert.equal(browserCase("conversations").name, "Research conversations worth joining");
  assert.throws(() => browserCase("shopping"), /Unknown browser eval: shopping/);
});

test("observed cases fill every brief placeholder with a rolling window", () => {
  const now = new Date("2026-10-27T03:00:00.000Z");
  const posts = preparedCase("x-post-research", now);
  assert.match(posts.brief, /from the past seven days about Claude Code\./);
  assert.deepEqual(
    { start: posts.parameters.window_start, end: posts.parameters.window_end },
    { start: "2026-10-20T03:00:00.000Z", end: "2026-10-27T03:00:00.000Z" },
  );
  for (const id of observedCaseIds)
    assert.doesNotMatch(preparedCase(id, now).brief, /\[[^\]]+\]/, id);
  // Catalog cases without an observer, or with unfilled placeholders, are refused.
  assert.throws(() => preparedCase("conversations", now), /conversations has no observer/);
  assert.deepEqual(rollingWindow("2026-10-27T10:00:00.000Z"), {
    window_start: "2026-10-20T10:00:00.000Z",
    window_end: "2026-10-27T10:00:00.000Z",
  });
});

/** A turn with two overlapping calls, an error, a no-change snapshot part and a call without a result. */
function sampleTurn(status = "completed"): DiagnosedTurn {
  const at = (seconds: number) =>
    new Date(Date.parse("2026-10-27T03:00:00.000Z") + seconds * 1000).toISOString();
  const message = (id: string, kind: string, seconds: number, content: unknown) => ({
    id,
    kind,
    created_at: at(seconds),
    content,
  });
  const callTo = (callId: string, name: string, args: object) => ({
    callId,
    name,
    arguments: JSON.stringify(args),
  });
  return {
    id: "turn-1",
    status,
    started_at: at(0),
    finished_at: status === "completed" ? at(30) : null,
    messages: [
      message("m1", "user", 0, { text: "Find flights" }),
      message("m2", "assistant", 1, { text: "" }),
      message("m3", "tool_call", 2, callTo("c1", "browser_open", { url: "https://example.com" })),
      message("m4", "tool_call", 3, callTo("c2", "browser_snapshot", { tab: "t1", part: 2 })),
      message("m5", "tool_result", 6, { callId: "c1", result: { tab: "t1" } }),
      message("m6", "tool_result", 7, {
        callId: "c2",
        result: { observation: "t1:2", part: 2, changes: "No changes since t1:1." },
      }),
      message("m7", "assistant", 10, { text: "" }),
      message("m8", "tool_call", 11, callTo("c3", "browser_click", { tab: "t1", ref: "e9" })),
      message("m9", "tool_result", 12, { callId: "c3", result: { error: "Ref e9 is gone." } }),
      message("m10", "tool_call", 13, callTo("c4", "browser_close", { tab: "t1" })),
      message("m11", "assistant", 20, { text: "Done." }),
    ],
  };
}

test("diagnostics measure calls, errors, overlapping tool time and reviews", () => {
  const result = browserDiagnostics(sampleTurn(), [
    { call_id: "c1", classification: "useful", reasoning: "Opened the site." },
    { call_id: "c3", classification: "failed", reasoning: "Stale ref." },
  ]);
  const measured = result.measured;
  assert.equal(measured.wall_seconds, 30);
  assert.equal(measured.model_responses, 3);
  assert.equal(measured.tool_calls, 4);
  assert.equal(measured.successful_tool_calls, 2);
  assert.equal(measured.error_tool_calls, 1);
  assert.equal(measured.error_rate, 0.25);
  assert.equal(measured.missing_results, 1);
  assert.equal(measured.pending_calls, 0);
  // c1 2–6 s and c2 3–7 s overlap (5 s together), plus c3 11–12 s.
  assert.equal(measured.tool_interval_union_seconds, 6);
  assert.equal(measured.outside_tool_intervals_seconds, 24);
  assert.equal(measured.no_change_responses, 1);
  assert.equal(measured.snapshot_calls, 1);
  assert.equal(measured.multipart_reads, 1);
  assert.deepEqual(measured.by_tool.browser_click, {
    calls: 1,
    errors: 1,
    observed_seconds_sum: 1,
  });
  assert.deepEqual(
    result.calls.map((call) => [call.call_id, call.execution_status, call.model_response]),
    [
      ["c1", "success", 1],
      ["c2", "success", 1],
      ["c3", "error", 2],
      ["c4", "missing_result", 2],
    ],
  );
  assert.equal(result.calls[2].error, "Ref e9 is gone.");
  assert.deepEqual(result.reviewer_assessment.counts, {
    useful: 1,
    avoidable: 0,
    low_yield: 0,
    failed: 1,
  });
  assert.equal(result.reviewer_assessment.unreviewed_calls, 2);
  assert.deepEqual(result.reviewer_assessment.observed_seconds_by_classification, {
    useful: 4,
    avoidable: 0,
    low_yield: 0,
    failed: 1,
  });

  // Unreviewed runs leave reviewer counts unknown; a running turn's last call is pending.
  const running = browserDiagnostics(sampleTurn("running"));
  assert.equal(running.measured.wall_seconds, null);
  assert.equal(running.measured.pending_calls, 1);
  assert.equal(running.measured.missing_results, 0);
  assert.equal(running.reviewer_assessment.counts.useful, null);

  assert.throws(
    () =>
      browserDiagnostics(sampleTurn(), [
        { call_id: "c1", classification: "useful", reasoning: "" },
        { call_id: "c1", classification: "avoidable", reasoning: "" },
      ]),
    /Duplicate efficiency review call IDs/,
  );
  assert.throws(
    () =>
      browserDiagnostics(sampleTurn(), [
        { call_id: "c9", classification: "useful", reasoning: "" },
      ]),
    /unknown call c9/,
  );
});

test("the observer's diagnose mode works offline from a run folder", async () => {
  const folder = await mkdtemp(join(tmpdir(), "postorca-browser-eval-"));
  try {
    const turn = sampleTurn();
    await writeFile(
      join(folder, "run.json"),
      JSON.stringify({ case_id: "x-post-research", task_id: "missing-task", turn_id: turn.id }),
    );
    await writeFile(
      join(folder, "evidence.json"),
      JSON.stringify({ id: "missing-task", turns: [turn] }),
    );
    await writeFile(
      join(folder, "call-review.json"),
      JSON.stringify([{ call_id: "c4", classification: "avoidable", reasoning: "Never answered." }]),
    );
    const script = join(apiRoot, "src/scripts/browser-eval.ts");
    const run = (...args: string[]) =>
      spawnSync(process.execPath, ["--import", "tsx", script, ...args], {
        cwd: apiRoot,
        encoding: "utf8",
        env: { ...process.env, INIT_CWD: apiRoot },
      });
    const diagnosed = run("diagnose", folder);
    assert.equal(diagnosed.status, 0, diagnosed.stderr);
    const saved = JSON.parse(await readFile(join(folder, "diagnostics.json"), "utf8"));
    assert.equal(saved.case_id, "x-post-research");
    assert.equal(saved.measured.tool_calls, 4);
    assert.equal(saved.reviewer_assessment.counts.avoidable, 1);
    // No local traces for this task: usage is unknown rather than zero.
    assert.equal(saved.usage, null);

    const wrong = run("launch");
    assert.notEqual(wrong.status, 0);
    assert.match(wrong.stderr, /Use prepare x-post-research /);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
