/** App-level evals executed by the real internal agent; observer never supplies task actions. */
import "../env.js";
import { createHash, randomUUID } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import EmbeddedPostgres from "embedded-postgres";
import { configFromEnv, orcaFromEnv } from "../config.js";
import { settings } from "../settings.js";
import { createDatabase, ping } from "../db.js";
import { migrate } from "../migrate.js";
import { createApp } from "../app.js";
import { createAgent } from "../agent/router.js";
import { orcaProvider } from "../providers/meta.js";
import { issueToken } from "../middleware/auth.js";
import {
  attachDesktopSocket,
  desktopConnections,
} from "../desktop/connections.js";
import { callDesktop } from "../desktop/calls.js";
import { filePath } from "../storage.js";
import { computerRuntimeFiles } from "./computer-eval-runtime.js";
import type {
  ComputerEvalSuite,
  ComputerEvalRun,
  EvalCall,
} from "../evals/computer-eval-types.js";

export async function runComputerEval<Id extends string>(
  suite: ComputerEvalSuite<Id>,
) {
  const {
    caseOrder: computerCaseOrder,
    createCase: computerCase,
    grade: gradeComputer,
    assertGate,
    passingStreak,
    executionFingerprint,
  } = suite;
  type ComputerCaseId = Id;
  type GateRun = ComputerEvalRun<Id>;
  const require = createRequire(import.meta.url);
  const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
  const apiRoot = fileURLToPath(new URL("../../", import.meta.url));
  const root = resolve(repoRoot, suite.root);
  const stateFile = join(root, "state.json");
  const [mode = "list", selected, reviewVerdict, ...reviewReason] =
    process.argv.slice(2);
  const selectedFolder = selected ? resolve(repoRoot, selected) : undefined;
  async function readState(): Promise<GateRun[]> {
    try {
      const runs: GateRun[] = JSON.parse(await readFile(stateFile, "utf8"));
      if (runs.some((run) => !computerCaseOrder.includes(run.caseId)))
        throw new Error("Eval history contains a case from another suite.");
      return runs;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }
  async function fingerprint() {
    const files = [
      ...suite.files,
      "apps/api/src/scripts/computer-eval-runner.ts",
      "apps/api/src/scripts/computer-eval-runtime.ts",
      ...await computerRuntimeFiles(repoRoot, suite.platform),
    ];
    const hashes = Object.fromEntries(
      await Promise.all(
        files.map(async (f) => [
          f,
          createHash("sha256")
            .update(await readFile(resolve(repoRoot, f)))
            .digest("hex"),
        ]),
      ),
    );
    return {
      hashes,
      key: executionFingerprint(
        hashes,
        settings.orca.model,
        process.platform,
      ),
      gradingKey: createHash("sha256")
        .update(
          JSON.stringify(
            Object.fromEntries(
              Object.entries(hashes).filter(
                ([file]) =>
                  file.startsWith("apps/api/src/evals/") ||
                  suite.files.includes(file),
              ),
            ),
          ),
        )
        .digest("hex"),
    };
  }
  await mkdir(root, { recursive: true });
  const runtime = await fingerprint();
  const state = await readState();
  if (mode === "regrade-all" || mode === "regrade") {
    if (existsSync(join(root, "running.lock")))
      throw new Error("Do not regrade while a run is active.");
    if (
      mode === "regrade" &&
      (!selected ||
        !state.some((item) => resolve(item.folder) === selectedFolder))
    )
      throw new Error("regrade <run-folder> must name a retained run.");
    for (const item of state) {
      if (mode === "regrade" && resolve(item.folder) !== selectedFolder)
        continue;
      if (
        !existsSync(join(item.folder, "run.json")) ||
        !existsSync(join(item.folder, "calls.json"))
      )
        continue;
      const record = JSON.parse(
        await readFile(join(item.folder, "run.json"), "utf8"),
      );
      if (
        record.platform !== suite.platform ||
        !computerCaseOrder.includes(record.entry.id)
      )
        throw new Error("Cannot regrade a run from another platform or suite.");
      const file = join(item.folder, "result.json"),
        original = JSON.parse(await readFile(file, "utf8"));
      const evidence = JSON.parse(
        await readFile(join(item.folder, "evidence.json"), "utf8"),
      );
      const turn = evidence.turns.find((t: any) => t.id === original.turnId);
      if (!turn || !original.checks) continue;
      const checks = gradeComputer(record.entry, {
        status: turn.status,
        calls: JSON.parse(
          await readFile(join(item.folder, "calls.json"), "utf8"),
        ),
        final: original.final,
        artifacts: turn.artifacts,
        observed: original.observed,
        controlReleased:
          original.checks.find(
            (c: any) => c.name === "Control released when turn finished",
          )?.passed === true,
      });
      checks.push({
        name: "Runtime unchanged during the run",
        passed:
          original.checks.find(
            (c: any) => c.name === "Runtime unchanged during the run",
          )?.passed === true,
      });
      const verdict = checks.every((c) => c.passed)
        ? original.manualReview
          ? "needs_review"
          : "passed"
        : "failed";
      const key = executionFingerprint(
        record.hashes,
        record.model,
        record.platform,
      );
      if (!existsSync(join(item.folder, "result.original.json")))
        await writeFile(
          join(item.folder, "result.original.json"),
          JSON.stringify(original, null, 2),
          { flag: "wx" },
        );
      const result = {
        ...original,
        checks,
        verdict,
        fingerprint: key,
        regrade: {
          at: new Date().toISOString(),
          gradingFingerprint: runtime.gradingKey,
          originalFingerprint: record.fingerprint,
          noAgentExecution: true,
        },
      };
      await writeFile(file, JSON.stringify(result, null, 2));
      Object.assign(item, { fingerprint: key, verdict });
      console.log(
        JSON.stringify({
          caseId: item.caseId,
          verdict,
          folder: item.folder,
          currentExecution: key === runtime.key,
        }),
      );
    }
    await writeFile(stateFile, JSON.stringify(state, null, 2));
    process.exit(0);
  }
  if (mode === "list" || mode === "status") {
    for (const id of computerCaseOrder)
      console.log(
        JSON.stringify({
          id,
          name: computerCase(id, 1, "example").name,
          consecutive_passes: passingStreak(state, id, runtime.key),
          required: 3,
        }),
      );
    process.exit(0);
  }
  if (mode === "review") {
    if (
      !selected ||
      !["passed", "failed"].includes(reviewVerdict) ||
      !reviewReason.length
    )
      throw new Error(
        "review <run-folder> passed|failed <independent evidence-based reasoning>",
      );
    if (!state.some((run) => resolve(run.folder) === selectedFolder))
      throw new Error("Review must name a retained run from this suite.");
    const file = join(selectedFolder!, "result.json"),
      result = JSON.parse(await readFile(file, "utf8"));
    if (!result.manualReview || result.verdict !== "needs_review")
      throw new Error("This run is not awaiting observer review.");
    if (
      reviewVerdict === "passed" &&
      !result.checks.every((c: any) => c.passed)
    )
      throw new Error("Mechanical failures cannot be overridden.");
    Object.assign(result, {
      verdict: reviewVerdict,
      review: {
        reason: reviewReason.join(" "),
        at: new Date().toISOString(),
        judge: "independent observer",
      },
    });
    await writeFile(file, JSON.stringify(result, null, 2));
    const entry = state.find((r) => resolve(r.folder) === selectedFolder);
    if (!entry) throw new Error("Run missing from gate history.");
    entry.verdict = reviewVerdict;
    await writeFile(stateFile, JSON.stringify(state, null, 2));
    console.log(
      JSON.stringify({
        caseId: result.caseId,
        verdict: reviewVerdict,
        consecutive_passes: passingStreak(state, result.caseId, runtime.key),
      }),
    );
    process.exit(0);
  }
  if (mode !== "run" || !computerCaseOrder.includes(selected as ComputerCaseId))
    throw new Error(
      `Use list | status | run ${computerCaseOrder.join("|")} | review <folder> passed|failed <reason>.`,
    );
  const caseId = selected as ComputerCaseId;
  assertGate(state, caseId, runtime.key);
  const orca = orcaFromEnv(process.env);
  if (!orca)
    throw new Error("Configure the existing internal-agent model/key first.");
  if (process.platform !== suite.platform)
    throw new Error(
      `This eval suite requires ${suite.platform}; current platform is ${process.platform}.`,
    );
  // Configuration errors must not leave a lock that blocks the next attempt.
  const config = configFromEnv();
  const folder = join(
    root,
    caseId,
    new Date().toISOString().replace(/[:.]/g, "-"),
  );
  await mkdir(folder, { recursive: true });
  const lock = join(root, "running.lock");
  await writeFile(lock, JSON.stringify({ pid: process.pid, caseId, folder }), {
    flag: "wx",
  });
  const db = createDatabase(config.databaseUrl);
  let postgres: EmbeddedPostgres | undefined;
  let server: ReturnType<ReturnType<typeof createApp>["listen"]> | undefined;
  let desktopSocket: ReturnType<typeof attachDesktopSocket> | undefined;
  let agent: ReturnType<typeof createAgent> | null = null;
  let desktop: ReturnType<typeof spawn> | undefined;
  let desktopLog = "";
  let recorded = false;
  const sessionFile = join(folder, "desktop-session.json");
  const desktopOutput = join(folder, "desktop-output.log");
  const readDesktopLog = async () =>
    desktopLog + (await readFile(desktopOutput, "utf8").catch(() => ""));
  const observerTurn = randomUUID(),
    observerTask = randomUUID();
  let userId = "";
  let evalDeviceId: string | undefined;
  try {
    try {
      await ping(db);
    } catch (error) {
      const url = new URL(config.databaseUrl);
      if (
        url.hostname !== "127.0.0.1" ||
        url.pathname !== "/postorca" ||
        !existsSync(resolve(apiRoot, ".data/postgres/PG_VERSION"))
      )
        throw error;
      postgres = new EmbeddedPostgres({
        databaseDir: resolve(apiRoot, ".data/postgres"),
        user: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password),
        port: Number(url.port),
        persistent: true,
        postgresFlags: ["-h", "127.0.0.1"],
        onLog: () => {},
        onError: () => {},
      });
      await postgres.start();
    }
    await migrate(db);
    const users = (
      await db.query(
        process.env.POSTORCA_EVAL_EMAIL
          ? "SELECT id FROM users WHERE email=$1"
          : "SELECT id FROM users",
        process.env.POSTORCA_EVAL_EMAIL ? [process.env.POSTORCA_EVAL_EMAIL] : [],
      )
    ).rows;
    if (users.length !== 1)
      throw new Error(
        "Select exactly one existing founder with POSTORCA_EVAL_EMAIL.",
      );
    userId = users[0].id;
    const active = (
      await db.query(
        "SELECT id,status FROM turns WHERE status IN ('queued','running')",
      )
    ).rows;
    if (active.length)
      throw new Error(
        "Other queued/running turns exist; resolve them before evaluating.",
      );
    agent = createAgent(db, orcaProvider(config.orca!));
    server = createApp(db, config, agent).listen(0, "127.0.0.1");
    desktopSocket = attachDesktopSocket(server, config.jwtSecret);
    await new Promise<void>((resolve) => server!.once("listening", resolve));
    const apiUrl = `http://127.0.0.1:${(server.address() as any).port}/api`,
      token = issueToken(userId, config.jwtSecret),
      deviceId = randomUUID();
    evalDeviceId = deviceId;
    await writeFile(sessionFile, JSON.stringify({ token, deviceId, apiUrl }), {
      mode: 0o600,
    });
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const evalDesktop = resolve(
      repoRoot,
      "apps/desktop/electron/plugins/computer/eval-desktop.cjs",
    );
    if (process.platform === "darwin") {
      // Launched as its own app, so macOS asks for (and remembers) Accessibility and
      // Screen Recording for the desktop app, not for whatever started this runner.
      // It quits when the session file is removed.
      const electronApp = resolve(require("electron"), "../../..");
      desktop = spawn(
        "open",
        ["-n", "-W", "-a", electronApp, "--stdout", desktopOutput,
          "--stderr", desktopOutput, "--args", evalDesktop, sessionFile],
        { stdio: "ignore", env },
      );
    } else {
      desktop = spawn(require("electron"), [evalDesktop, sessionFile], {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        env,
      });
      const log = (data: Buffer) => {
        desktopLog += data.toString();
      };
      desktop.stdout!.on("data", log);
      desktop.stderr!.on("data", log);
    }
    for (
      let i = 0;
      i < 100 && !desktopConnections.online(userId).includes(deviceId);
      i++
    )
      await delay(200);
    if (!desktopConnections.online(userId).includes(deviceId))
      throw new Error(
        `Eval desktop did not connect. ${(await readDesktopLog()).slice(-1000)}`,
      );
    const context = { userId, taskId: observerTask, turnId: observerTurn };
    const observeCall = (name: string, args: unknown = {}) =>
      callDesktop(
        context,
        name,
        { timeoutMs: 60_000, deviceId },
        args,
      ) as Promise<any>;
    const before = await observeCall("desktop_status");
    if (!before.plugins?.computer?.available)
      throw new Error("Computer capability unavailable.");
    const entry = computerCase(
      caseId,
      state.filter((r) => r.caseId === caseId).length + 1,
      randomUUID().slice(0, 8),
    );
    const observerBaseline = await suite.prepare?.(entry, folder);
    const record = {
      observerBaseline,
      caseId,
      model: orca.model,
      platform: process.platform,
      startedAt: new Date().toISOString(),
      fingerprint: runtime.key,
      gradingFingerprint: runtime.gradingKey,
      hashes: runtime.hashes,
      commit: execFileSync("git", ["rev-parse", "HEAD"], {
        encoding: "utf8",
      }).trim(),
      dirty: execFileSync("git", ["status", "--porcelain"], {
        encoding: "utf8",
      }).trim(),
      entry,
      preflight: before,
      execution:
        "Production AgentLoop + configured model provider + authenticated DesktopConnection; no scripted task actions.",
    };
    await writeFile(join(folder, "run.json"), JSON.stringify(record, null, 2));
    const api = async (route: string, body?: any) => {
      const response = await fetch(apiUrl + route, {
        method: body ? "POST" : "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error(`${route}: HTTP ${response.status}`);
      return response.json() as Promise<any>;
    };
    const task = await api("/tasks", {
      kind: "work",
      title: `Computer eval — ${entry.name} — ${new Date().toISOString()}`,
    });
    const started = await api(`/tasks/${task.id}/turns`, {
      message: entry.brief,
    });
    await writeFile(
      join(folder, "task.json"),
      JSON.stringify({ taskId: task.id, turnId: started.id }),
    );
    console.log(
      JSON.stringify({
        started: true,
        caseId,
        folder,
        taskId: task.id,
        turnId: started.id,
        model: record.model,
      }),
    );
    const deadline = Date.now() + 12 * 60_000;
    let detail: any,
      turn: any,
      lastCount = -1;
    do {
      await delay(2000);
      detail = await api(`/tasks/${task.id}`);
      turn = detail.turns.find((t: any) => t.id === started.id);
      if (turn.messages.length !== lastCount) {
        lastCount = turn.messages.length;
        const last = turn.messages.at(-1);
        console.log(
          JSON.stringify({
            caseId,
            status: turn.status,
            messages: lastCount,
            last: last?.kind,
            tool: last?.kind === "tool_call" ? last.content.name : undefined,
            error:
              last?.kind === "tool_result"
                ? last.content.result?.error
                : undefined,
          }),
        );
        await writeFile(
          join(folder, "evidence.json"),
          JSON.stringify(detail, null, 2),
        );
      }
      if (Date.now() > deadline) {
        await agent?.shutdown();
        detail = await api(`/tasks/${task.id}`);
        turn = detail.turns.find((t: any) => t.id === started.id);
        break;
      }
    } while (!["completed", "failed"].includes(turn.status));
    const resultMap = new Map(
      turn.messages
        .filter((m: any) => m.kind === "tool_result")
        .map((m: any) => [m.content.callId, m.content.result]),
    );
    const calls: EvalCall[] = turn.messages
      .filter((m: any) => m.kind === "tool_call")
      .map((m: any) => ({
        name: m.content.name,
        args: JSON.parse(m.content.arguments),
        result: resultMap.get(m.content.callId),
      }));
    const final =
      turn.messages
        .filter((m: any) => m.kind === "assistant" && m.content.text)
        .at(-1)?.content.text ?? "";
    // Preserve complete agent evidence even if the independent observer fails.
    await writeFile(join(folder, "calls.json"), JSON.stringify(calls, null, 2));
    await writeFile(
      join(folder, "evidence.json"),
      JSON.stringify(detail, null, 2),
    );
    const released = await observeCall("desktop_status");
    let observed: any = {};
    const lastWindow = [...calls]
      .reverse()
      .find((c) => c.name.startsWith("computer_") && c.result?.window)
      ?.result.window;
    if (lastWindow) {
      await observeCall("desktop_computer_session", { active: true });
      const listing = await observeCall("computer_list_apps");
      const observedApp = listing.apps?.find((a: any) =>
        a.windows?.some((w: any) => w.id === lastWindow),
      );
      observed = { apps: listing.apps, window_closed: !observedApp };
      try {
        if (observedApp) {
          observed = await observeCall("computer_observe", {
            window: lastWindow,
            accessibility: true,
          });

          if (observedApp)
            observed.app = {
              id: observedApp.id,
              name: observedApp.name,
              path: observedApp.path,
            };
        }
      } catch (error) {
        observed = { error: String(error) };
      }
      await observeCall("desktop_computer_session", { active: false });
    }
    Object.assign(
      observed,
      await suite.observe?.(entry, folder, observerBaseline),
    );
    const checks = gradeComputer(entry, {
      status: turn.status,
      calls,
      final,
      artifacts: turn.artifacts,
      observed,
      controlReleased: released.plugins?.computer?.active === false,
    });
    checks.push({
      name: "Runtime unchanged during the run",
      passed: (await fingerprint()).key === runtime.key,
    });
    const mechanicalPass = checks.every((c) => c.passed),
      verdict = mechanicalPass
        ? entry.manualReview
          ? "needs_review"
          : "passed"
        : "failed";
    const result = {
      caseId,
      verdict,
      manualReview: entry.manualReview,
      checks,
      taskId: task.id,
      turnId: started.id,
      model: record.model,
      fingerprint: runtime.key,
      gradingFingerprint: runtime.gradingKey,
      seconds: (Date.now() - Date.parse(record.startedAt)) / 1000,
      final,
      toolCalls: calls.length,
      observed,
      folder,
    };
    await writeFile(
      join(folder, "result.json"),
      JSON.stringify(result, null, 2),
    );
    await writeFile(join(folder, "calls.json"), JSON.stringify(calls, null, 2));
    await writeFile(join(folder, "desktop.log"), await readDesktopLog());
    const screenshots = calls
      .flatMap((c) => c.result?.attachments ?? [])
      .concat(observed.attachments ?? [])
      .filter((a) => a.kind === "screenshot");
    await mkdir(join(folder, "screenshots"), { recursive: true });
    for (const [i, shot] of screenshots.entries())
      await writeFile(
        join(folder, "screenshots", `${String(i + 1).padStart(3, "0")}.png`),
        await readFile(filePath(shot.file)),
      );
    state.push({ caseId, fingerprint: runtime.key, verdict, folder });
    await writeFile(stateFile, JSON.stringify(state, null, 2));
    recorded = true;
    console.log(
      JSON.stringify(
        {
          finished: true,
          caseId,
          verdict,
          checks,
          final,
          consecutive_passes: passingStreak(state, caseId, runtime.key),
          folder,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    if (!recorded) {
      const verdict = existsSync(join(folder, "task.json"))
        ? "failed"
        : "blocked";
      await writeFile(
        join(folder, "result.json"),
        JSON.stringify(
          {
            caseId,
            verdict,
            error: error instanceof Error ? error.message : String(error),
            fingerprint: runtime.key,
            folder,
          },
          null,
          2,
        ),
      );
      await writeFile(join(folder, "desktop.log"), await readDesktopLog());
      state.push({ caseId, verdict, fingerprint: runtime.key, folder });
      await writeFile(stateFile, JSON.stringify(state, null, 2));
    }
    console.error(
      `Computer eval did not finish normally: ${error instanceof Error ? error.message : String(error)}. Evidence: ${folder}`,
    );
    process.exitCode = 1;
  } finally {
    await agent?.shutdown();
    if (userId)
      await callDesktop(
        { userId, taskId: observerTask, turnId: observerTurn },
        "desktop_computer_session",
        { timeoutMs: 3000, deviceId: evalDeviceId },
        { active: false },
      ).catch(() => {});
    await rm(sessionFile, { force: true });
    if (desktop) {
      // The desktop checks for its session file every second.
      for (let i = 0; i < 30 && desktop.exitCode === null; i++)
        await delay(100);
      if (desktop.exitCode === null) desktop.kill();
    }
    desktopSocket?.close();
    if (server)
      await new Promise<void>((resolve) => server!.close(() => resolve()));
    await db.end();
    await postgres?.stop();
    await rm(lock, { force: true });
  }
}
