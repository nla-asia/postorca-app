import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rm, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { gradeVideo } from "../video-grade.js";
import type { VideoExpectation } from "../video-cases.js";
import { gradeComputer, type ComputerCase } from "../computer-cases.js";
import {
  gradeMacComputer,
  type MacComputerCaseId,
} from "../computer-mac-cases.js";
import type { ComputerEvalCase, EvalCheck } from "../computer-eval-types.js";
import { gradeDemoCapture } from "../computer-demo-cases.js";
import { gradeMediaTools } from "../media-cases.js";
import { gradeWriting, gradeWritingTools } from "../writing-cases.js";
import { gradeBrowserTools } from "../browser-tools.js";
import {
  caseSchema,
  checkSchema,
  reviewSchema,
  triageSchema,
  type Check,
  type EvalCase,
  type Evidence,
  type Run,
} from "./contracts.js";
import {
  aggregate,
  normalizeCalls,
  trajectoryChecks,
  executionCheck,
  gradingPolicyVersion,
  triageIssues,
} from "./judge.js";
import {
  checkReferences,
  evidenceHash,
  hook,
  json,
  maybeJson,
  readJson,
  sha,
} from "./io.js";

export type Runtime = Pick<
  Run,
  "model" | "platform" | "commit" | "dirty" | "fingerprint"
>;
type Readiness = Run["readiness"];
export class EvalRunner {
  constructor(
    readonly root: string,
    readonly options: {
      api?: string;
      token?: string;
      fetch?: typeof fetch;
      poll_ms?: number;
    } = {},
  ) {}
  folder(id: string) {
    if (!/^[a-zA-Z0-9-]+$/.test(id)) throw new Error("Invalid attempt ID");
    return join(this.root, id);
  }
  async load(id: string) {
    const folder = this.folder(id);
    const run: Run = await readJson(join(folder, "run.json"));
    const entry = caseSchema.parse(await readJson(join(folder, "case.json")));
    if (sha(JSON.stringify(entry)) !== run.case_hash)
      throw new Error("Frozen case changed");
    return { folder, run, entry };
  }
  async request(api: string, path: string, method = "GET", body?: unknown) {
    if (!this.options.token)
      throw new Error(
        "Set POSTORCA_EVAL_TOKEN to an existing founder session token",
      );
    const url = new URL(api);
    if (
      !/^https?:$/.test(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error(
        "API must be an HTTP(S) URL without credentials, query, or fragment",
      );
    const response = await (this.options.fetch ?? fetch)(
      api.replace(/\/$/, "") + path,
      {
        method,
        headers: {
          Authorization: `Bearer ${this.options.token}`,
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
        redirect: "error",
      },
    );
    if (!response.ok)
      throw new Error(
        `${method} ${path.split("?")[0]}: HTTP ${response.status}`,
      );
    return response;
  }
  async api(
    run: Run,
    path: string,
    method = "GET",
    body?: unknown,
  ): Promise<any> {
    return (await this.request(run.api, path, method, body)).json();
  }
  async prepare(entry: EvalCase, runtime: Runtime, readiness: Readiness = {}) {
    entry = caseSchema.parse(entry);
    const id = `${entry.id}-${randomUUID()}`;
    const folder = this.folder(id);
    await mkdir(join(folder, "evidence"), { recursive: true });
    const run: Run = {
      schema_version: 1,
      id,
      case_id: entry.id,
      created_at: new Date().toISOString(),
      api: this.options.api ?? "http://127.0.0.1:3001/api",
      ...runtime,
      case_hash: sha(JSON.stringify(entry)),
      readiness,
      execution: "prepared",
      steps: [],
    };
    await json(join(folder, "case.json"), entry);
    await json(join(folder, "run.json"), run);
    return run;
  }
  async event(folder: string, type: string, data: object = {}) {
    // One writer per attempt. Atomic per-event files survive a crash mid-write.
    const directory = join(folder, "events");
    await mkdir(directory, { recursive: true });
    await json(join(directory, `${Date.now()}-${randomUUID()}.json`), {
      at: new Date().toISOString(),
      type,
      ...data,
    });
  }
  async lock(id: string) {
    await mkdir(this.root, { recursive: true });
    try {
      await writeFile(join(this.root, "active.json"), JSON.stringify({ id }), {
        flag: "wx",
        mode: 0o600,
      });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      const active = await readJson(join(this.root, "active.json"));
      if (active.id !== id)
        throw new Error(
          `Attempt ${active.id} still owns the runner; reconcile it before starting another`,
        );
    }
    // Prevent concurrent processes from resuming the SAME attempt.
    await writeFile(join(this.folder(id), "writer.lock"), String(process.pid), {
      flag: "wx",
    });
  }
  async unlock(id: string, release: boolean) {
    await rm(join(this.folder(id), "writer.lock"), { force: true });
    if (release) await rm(join(this.root, "active.json"), { force: true });
  }
  async preflight(entry: EvalCase, run: Run, fingerprint: string) {
    if (run.fingerprint !== fingerprint)
      throw new Error(
        "Runtime sources changed since prepare; prepare a new attempt",
      );
    if (entry.platform && entry.platform !== process.platform)
      throw new Error(`Requires ${entry.platform}`);
    if (entry.computer && !entry.verifier)
      throw new Error(
        "Configure an independent computer observer verifier before running this case",
      );
    if (entry.prerequisites.includes("fixture_ready") && !entry.fixture)
      throw new Error(
        "Configure pinned fixture setup, observation and cleanup hooks before running this case",
      );
    for (const name of entry.prerequisites) {
      const check = run.readiness[name];
      const age = check ? Date.now() - Date.parse(check.checked_at) : Infinity;
      if (
        !check?.reason.trim() ||
        !Number.isFinite(age) ||
        age < 0 ||
        age > 300_000
      )
        throw new Error(
          `Missing or stale independent readiness check: ${name}`,
        );
    }
    if (entry.fixture)
      for (const file of entry.fixture.files) {
        if (sha(await readFile(file.path)) !== file.sha256)
          throw new Error(`Fixture checksum changed: ${file.path}`);
      }
    await this.api(run, "/health");
    const tasks = await this.api(run, "/tasks");
    if (!Array.isArray(tasks)) throw new Error("Unexpected task list");
    if (
      tasks.some(
        (t) => t.id !== run.task_id && ["queued", "running"].includes(t.status),
      )
    )
      throw new Error("Another founder task is queued or running");
  }
  /** run is also resume: durable intent precedes every product mutation. */
  async run(id: string, fingerprint: string) {
    const { folder, run, entry } = await this.load(id);
    if (["completed", "failed"].includes(run.execution))
      throw new Error("Attempt already settled; inspect or regrade it");
    if (run.task_launch_intent && run.fingerprint !== fingerprint)
      throw new Error(
        "Runtime changed during interrupted work; collect the original task without submitting follow-ups",
      );
    if (run.execution === "blocked" && run.fixture_started)
      throw new Error(
        "Fixture setup attempt already settled; retry cleanup if needed, then prepare a fresh attempt",
      );
    await this.lock(id);
    let release = false;
    const save = () => json(join(folder, "run.json"), run);
    try {
      if (!run.task_launch_intent) {
        try {
          await this.preflight(entry, run, fingerprint);
        } catch (e) {
          run.execution = "blocked";
          run.error = (e as Error).message;
          await save();
          release = true;
          await this.grade(id);
          return run;
        }
        if (entry.fixture && !run.fixture_started) {
          // Mark intent first: a failed setup may have partially created resources.
          run.fixture_started = true;
          await save();
          await hook(entry.fixture.prepare, folder, "evidence/fixture-prepare");
        }
        run.execution = "running";
        delete run.error;
        run.task_launch_intent = new Date().toISOString();
        await save();
        const task = await this.api(run, "/tasks", "POST", {
          kind: "work",
          title: entry.title.slice(0, 200),
        });
        run.task_id = task.id;
        await save();
        await this.event(folder, "task-created", { task_id: task.id });
      }
      if (!run.task_id)
        throw new Error(
          "Task creation outcome is unknown. Find the existing task and use reconcile-task; do not create another",
        );
      run.started_at ??= new Date().toISOString();
      await save();
      const deadline = Date.parse(run.started_at) + entry.timeout_ms;
      for (let i = 0; i < entry.turns.length; i++) {
        let task = await this.api(run, `/tasks/${run.task_id}`);
        if (!run.steps[i]) {
          // Never submit on top of unrelated or still-active work.
          if (
            task.turns.length !== i ||
            task.turns.some((t: any) =>
              ["queued", "running"].includes(t.status),
            )
          )
            throw new Error("Unexpected task turns; inspect before continuing");
          run.steps.push({ intent_at: new Date().toISOString() });
          await save();
          const turn = await this.api(
            run,
            `/tasks/${run.task_id}/turns`,
            "POST",
            { message: entry.turns[i].brief },
          );
          run.steps[i].turn_id = turn.id;
          await save();
        }
        // A lost POST response is reconciled from the task's real messages, never resent.
        task = await this.api(run, `/tasks/${run.task_id}`);
        let turn = task.turns[i];
        if (!run.steps[i].turn_id) {
          if (
            !turn ||
            !turn.messages.some(
              (m: any) =>
                m.kind === "user" && m.content.text === entry.turns[i].brief,
            )
          )
            throw new Error(
              "Turn launch outcome unknown; inspect existing task, do not resend",
            );
          run.steps[i].turn_id = turn.id;
          await save();
        }
        if (!turn || turn.id !== run.steps[i].turn_id)
          throw new Error("Recorded turn missing or order changed");
        while (["queued", "running"].includes(turn.status)) {
          if (Date.now() >= deadline)
            throw new Error(
              "Observer timeout; execution outcome unknown. Resume this attempt instead of creating another",
            );
          await delay(this.options.poll_ms ?? 2000);
          task = await this.api(run, `/tasks/${run.task_id}`);
          turn = task.turns.find((t: any) => t.id === run.steps[i].turn_id);
          if (!turn) throw new Error("Recorded turn disappeared");
        }
        await json(join(folder, "evidence/task.json"), task);
        const step = entry.turns[i];
        let followupReady = true;
        if (i < entry.turns.length - 1 && step.video_case) {
          const checked = gradeVideo(
            {
              id: step.video_case,
              name: entry.title,
              start: { brief: step.brief },
              expect: step.video_expect as VideoExpectation,
            },
            turn.messages,
            turn.artifacts,
            step.exports!,
          );
          followupReady = checked.checks.every((c) => c.ok !== false);
        }
        if (entry.id === "media-M1" && i === 0)
          followupReady = ["image", "audio"].every((kind) =>
            turn.artifacts.some((a: any) => a.kind === kind),
          );
        if (turn.status !== "completed") {
          run.execution = "failed";
          break;
        }
        // A recovered error is diagnostic evidence, not proof that execution or
        // the user's outcome failed. Still retain the conservative paid-followup
        // stop; the undeclared outcome of missing followups must not pass.
        if (
          i < entry.turns.length - 1 &&
          (!followupReady ||
            normalizeCalls({ turns: [turn] }).some((c) => c.failed))
        ) {
          run.followups_stopped = {
            after_turn: turn.id,
            reason: !followupReady
              ? "Prerequisite deliverables did not pass checks"
              : "Tool errors require investigation before paid followups",
          };
          break;
        }
      }
      if (run.execution !== "failed") run.execution = "completed";
      run.finished_at = new Date().toISOString();
      await save();
      await this.collect(id);
      if (entry.fixture)
        await hook(entry.fixture.observe, folder, "evidence/fixture-observe");
      if (entry.verifier)
        await hook(entry.verifier, folder, "evidence/verifier");
      await this.cleanup(entry, run, folder);
      await save();
      release = true;
      await this.grade(id);
      return run;
    } catch (e) {
      run.error = (e as Error).message;
      if (run.execution === "completed" || run.execution === "failed") {
        // Product execution settled; observer/cleanup failure must not become an agent pass.
        run.observer_error = run.error;
        try {
          await this.cleanup(entry, run, folder);
          release = true;
        } catch {
          /* retain ownership */
        }
      } else if (!run.task_launch_intent) {
        run.execution = "blocked";
        try {
          await this.cleanup(entry, run, folder);
          release = true;
        } catch {
          /* retain ownership */
        }
      } else run.execution = "unknown";
      await save();
      await this.event(folder, "observer-error", { error: run.error });
      await this.grade(id);
      throw e;
    } finally {
      await this.unlock(id, release);
    }
  }
  async cleanup(entry: EvalCase, run: Run, folder: string) {
    if (entry.fixture && run.fixture_started && !run.fixture_cleaned) {
      await hook(entry.fixture.cleanup, folder, "evidence/fixture-cleanup");
      run.fixture_cleaned = true;
    }
  }
  async collect(id: string) {
    const { folder, run } = await this.load(id);
    if (!run.task_id) throw new Error("No task ID to collect");
    const task = await this.api(run, `/tasks/${run.task_id}`);
    const calls = normalizeCalls(task);
    const downloads: any[] = [];
    const files = new Set<string>();
    for (const turn of task.turns ?? [])
      for (const artifact of turn.artifacts ?? []) {
        let content: any;
        try {
          content = JSON.parse(artifact.content);
        } catch {
          continue;
        }
        if (typeof content?.file === "string") files.add(content.file);
      }
    // Retain tool screenshots as well as user-facing artifacts.
    for (const call of calls)
      for (const a of call.result?.attachments ?? [])
        if (typeof a.file === "string") files.add(a.file);
    for (const file of files) {
      try {
        const response = await this.request(
          run.api,
          `/files?key=${encodeURIComponent(file)}`,
        );
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length > 200 * 1024 * 1024)
          throw new Error("File exceeds 200 MB");
        const name = `${sha(file).slice(0, 16)}${/\.[a-z0-9]{1,8}$/i.exec(file)?.[0] ?? ".bin"}`;
        await writeFile(join(folder, "evidence", name), bytes, { mode: 0o600 });
        downloads.push({
          file,
          path: `evidence/${name}`,
          bytes: bytes.length,
          sha256: sha(bytes),
          mime_type: response.headers.get("content-type"),
        });
      } catch (e) {
        downloads.push({ file, error: (e as Error).message });
      }
    }
    const evidence: Evidence = {
      task,
      calls,
      downloads,
      collected_at: new Date().toISOString(),
    };
    await json(join(folder, "evidence.json"), evidence);
    await this.event(folder, "collected", {
      turns: task.turns.length,
      files: downloads.length,
    });
    return evidence;
  }
  async grade(id: string, policyChangeReason?: string) {
    const { folder, run, entry } = await this.load(id);
    const old = await maybeJson(join(folder, "result.json"));
    const previousPolicy = old?.grading_policy_version ?? 1;
    if (
      old &&
      previousPolicy !== gradingPolicyVersion &&
      !policyChangeReason?.trim()
    )
      throw new Error(
        `Stored grading policy ${previousPolicy} differs from ${gradingPolicyVersion}; use regrade with an explicit correction reason`,
      );
    const evidence: Evidence | undefined = await maybeJson(
      join(folder, "evidence.json"),
    );
    const checks: Check[] = [executionCheck(run, evidence)];
    if (run.observer_error)
      checks.push({
        id: "observer",
        verdict: "blocked",
        reason: run.observer_error,
        evidence: ["run.json#/observer_error"],
      });
    if (evidence) {
      checks.push(...trajectoryChecks(entry, evidence.calls));
      checks.push({
        id: "turns-completed",
        verdict:
          evidence.task.turns.length === entry.turns.length &&
          evidence.task.turns.every((t: any) => t.status === "completed")
            ? "passed"
            : evidence.task.turns.some((t: any) =>
                  ["queued", "running"].includes(t.status),
                )
              ? "blocked"
              : "failed",
        reason: "All declared turns must complete",
        evidence: ["evidence.json#/task/turns"],
      });
      checks.push({
        id: "downloads",
        verdict: evidence.downloads.some((d) => d.error) ? "failed" : "passed",
        reason: `${evidence.downloads.length} retained file transfers; ${evidence.downloads.filter((d) => d.error).length} failures`,
        evidence: ["evidence.json#/downloads"],
      });
      for (const [i, step] of entry.turns.entries())
        if (step.video_case && evidence.task.turns[i]) {
          const video = {
            id: step.video_case,
            name: entry.title,
            start: { brief: step.brief },
            expect: step.video_expect as VideoExpectation,
          };
          const turn = evidence.task.turns[i];
          const result = gradeVideo(
            video,
            turn.messages,
            turn.artifacts,
            step.exports!,
          );
          checks.push(
            ...result.checks.map((c, n): Check => ({
              id: `video-${i}-${n}`,
              verdict:
                c.ok === null ? "awaiting_review" : c.ok ? "passed" : "failed",
              reason: `${c.name}: ${c.detail}`,
              evidence: [`evidence.json#/task/turns/${i}`],
            })),
          );
        }
      if (entry.computer) {
        const observer = await maybeJson(
          join(folder, "evidence/verifier.json"),
        );
        if (!observer?.computer_evidence)
          checks.push({
            id: "computer-observer",
            verdict: "blocked",
            reason:
              "Independent native app observation and control-release evidence are required from the verifier hook",
            evidence: ["case.json#/computer"],
          });
        else {
          const spec = entry.computer;
          const last = evidence.task.turns.at(-1);
          const input = {
            status: last.status,
            calls: evidence.calls,
            final: last.messages
              .filter((m: any) => m.kind === "assistant")
              .map((m: any) => m.content.text ?? "")
              .join("\n"),
            artifacts: evidence.task.turns.flatMap((t: any) => t.artifacts),
            observed: observer.computer_evidence.observed,
            controlReleased:
              observer.computer_evidence.controlReleased === true,
          };
          // Only independent observation fields cross this boundary. Trajectory and
          // delivered artifacts always come from the actual product task.
          input.calls = evidence.calls;
          input.artifacts = evidence.task.turns.flatMap(
            (t: any) => t.artifacts,
          );
          input.status = last.status;
          const graded =
            entry.platform === "darwin"
              ? gradeMacComputer(
                  spec.contract as ComputerEvalCase<MacComputerCaseId>,
                  input,
                )
              : gradeComputer(spec.contract as ComputerCase, input);
          checks.push(
            ...graded.map((c, i): Check => ({
              id: `computer-${i}`,
              verdict: c.passed ? "passed" : "failed",
              reason: `${c.name}: ${JSON.stringify(c.details ?? "")}`,
              evidence: [
                "evidence/verifier.json#/computer_evidence",
                "evidence.json#/calls",
              ],
            })),
          );
        }
      }
      if (entry.demo) {
        const last = evidence.task.turns.at(-1);
        checks.push(
          ...gradeDemoCapture(entry.demo, {
            status: last.status,
            calls: evidence.calls,
            artifacts: evidence.task.turns.flatMap((t: any) => t.artifacts),
          }).map((c, i): Check => ({
            id: `demo-${i}`,
            verdict: c.passed ? "passed" : "failed",
            reason: `${c.name}: ${JSON.stringify(c.details ?? "")}`,
            evidence: ["evidence.json#/calls", "evidence.json#/task/turns"],
          })),
        );
      }
      const graded = (checks: EvalCheck[], prefix: string) =>
        checks.map((c, i): Check => ({
          id: `${prefix}-${i}`,
          verdict: c.passed ? "passed" : "failed",
          reason: `${c.name}: ${JSON.stringify(c.details ?? "")}`,
          evidence: ["evidence.json#/calls", "evidence.json#/task/turns"],
        }));
      if (entry.id === "media-M1")
        checks.push(
          ...graded(
            gradeMediaTools({ turns: evidence.task.turns, calls: evidence.calls }),
            "media",
          ),
        );
      const last = evidence.task.turns.at(-1);
      const artifacts = evidence.task.turns.flatMap((t: any) => t.artifacts);
      if (entry.id === "browser-tools")
        checks.push(
          ...graded(
            gradeBrowserTools({
              status: last?.status,
              calls: evidence.calls,
              artifacts,
              final: (last?.messages ?? [])
                .filter((m: any) => m.kind === "assistant")
                .map((m: any) => m.content.text ?? "")
                .join("\n"),
            }),
            "browser",
          ),
        );
      if (entry.id === "writing-tools")
        checks.push(
          ...graded(
            gradeWritingTools({ status: last?.status, calls: evidence.calls, artifacts }),
            "writing-tools",
          ),
        );
      if (entry.writing)
        checks.push(
          ...graded(
            gradeWriting(entry.writing, {
              status: evidence.task.turns.at(-1)?.status,
              turns: evidence.task.turns,
              calls: evidence.calls,
            }),
            "writing",
          ),
        );
      if (entry.verifier) {
        try {
          const output = await maybeJson(
            join(folder, "evidence/verifier.json"),
          );
          if (!output) throw new Error("Verifier output missing");
          const custom = z.array(checkSchema).parse(output.checks ?? []);
          if (!custom.length && !entry.computer)
            throw new Error("Verifier must return at least one check");
          if (new Set(custom.map((c) => c.id)).size !== custom.length)
            throw new Error("Verifier check IDs must be unique");
          for (const c of custom) await checkReferences(folder, c.evidence);
          checks.push(...custom.map((c) => ({ ...c, id: `verifier-${c.id}` })));
        } catch (e) {
          checks.push({
            id: "verifier",
            verdict: "blocked",
            reason: `Evaluator defect: ${(e as Error).message}`,
            evidence: ["case.json#/verifier"],
          });
        }
      }
    }
    const semantic: Check[] = entry.criteria.map((c) => ({
      id: c.id,
      verdict: "awaiting_review",
      reason: c.text,
      evidence: ["case.json#/criteria"],
    }));
    const required = [
      ...checks.filter((c) => c.verdict === "awaiting_review"),
      ...semantic,
    ];
    const hash = evidence ? await evidenceHash(folder) : null;
    const gradingHash = sha(
      JSON.stringify({ version: gradingPolicyVersion, checks }),
    );
    const review = await maybeJson(join(folder, "review.json"));
    let acceptedReview: ReturnType<typeof reviewSchema.parse> | undefined;
    if (
      review &&
      review.evidence_hash === hash &&
      review.case_hash === run.case_hash &&
      review.grading_hash === gradingHash
    )
      acceptedReview = reviewSchema.parse({
        evidence_hash: review.evidence_hash,
        case_hash: review.case_hash,
        reviewer: review.reviewer,
        criteria: review.criteria,
      });
    const reviewById = new Map(
      acceptedReview?.criteria.map((c) => [c.id, c]) ?? [],
    );
    const final = [
      ...checks.filter((c) => c.verdict !== "awaiting_review"),
      ...required.map((c) => reviewById.get(c.id) ?? c),
    ];
    const issues = triageIssues(final, evidence?.calls ?? []);
    const recordedTriage = await maybeJson(join(folder, "triage.json"));
    const triageCurrent =
      recordedTriage &&
      recordedTriage.case_hash === run.case_hash &&
      recordedTriage.evidence_hash === hash &&
      recordedTriage.grading_hash === gradingHash &&
      recordedTriage.issue_hash === sha(JSON.stringify(issues));
    const triage = {
      status: !issues.length
        ? "not_required"
        : triageCurrent
          ? "recorded"
          : recordedTriage
            ? "stale"
            : "awaiting_triage",
      findings: triageCurrent
        ? triageSchema.parse({
            case_hash: recordedTriage.case_hash,
            evidence_hash: recordedTriage.evidence_hash,
            grading_hash: recordedTriage.grading_hash,
            reviewer: recordedTriage.reviewer,
            findings: recordedTriage.findings,
          }).findings
        : [],
    };
    const productExecution = !evidence?.task.turns.length
      ? "not_started"
      : evidence.task.turns.every((t: any) => t.status === "completed")
        ? "completed"
        : evidence.task.turns.some((t: any) => t.status === "failed")
          ? "failed"
          : "unknown";
    const result = {
      schema_version: 1,
      grading_policy_version: gradingPolicyVersion,
      case_id: entry.id,
      case_revision: entry.revision ?? 1,
      attempt_id: id,
      fingerprint: run.fingerprint,
      case_hash: run.case_hash,
      evidence_hash: hash,
      grading_hash: gradingHash,
      verdict: aggregate(final),
      product_execution: productExecution,
      observer_execution: run.execution,
      checks: final,
      review_required: required,
      triage_issues: issues,
      triage,
      metrics: {
        elapsed_ms:
          run.started_at && run.finished_at
            ? Date.parse(run.finished_at) - Date.parse(run.started_at)
            : null,
        tool_calls: evidence?.calls.length ?? 0,
        failed_tool_calls: evidence?.calls.filter((c) => c.failed).length ?? 0,
        model_tokens: null,
        cost: null,
      },
      graded_at: new Date().toISOString(),
    };
    if (old)
      await json(
        join(folder, "history", `${Date.now()}-${randomUUID()}-result.json`),
        old,
      );
    await json(join(folder, "result.json"), result);
    if (old && previousPolicy !== gradingPolicyVersion)
      await this.event(folder, "grading-policy-correction", {
        from: previousPolicy,
        to: gradingPolicyVersion,
        reason: policyChangeReason!,
        previous_verdict: old.verdict,
        new_verdict: result.verdict,
        case_hash: run.case_hash,
        evidence_hash: hash,
      });
    await json(join(folder, "review-template.json"), {
      evidence_hash: hash,
      case_hash: run.case_hash,
      reviewer: "",
      criteria: required.map((c) => ({ ...c, evidence: [] })),
    });
    await json(join(folder, "triage-template.json"), {
      case_hash: run.case_hash,
      evidence_hash: hash,
      grading_hash: gradingHash,
      reviewer: "",
      findings: issues.map((issue, i) => ({
        id: `finding-${i + 1}`,
        side: "unclassified",
        status: "investigating",
        check_ids: [issue.id],
        reason: issue.reason,
        evidence: issue.evidence,
        next_action:
          "Investigate evidence and propose the smallest justified fix; do not relax acceptance to obtain a pass",
      })),
    });
    return result;
  }
  async inspect(id: string) {
    const { folder } = await this.load(id);
    const stored = await maybeJson(join(folder, "result.json"));
    if (stored && (stored.grading_policy_version ?? 1) !== gradingPolicyVersion)
      return {
        ...stored,
        regrade_required: true,
        current_grading_policy_version: gradingPolicyVersion,
      };
    return this.grade(id);
  }
  async regrade(id: string, reason: string) {
    if (!reason.trim())
      throw new Error("Regrading requires an evidence-based reason");
    const result = await this.grade(id, reason);
    await this.event(this.folder(id), "regraded", {
      reason,
      case_hash: result.case_hash,
      evidence_hash: result.evidence_hash,
      verdict: result.verdict,
    });
    return result;
  }
  async triage(id: string, input: unknown) {
    const { folder } = await this.load(id);
    const diagnosis = triageSchema.parse(input);
    const result = await this.grade(id);
    if (
      diagnosis.case_hash !== result.case_hash ||
      diagnosis.evidence_hash !== result.evidence_hash ||
      diagnosis.grading_hash !== result.grading_hash
    )
      throw new Error(
        "Triage is for different or changed evidence, case, or grading",
      );
    const issueIds = new Set(result.triage_issues.map((i) => i.id));
    if (!issueIds.size)
      throw new Error("No failures, blockers, or tool errors require triage");
    const covered = new Set(diagnosis.findings.flatMap((f) => f.check_ids));
    if (
      covered.size !== issueIds.size ||
      [...covered].some((id) => !issueIds.has(id))
    )
      throw new Error(
        "Triage must cover every current failure, blocker, and tool-error diagnostic; unknown causes may remain unclassified",
      );
    for (const finding of diagnosis.findings)
      await checkReferences(folder, finding.evidence);
    const old = await maybeJson(join(folder, "triage.json"));
    if (old)
      await json(
        join(folder, "history", `${Date.now()}-${randomUUID()}-triage.json`),
        old,
      );
    await json(join(folder, "triage.json"), {
      ...diagnosis,
      issue_hash: sha(JSON.stringify(result.triage_issues)),
      recorded_at: new Date().toISOString(),
    });
    await this.event(folder, "triaged", {
      sides: [...new Set(diagnosis.findings.map((f) => f.side))],
    });
    return this.grade(id);
  }
  async review(id: string, input: unknown) {
    const { folder, run } = await this.load(id);
    const review = reviewSchema.parse(input);
    const result = await this.grade(id);
    if (
      review.evidence_hash !== result.evidence_hash ||
      review.case_hash !== run.case_hash
    )
      throw new Error("Review is for different or changed evidence/case");
    const expected = result.review_required.map((c) => c.id).sort();
    const supplied = review.criteria.map((c) => c.id).sort();
    if (JSON.stringify(expected) !== JSON.stringify(supplied))
      throw new Error("Review must cover each required criterion exactly once");
    for (const c of review.criteria) await checkReferences(folder, c.evidence);
    const old = await maybeJson(join(folder, "review.json"));
    if (old)
      await json(
        join(folder, "history", `${Date.now()}-${randomUUID()}-review.json`),
        old,
      );
    await json(join(folder, "review.json"), {
      ...review,
      grading_hash: result.grading_hash,
      recorded_at: new Date().toISOString(),
    });
    return this.grade(id);
  }
  async reconcileTask(id: string, taskId: string) {
    const { folder, run, entry } = await this.load(id);
    if (!run.task_launch_intent || run.task_id)
      throw new Error("Only an unresolved task creation can be reconciled");
    const task = await this.api(run, `/tasks/${encodeURIComponent(taskId)}`);
    if (task.title !== entry.title.slice(0, 200) || task.kind !== "work")
      throw new Error("Task does not match the recorded launch");
    run.task_id = task.id;
    await json(join(folder, "run.json"), run);
    await this.event(folder, "task-reconciled", { task_id: task.id });
  }
  async recoverWriter(id: string) {
    const folder = this.folder(id);
    const file = join(folder, "writer.lock");
    const pid = Number(await readFile(file, "utf8"));
    if (!Number.isSafeInteger(pid) || pid <= 0)
      throw new Error("Invalid writer PID; inspect manually");
    try {
      process.kill(pid, 0);
      throw new Error(
        `Writer process ${pid} is still alive; do not recover its lock`,
      );
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ESRCH") throw e;
    }
    await rm(file);
    await this.event(folder, "dead-writer-recovered", { pid });
  }
  async retryCleanup(id: string) {
    const { folder, run, entry } = await this.load(id);
    await this.lock(id);
    let release = false;
    try {
      if (run.task_launch_intent && !run.task_id)
        throw new Error("Resolve uncertain task creation before cleanup");
      if (run.task_id) {
        const task = await this.api(run, `/tasks/${run.task_id}`);
        if (
          task.turns.some((t: any) => ["queued", "running"].includes(t.status))
        )
          throw new Error("Product task is still active; retain its fixture");
      }
      await this.cleanup(entry, run, folder);
      if (["unknown", "running"].includes(run.execution)) {
        run.execution = "blocked";
        run.error =
          "Observer ended the attempt after independently confirming no active product turn; outcome requires a fresh attempt";
      }
      await json(join(folder, "run.json"), run);
      await this.event(folder, "cleanup-retried");
      release = true;
    } finally {
      await this.unlock(id, release);
    }
    return this.grade(id);
  }
  async report() {
    const attempts: any[] = [];
    await mkdir(this.root, { recursive: true });
    for (const d of await readdir(this.root, { withFileTypes: true }))
      if (d.isDirectory()) {
        const run = await maybeJson(join(this.root, d.name, "run.json"));
        if (!run) continue;
        // Recompute so changed evidence cannot leave a stale accepted pass in reports.
        const result = await this.inspect(d.name);
        attempts.push({
          id: run.id,
          case_id: run.case_id,
          fingerprint: run.fingerprint,
          case_hash: run.case_hash,
          case_revision: result.case_revision ?? 1,
          grading_policy_version: result.grading_policy_version ?? 1,
          created_at: run.created_at,
          verdict: result.verdict,
          execution: result.product_execution ?? run.execution,
          observer_execution: run.execution,
          regrade_required: result.regrade_required === true,
          triage: result.triage ?? { status: "awaiting_triage", findings: [] },
          metrics: result.metrics,
        });
      }
    attempts.sort((a, b) => a.created_at.localeCompare(b.created_at));
    const groups = new Map<string, any>();
    for (const a of attempts) {
      const key = `${a.case_id}:${a.fingerprint}:${a.case_hash}:${a.grading_policy_version}`;
      const g = groups.get(key) ?? {
        case_id: a.case_id,
        fingerprint: a.fingerprint,
        case_hash: a.case_hash,
        grading_policy_version: a.grading_policy_version,
        attempts: 0,
        prepared: 0,
        passed: 0,
        failed: 0,
        blocked: 0,
        awaiting_review: 0,
        consecutive_passes: 0,
      };
      if (a.observer_execution === "prepared") {
        g.prepared++;
        groups.set(key, g);
        continue;
      }
      g.attempts++;
      g[a.verdict]++;
      g.consecutive_passes =
        a.verdict === "passed" ? g.consecutive_passes + 1 : 0;
      groups.set(key, g);
    }
    const sides = { agent: 0, infrastructure: 0, eval: 0, unclassified: 0 };
    for (const a of attempts)
      for (const finding of a.triage.findings)
        sides[finding.side as keyof typeof sides]++;
    return {
      grading_policy_version: gradingPolicyVersion,
      attempts,
      groups: [...groups.values()],
      triage_findings_by_side: sides,
    };
  }
}
