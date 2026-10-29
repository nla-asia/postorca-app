import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { builtinCases, renderParameters } from "../src/evals/shared/catalog.js";
import { caseSchema, type EvalCase } from "../src/evals/shared/contracts.js";
import {
  matches,
  normalizeCalls,
  trajectoryChecks,
  aggregate,
} from "../src/evals/shared/judge.js";
import {
  json,
  readJson,
  sha,
  evidenceHash,
  checkReferences,
} from "../src/evals/shared/io.js";
import { EvalRunner } from "../src/evals/shared/runner.js";

const runtime = {
  model: "fixture-model",
  platform: process.platform,
  commit: "abc",
  dirty: "",
  fingerprint: "runtime-one",
};
function entry(overrides: Record<string, unknown> = {}): EvalCase {
  return caseSchema.parse({
    id: "sample",
    plugin: "browser",
    title: "Research a subject",
    turns: [{ brief: "Find the information and save it." }],
    criteria: [{ id: "quality", text: "The saved answer is accurate." }],
    ...overrides,
  });
}
async function sandbox(t: any) {
  const path = await mkdtemp(join(tmpdir(), "postorca-shared-evals-"));
  t.after(async () => {
    assert.ok(
      resolve(path).startsWith(
        resolve(tmpdir()) + (process.platform === "win32" ? "\\" : "/"),
      ),
    );
    await rm(path, { recursive: true, force: true });
  });
  return path;
}
function fakeApi(
  options: {
    loseTurn?: boolean;
    loseTask?: boolean;
    error?: boolean;
    active?: boolean;
  } = {},
) {
  const task: any = {
    id: "task-1",
    title: "Research a subject",
    kind: "work",
    turns: [],
  };
  const mutations: string[] = [];
  const f = async (url: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    if (init?.method === "POST") {
      mutations.push(path);
      if (path === "/api/tasks") {
        if (options.loseTask) throw new Error("Lost task response");
        return Response.json(task);
      }
      if (path.endsWith("/turns")) {
        const body = JSON.parse(String(init.body));
        task.turns.push({
          id: `turn-${task.turns.length + 1}`,
          status: options.active ? "running" : "completed",
          artifacts: [],
          messages: [
            { kind: "user", content: { text: body.message } },
            {
              kind: "tool_call",
              content: {
                callId: "call-1",
                name: "browser_snapshot",
                arguments: "{}",
              },
            },
            {
              kind: "tool_result",
              content: {
                callId: "call-1",
                result: options.error
                  ? { error: "Tool rejected arguments" }
                  : { text: "Verified content" },
              },
            },
            { kind: "assistant", content: { text: "The saved answer." } },
          ],
        });
        if (options.loseTurn) {
          options.loseTurn = false;
          throw new Error("Lost turn response");
        }
        return Response.json(task.turns.at(-1));
      }
    }
    if (path.endsWith("/health")) return Response.json({ ok: true });
    if (path === "/api/tasks") return Response.json([]);
    if (path === "/api/tasks/task-1") return Response.json(task);
    return new Response("Missing", { status: 404 });
  };
  return { fetch: f as typeof fetch, task, mutations };
}
async function reviewed(runner: EvalRunner, id: string) {
  const result = await runner.grade(id);
  return runner.review(id, {
    reviewer: "Independent observer",
    case_hash: result.case_hash,
    evidence_hash: result.evidence_hash,
    criteria: result.review_required.map((c) => ({
      id: c.id,
      verdict: "passed",
      reason: "Inspected the retained task output against this criterion.",
      evidence: ["evidence.json#/task/turns/0/messages"],
    })),
  });
}

test("all 31 cases share the catalog, browser cases have no execution allowlist", () => {
  const cases = builtinCases();
  assert.equal(cases.length, 31);
  assert.equal(cases.filter((c) => c.plugin === "browser").length, 7);
  assert.equal(new Set(cases.map((c) => c.id)).size, cases.length);
  assert.throws(
    () =>
      renderParameters(
        cases.find((c) => c.id === "browser-threads-post-research")!,
        {},
      ),
    /Missing brief/,
  );
  assert.match(
    renderParameters(
      cases.find((c) => c.id === "browser-threads-post-research")!,
      { "topic or product": "Claude Code" },
    ).turns[0].brief,
    /Claude Code/,
  );
  assert.ok(!cases.some((c) => c.id === "video-B7"), "story reels wait for the Content redesign");
  const count = (key: (c: any) => unknown) =>
    Object.fromEntries(
      [...new Set(cases.map(key))].map((k) => [k, cases.filter((c) => key(c) === k).length]),
    );
  assert.deepEqual(count((c) => c.plugin), {
    browser: 7,
    computer: 8,
    content: 3,
    ideas: 3,
    media: 6,
    writing: 4,
  });
  assert.ok(cases.every((c) => c.level), "every case has a level");
  assert.deepEqual(count((c) => `${c.plugin}-${c.level}`), {
    "browser-1": 1,
    "browser-2": 6,
    "computer-1": 4,
    "computer-2": 4,
    "content-3": 3,
    "ideas-3": 3,
    "media-1": 1,
    "media-2": 5,
    "writing-1": 1,
    "writing-2": 3,
  });
  assert.equal(cases.find((c) => c.id === "video-F3")!.plugin, "media");
  for (const c of cases.filter((c) => c.plugin === "content"))
    assert.ok(c.turns[0].video_case && c.prerequisites.includes("media_providers_ready"), c.id);
});
test("assertions distinguish attempts, successes, dotted results and missing results", () => {
  const calls = normalizeCalls({
    turns: [
      {
        id: "a",
        messages: [
          {
            kind: "tool_call",
            content: { callId: "x", name: "click", arguments: '{"tab":"t1"}' },
          },
          {
            kind: "tool_result",
            content: {
              callId: "x",
              result: { error: "Rejected", rows: [{ total: 7 }] },
            },
          },
          {
            kind: "tool_call",
            content: { callId: "y", name: "observe", arguments: "bad json" },
          },
        ],
      },
    ],
  });
  const checks = trajectoryChecks(
    entry({
      trajectory: {
        required_tool_calls: [
          { tool_name: "click", result: { "rows[0].total": 7 } },
        ],
        forbidden_tool_calls: [{ tool_name: "click", args: { tab: "t1" } }],
        max_failed_tool_calls: 0,
      },
    }),
    calls,
  );
  assert.deepEqual(
    checks.map((c) => c.verdict),
    ["failed", "failed", "failed"],
  );
  assert.equal(calls[1].failed, true);
  assert.equal(
    matches({ b: 2, a: 1 }, { operator: "equals", value: { a: 1, b: 2 } }),
    true,
  );
  assert.equal(matches(undefined, { operator: "exists" }), false);
  assert.throws(() => matches("abc", { operator: "regex", value: "[" }));
  assert.equal(
    aggregate([
      {
        id: "x",
        verdict: "awaiting_review",
        reason: "Pending",
        evidence: ["case.json"],
      },
    ]),
    "awaiting_review",
  );
});
test("end-to-end external lifecycle, mandatory review, and evidence invalidation", async (t) => {
  const root = await sandbox(t);
  const api = fakeApi();
  const runner = new EvalRunner(root, {
    token: "private-test-token",
    fetch: api.fetch,
  });
  const run = await runner.prepare(entry(), runtime);
  await runner.run(run.id, runtime.fingerprint);
  assert.equal((await runner.grade(run.id)).verdict, "awaiting_review");
  assert.equal((await reviewed(runner, run.id)).verdict, "passed");
  const folder = runner.folder(run.id);
  assert.ok(
    !(await readFile(join(folder, "run.json"), "utf8")).includes(
      "private-test-token",
    ),
  );
  await writeFile(
    join(folder, "evidence", "new-observation.txt"),
    "Additional facts",
  );
  assert.equal((await runner.grade(run.id)).verdict, "awaiting_review");
  assert.equal((await runner.report()).groups[0].passed, 0);
  assert.equal(api.mutations.length, 2);
});
test("a lost turn response resumes without submitting a second paid turn", async (t) => {
  const root = await sandbox(t);
  const api = fakeApi({ loseTurn: true });
  const runner = new EvalRunner(root, { token: "token", fetch: api.fetch });
  const run = await runner.prepare(entry(), runtime);
  await assert.rejects(
    runner.run(run.id, runtime.fingerprint),
    /Lost turn response/,
  );
  const second = await runner.prepare(entry(), runtime);
  await assert.rejects(
    runner.run(second.id, runtime.fingerprint),
    /still owns/,
  );
  await runner.run(run.id, runtime.fingerprint);
  assert.equal(api.mutations.filter((p) => p.endsWith("/turns")).length, 1);
});
test("unknown task creation cannot create another task and supports explicit reconciliation", async (t) => {
  const root = await sandbox(t);
  const api = fakeApi({ loseTask: true });
  const runner = new EvalRunner(root, { token: "token", fetch: api.fetch });
  const run = await runner.prepare(entry(), runtime);
  await assert.rejects(
    runner.run(run.id, runtime.fingerprint),
    /Lost task response/,
  );
  await assert.rejects(
    runner.run(run.id, runtime.fingerprint),
    /creation outcome is unknown/,
  );
  await runner.reconcileTask(run.id, api.task.id);
  await runner.run(run.id, runtime.fingerprint);
  assert.equal(api.mutations.filter((p) => p === "/api/tasks").length, 1);
});
test("tool failure stops follow-ups and semantic acceptance cannot override it", async (t) => {
  const root = await sandbox(t);
  const api = fakeApi({ error: true });
  const runner = new EvalRunner(root, { token: "token", fetch: api.fetch });
  const run = await runner.prepare(
    entry({ turns: [{ brief: "Create it." }, { brief: "Revise it." }] }),
    runtime,
  );
  await runner.run(run.id, runtime.fingerprint);
  assert.equal((await reviewed(runner, run.id)).verdict, "failed");
  assert.equal(api.mutations.filter((p) => p.endsWith("/turns")).length, 1);
});
test("preflight blocks stale readiness and changed fixture bytes without product mutations", async (t) => {
  const root = await sandbox(t);
  const api = fakeApi();
  const runner = new EvalRunner(root, { token: "token", fetch: api.fetch });
  const run = await runner.prepare(
    entry({ prerequisites: ["browser_connected"] }),
    runtime,
    {
      browser_connected: {
        reason: "Observed extension",
        checked_at: "2020-01-01T00:00:00Z",
      },
    },
  );
  await runner.run(run.id, runtime.fingerprint);
  assert.equal((await runner.grade(run.id)).verdict, "blocked");
  assert.equal(api.mutations.length, 0);
  const script = {
    executable: process.execPath,
    args: ["-e", "console.log('{}')"],
  };
  const pin = join(root, "input.txt");
  await writeFile(pin, "Actual bytes");
  const second = await runner.prepare(
    entry({
      fixture: {
        files: [{ path: pin, sha256: sha("Wrong bytes") }],
        prepare: script,
        observe: script,
        cleanup: script,
      },
    }),
    runtime,
  );
  await runner.run(second.id, runtime.fingerprint);
  assert.match((await runner.load(second.id)).run.error!, /checksum changed/);
});
test("fixture hooks prepare, independently observe, verify and clean up through the same lifecycle", async (t) => {
  const root = await sandbox(t);
  const api = fakeApi();
  const script = join(root, "observer.cjs");
  await writeFile(
    script,
    `const fs = require('fs'); const path = require('path'); const [phase, folder] = process.argv.slice(2); if (phase === 'prepare') fs.writeFileSync(path.join(folder, 'fixture-owned.txt'), 'reset inputs'); if (phase === 'observe') fs.writeFileSync(path.join(folder, 'evidence', 'actual-state.json'), JSON.stringify({ total: 62.75 })); if (phase === 'cleanup') fs.unlinkSync(path.join(folder, 'fixture-owned.txt')); console.log(JSON.stringify(phase === 'verify' ? { checks: [{ id: 'total', verdict: JSON.parse(fs.readFileSync(path.join(folder, 'evidence', 'actual-state.json'))).total === 62.75 ? 'passed' : 'failed', reason: 'Independent fixture readback', evidence: ['evidence/actual-state.json#/total'] }] } : { phase }));`,
  );
  const command = (phase: string) => ({
    executable: process.execPath,
    args: [script, phase],
  });
  const runner = new EvalRunner(root, { token: "token", fetch: api.fetch });
  const run = await runner.prepare(
    entry({
      grading_mode: "programmatic",
      criteria: [],
      fixture: {
        files: [{ path: script, sha256: sha(await readFile(script)) }],
        prepare: command("prepare"),
        observe: command("observe"),
        cleanup: command("cleanup"),
      },
      verifier: command("verify"),
    }),
    runtime,
  );
  await runner.run(run.id, runtime.fingerprint);
  assert.equal((await runner.grade(run.id)).verdict, "passed");
  await assert.rejects(
    access(join(runner.folder(run.id), "fixture-owned.txt")),
  );
});
test("review rejects omitted criteria, fabricated pointers and references outside the attempt", async (t) => {
  const root = await sandbox(t);
  const api = fakeApi();
  const runner = new EvalRunner(root, { token: "token", fetch: api.fetch });
  const run = await runner.prepare(entry(), runtime);
  await runner.run(run.id, runtime.fingerprint);
  const result = await runner.grade(run.id);
  const base = {
    reviewer: "Observer",
    evidence_hash: result.evidence_hash,
    case_hash: result.case_hash,
  };
  await assert.rejects(
    runner.review(run.id, { ...base, criteria: [] }),
    /exactly once/,
  );
  await assert.rejects(
    runner.review(run.id, {
      ...base,
      criteria: [
        {
          id: "quality",
          verdict: "passed",
          reason: "Claim",
          evidence: ["evidence.json#/imaginary"],
        },
      ],
    }),
    /Missing evidence/,
  );
  await assert.rejects(
    checkReferences(runner.folder(run.id), ["../run.json"]),
    /inside the attempt/,
  );
  assert.equal(typeof (await evidenceHash(runner.folder(run.id))), "string");
});
test("observer timeout keeps ownership, allowing collection without claiming success", async (t) => {
  const root = await sandbox(t);
  const api = fakeApi({ active: true });
  const runner = new EvalRunner(root, {
    token: "token",
    fetch: api.fetch,
    poll_ms: 1,
  });
  const run = await runner.prepare(entry({ timeout_ms: 1 }), runtime);
  await assert.rejects(runner.run(run.id, runtime.fingerprint), /timeout/);
  assert.equal((await runner.load(run.id)).run.execution, "unknown");
  assert.equal((await readJson(join(root, "active.json"))).id, run.id);
  await runner.collect(run.id);
  assert.notEqual((await runner.grade(run.id)).verdict, "passed");
});

test("a semantic pass cannot override a failed programmatic outcome assertion", async (t) => {
  const root = await sandbox(t);
  const api = fakeApi();
  const runner = new EvalRunner(root, { token: "token", fetch: api.fetch });
  const run = await runner.prepare(
    entry({
      trajectory: {
        required_tool_calls: [
          {
            tool_name: "browser_snapshot",
            result: { text: "Different required fact" },
          },
        ],
      },
    }),
    runtime,
  );
  await runner.run(run.id, runtime.fingerprint);
  assert.equal((await reviewed(runner, run.id)).verdict, "failed");
});
test("partial fixture setup failure cleans owned resources and never launches the agent", async (t) => {
  const root = await sandbox(t);
  const api = fakeApi();
  const script = join(root, "partial.cjs");
  await writeFile(
    script,
    `const fs=require('fs'),path=require('path'); const [phase,folder]=process.argv.slice(2); const owned=path.join(folder,'owned.txt'); if(phase==='prepare'){ fs.writeFileSync(owned,'partial'); process.exit(1); } if(phase==='cleanup') fs.rmSync(owned,{force:true}); console.log('{}');`,
  );
  const command = (phase: string) => ({
    executable: process.execPath,
    args: [script, phase],
  });
  const runner = new EvalRunner(root, { token: "token", fetch: api.fetch });
  const run = await runner.prepare(
    entry({
      fixture: {
        files: [{ path: script, sha256: sha(await readFile(script)) }],
        prepare: command("prepare"),
        observe: command("observe"),
        cleanup: command("cleanup"),
      },
    }),
    runtime,
  );
  await assert.rejects(runner.run(run.id, runtime.fingerprint));
  assert.equal(api.mutations.length, 0);
  assert.equal((await runner.grade(run.id)).verdict, "blocked");
  await assert.rejects(access(join(runner.folder(run.id), "owned.txt")));
  await assert.rejects(
    runner.run(run.id, runtime.fingerprint),
    /prepare a fresh attempt/,
  );
});
test("malformed verifier output is an evaluator block, never an accepted agent result", async (t) => {
  const root = await sandbox(t);
  const api = fakeApi();
  const runner = new EvalRunner(root, { token: "token", fetch: api.fetch });
  const run = await runner.prepare(
    entry({
      verifier: {
        executable: process.execPath,
        args: ["-e", "console.log(JSON.stringify({checks:[{id:'wrong'}]}))"],
      },
    }),
    runtime,
  );
  await runner.run(run.id, runtime.fingerprint);
  assert.equal((await reviewed(runner, run.id)).verdict, "blocked");
  assert.match(
    (await runner.grade(run.id)).checks.find((c) => c.id === "verifier")!
      .reason,
    /Evaluator defect/,
  );
});

test("M1 does not start a paid revision when the initial artifacts are missing", async (t) => {
  const root = await sandbox(t);
  const api = fakeApi();
  const runner = new EvalRunner(root, { token: "token", fetch: api.fetch });
  const original = builtinCases().find((c) => c.id === "media-M1")!;
  const run = await runner.prepare({ ...original, prerequisites: [] }, runtime);
  await runner.run(run.id, runtime.fingerprint);
  assert.equal(api.mutations.filter((p) => p.endsWith("/turns")).length, 1);
  assert.equal((await runner.grade(run.id)).verdict, "failed");
});

test("recovered errors are diagnostic; declared error budgets still fail", async (t) => {
  const root = await sandbox(t),
    api = fakeApi({ error: true });
  const runner = new EvalRunner(root, { token: "token", fetch: api.fetch });
  const run = await runner.prepare(entry(), runtime);
  await runner.run(run.id, runtime.fingerprint);
  const accepted = await reviewed(runner, run.id);
  assert.equal(accepted.product_execution, "completed");
  assert.equal(accepted.verdict, "passed");
  assert.equal(accepted.metrics.failed_tool_calls, 1);
  assert.equal(accepted.triage.status, "awaiting_triage");
  assert.equal(accepted.triage_issues.length, 1);
  const budgeted = await runner.prepare(
    entry({ trajectory: { max_failed_tool_calls: 0 } }),
    runtime,
  );
  const budgetRunner = new EvalRunner(root, {
    token: "token",
    fetch: fakeApi({ error: true }).fetch,
  });
  await budgetRunner.run(budgeted.id, runtime.fingerprint);
  assert.equal((await reviewed(budgetRunner, budgeted.id)).verdict, "failed");
});

test("unlaunched preparations do not count as failures or reliability attempts", async (t) => {
  const root = await sandbox(t),
    runner = new EvalRunner(root);
  await runner.prepare(entry(), runtime);
  const report = await runner.report();
  assert.equal(report.attempts[0].observer_execution, "prepared");
  assert.equal(report.groups[0].attempts, 0);
  assert.equal(report.groups[0].prepared, 1);
  assert.equal(report.groups[0].failed, 0);
  assert.throws(
    () => caseSchema.parse({ ...entry(), revision: 2 }),
    /correction note/,
  );
});

test("agent, infrastructure and eval diagnoses cannot override acceptance", async (t) => {
  const root = await sandbox(t),
    api = fakeApi({ error: true });
  const runner = new EvalRunner(root, { token: "token", fetch: api.fetch });
  const agent = await runner.prepare(
    entry({ trajectory: { max_failed_tool_calls: 0 } }),
    runtime,
  );
  await runner.run(agent.id, runtime.fingerprint);
  await reviewed(runner, agent.id);
  const result = await runner.grade(agent.id);
  const diagnosis = {
    case_hash: result.case_hash,
    evidence_hash: result.evidence_hash,
    grading_hash: result.grading_hash,
    reviewer: "Independent investigator",
    findings: [
      {
        id: "bad-arguments",
        side: "agent",
        status: "confirmed",
        check_ids: result.triage_issues.map((i) => i.id),
        reason:
          "The retained call was rejected for invalid arguments, not a missing service",
        evidence: ["evidence.json#/calls/0"],
        next_action:
          "Fix argument selection using the existing tool schema; retain the error budget",
      },
    ],
  };
  // All issue IDs must be covered; diagnosis is never an acceptance override.
  const recorded = await runner.triage(agent.id, diagnosis);
  assert.equal(recorded.verdict, "failed");
  assert.equal(recorded.triage.findings[0].side, "agent");
  await assert.rejects(
    runner.triage(agent.id, {
      ...diagnosis,
      findings: [{ ...diagnosis.findings[0], check_ids: ["invented"] }],
    }),
    /cover every/,
  );
  const infra = await runner.prepare(
    entry({ prerequisites: ["browser_connected"] }),
    runtime,
  );
  await runner.run(infra.id, runtime.fingerprint);
  const blocked = await runner.grade(infra.id);
  const infraRecord = await runner.triage(infra.id, {
    case_hash: blocked.case_hash,
    evidence_hash: null,
    grading_hash: blocked.grading_hash,
    reviewer: "Observer",
    findings: [
      {
        id: "missing-connection",
        side: "infrastructure",
        status: "confirmed",
        check_ids: blocked.triage_issues.map((i) => i.id),
        reason:
          "The readiness precondition was absent before any product mutation",
        evidence: ["run.json#/error"],
        next_action:
          "Restore and independently verify the connection, then prepare a fresh attempt",
      },
    ],
  });
  assert.equal(infraRecord.verdict, "blocked");
  const evalRunner = new EvalRunner(root, {
    token: "token",
    fetch: fakeApi().fetch,
  });
  const evalRun = await evalRunner.prepare(
    entry({
      verifier: {
        executable: process.execPath,
        args: ["-e", "console.log('{}')"],
      },
    }),
    runtime,
  );
  await evalRunner.run(evalRun.id, runtime.fingerprint);
  const broken = await evalRunner.grade(evalRun.id);
  const evalRecord = await evalRunner.triage(evalRun.id, {
    case_hash: broken.case_hash,
    evidence_hash: broken.evidence_hash,
    grading_hash: broken.grading_hash,
    reviewer: "Observer",
    findings: [
      {
        id: "broken-verifier",
        side: "eval",
        status: "confirmed",
        check_ids: broken.triage_issues.map((i) => i.id),
        reason:
          "The verifier returned no outcome checks; agent output does not establish evaluator correctness",
        evidence: ["evidence/verifier.json"],
        next_action:
          "Repair the verifier contract and test negative outputs; do not lower acceptance",
      },
    ],
  });
  assert.equal(evalRecord.verdict, "blocked");
  const summary = await runner.report();
  assert.deepEqual(summary.triage_findings_by_side, {
    agent: 1,
    infrastructure: 1,
    eval: 1,
    unclassified: 0,
  });
  await writeFile(
    join(runner.folder(agent.id), "evidence", "later.txt"),
    "new evidence",
  );
  assert.equal((await runner.grade(agent.id)).triage.status, "stale");
});

test("policy corrections require a reason and archive the old judgment without editing the case or execution", async (t) => {
  const root = await sandbox(t),
    api = fakeApi({ error: true });
  const runner = new EvalRunner(root, { token: "token", fetch: api.fetch });
  const run = await runner.prepare(entry(), runtime);
  await runner.run(run.id, runtime.fingerprint);
  const folder = runner.folder(run.id),
    original = await readJson(join(folder, "result.json"));
  const legacy = { ...original, grading_policy_version: 1, verdict: "failed" };
  await json(join(folder, "result.json"), legacy);
  const launch = await readJson(join(folder, "run.json"));
  launch.execution = "failed";
  await json(join(folder, "run.json"), launch);
  const caseBytes = await readFile(join(folder, "case.json"), "utf8"),
    runBytes = await readFile(join(folder, "run.json"), "utf8");
  await assert.rejects(runner.grade(run.id), /explicit correction reason/);
  assert.equal((await runner.inspect(run.id)).regrade_required, true);
  await runner.report();
  assert.deepEqual(await readJson(join(folder, "result.json")), legacy);
  await assert.rejects(runner.regrade(run.id, ""), /requires/);
  const corrected = await runner.regrade(
    run.id,
    "Policy v1 incorrectly treated a recovered error as product execution failure; terminal product evidence is complete",
  );
  assert.equal(
    corrected.checks.find((c) => c.id === "execution")!.verdict,
    "passed",
  );
  assert.equal(corrected.verdict, "awaiting_review");
  assert.equal(corrected.product_execution, "completed");
  assert.equal(corrected.observer_execution, "failed");
  assert.equal(await readFile(join(folder, "case.json"), "utf8"), caseBytes);
  assert.equal(await readFile(join(folder, "run.json"), "utf8"), runBytes);
  assert.equal(api.mutations.length, 2);
  const history = await import("node:fs/promises").then((fs) =>
    fs.readdir(join(folder, "history")),
  );
  assert.ok(
    (
      await Promise.all(
        history
          .filter((f) => f.endsWith("-result.json"))
          .map((f) => readJson(join(folder, "history", f))),
      )
    ).some((r) => r.grading_policy_version === 1 && r.verdict === "failed"),
  );
});

test("a frozen procedural criterion still fails after regrading", async (t) => {
  const root = await sandbox(t),
    api = fakeApi(),
    runner = new EvalRunner(root, { token: "token", fetch: api.fetch });
  const frozen = entry({
    id: "old-download-contract",
    criteria: [
      {
        id: "browser-discovery",
        text: "Discover the raw file through the browser",
      },
    ],
  });
  const run = await runner.prepare(frozen, runtime);
  await runner.run(run.id, runtime.fingerprint);
  let result = await runner.grade(run.id);
  result = await runner.review(run.id, {
    case_hash: result.case_hash,
    evidence_hash: result.evidence_hash,
    reviewer: "Observer",
    criteria: [
      {
        id: "browser-discovery",
        verdict: "failed",
        reason: "No browser discovery occurred",
        evidence: ["evidence.json#/calls"],
      },
    ],
  });
  assert.equal(result.verdict, "failed");
  const before = await readFile(
    join(runner.folder(run.id), "case.json"),
    "utf8",
  );
  await runner.regrade(
    run.id,
    "Verify the frozen criterion remains enforced independently of the future case correction",
  );
  assert.equal((await runner.grade(run.id)).verdict, "failed");
  assert.equal(
    await readFile(join(runner.folder(run.id), "case.json"), "utf8"),
    before,
  );
});

test("a routine case runs as a real routine: create it inactive, Run now, then follow its task", async (t) => {
  const root = await sandbox(t);
  const api = fakeApi();
  const bodies: Record<string, any> = {};
  const routineFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    if (init?.method === "POST" && path === "/api/routines") {
      api.mutations.push(path);
      bodies.routine = JSON.parse(String(init.body));
      return Response.json({ id: "routine-1" });
    }
    if (init?.method === "POST" && path === "/api/routines/routine-1/run") {
      api.mutations.push(path);
      // The product submits the routine's instructions as the first turn itself.
      api.task.turns.push({
        id: "turn-1",
        status: "completed",
        artifacts: [],
        messages: [
          { kind: "user", content: { text: bodies.routine.instructions } },
          { kind: "assistant", content: { text: "Ideas delivered." } },
        ],
      });
      return Response.json({ taskId: "task-1" });
    }
    return api.fetch(url, init);
  }) as typeof fetch;
  const runner = new EvalRunner(root, { token: "token", fetch: routineFetch });
  const run = await runner.prepare(
    entry({
      plugin: "ideas",
      turns: [{ brief: "Read the find-content-ideas skill with read_skill, then follow it." }],
      routine: { skill: "find-content-ideas", platform: "X" },
    }),
    runtime,
  );
  const done = await runner.run(run.id, runtime.fingerprint);
  assert.equal(done.execution, "completed");
  assert.equal(done.routine_id, "routine-1");
  assert.deepEqual(api.mutations, ["/api/routines", "/api/routines/routine-1/run"]);
  assert.equal(bodies.routine.active, false);
  assert.equal(bodies.routine.instructions, "Read the find-content-ideas skill with read_skill, then follow it.");
  assert.throws(
    () => entry({ routine: { skill: "x", platform: null }, turns: [{ brief: "a" }, { brief: "b" }] }),
    /exactly one turn/,
  );
});
