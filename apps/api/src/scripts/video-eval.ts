import "../env.js";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  writeFile,
  rm,
} from "node:fs/promises";
import { dirname, join, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { configFromEnv, imagesFromEnv, orcaFromEnv } from "../config.js";
import { createDatabase, type Database } from "../db.js";
import { issueToken } from "../middleware/auth.js";
import { catalogDrift } from "../plugins/catalog.js";
import { filePath, isUserFileKey } from "../storage.js";
import { turnTraceDirectory } from "../agent/trace.js";
import {
  videoCases,
  mediaAgentCase,
  type VideoCase,
} from "../evals/video-cases.js";
import {
  gradeVideo,
  toolEvidence,
  type Check,
  type EvalArtifact,
} from "../evals/video-grade.js";

const runBinary = promisify(execFile);
const require = createRequire(import.meta.url);
const repo = fileURLToPath(new URL("../../../../", import.meta.url));
const root = fileURLToPath(
  new URL("../../.data/video-evals/", import.meta.url),
);
const api = `http://127.0.0.1:${process.env.PORT ?? 3001}/api`;
const entries = [mediaAgentCase, ...videoCases];
type Context = {
  db: Database;
  userId: string;
  token: string;
  timezone: string;
};
type Report = {
  caseId: string;
  name: string;
  taskId?: string;
  turns: any[];
  videos: string[];
  failure?: string;
  [key: string]: unknown;
};

async function request(
  context: Context,
  path: string,
  method = "GET",
  data?: unknown,
) {
  const response = await fetch(api + path, {
    method,
    headers: {
      Authorization: `Bearer ${context.token}`,
      "Content-Type": "application/json",
    },
    body: data === undefined ? undefined : JSON.stringify(data),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok)
    throw new Error(`${method} ${path}: HTTP ${response.status}`);
  return response.status === 204 ? null : (response.json() as Promise<any>);
}
async function contextFor(db: Database, secret: string): Promise<Context> {
  const selectedId = process.env.POSTORCA_EVAL_USER_ID;
  const email = process.env.POSTORCA_EVAL_EMAIL;
  const result = await db.query(
    selectedId
      ? "SELECT id,timezone FROM users WHERE id=$1"
      : email
        ? "SELECT id,timezone FROM users WHERE email=$1"
        : "SELECT id,timezone FROM users",
    selectedId ? [selectedId] : email ? [email] : [],
  );
  if (result.rows.length !== 1)
    throw new Error(
      "Select one founder with POSTORCA_EVAL_EMAIL or POSTORCA_EVAL_USER_ID.",
    );
  const user = result.rows[0];
  return {
    db,
    userId: user.id,
    timezone: user.timezone ?? "Asia/Bangkok",
    token: issueToken(user.id, secret),
  };
}
async function preflight(context: Context, needsModel: boolean) {
  const health = await fetch(`${api}/health`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!health.ok) throw new Error("The API is unavailable.");
  const drift = await catalogDrift(context.db);
  if (drift.length)
    throw new Error(
      `Apply the current catalog before evaluating: ${drift.join("; ")}`,
    );
  if (needsModel) {
    const orca = orcaFromEnv(process.env);
    if (!orca)
      throw new Error("The agent model is not configured.");
    if (!imagesFromEnv(process.env) || !process.env.ELEVENLABS_API_KEY)
      throw new Error(
        "Choose an image model (IMAGE_PROVIDER, IMAGE_MODEL) and set ELEVENLABS_API_KEY before running paid cases.",
      );
    const active = await context.db.query(
      "SELECT 1 FROM turns WHERE status IN ('queued','running') LIMIT 1",
    );
    if (active.rowCount)
      throw new Error(
        "Another turn is queued/running. Finish it before starting an eval.",
      );
  }
}

async function finished(context: Context, taskId: string, after?: string) {
  const deadline = Date.now() + 45 * 60_000;
  while (Date.now() < deadline) {
    const task = await request(context, `/tasks/${taskId}`);
    const turn = task.turns.at(-1);
    if (
      turn &&
      turn.id !== after &&
      !["queued", "running"].includes(turn.status)
    )
      return turn;
    await delay(3000);
  }
  throw new Error(
    `Task ${taskId} did not finish within 45 minutes. Its outcome is unknown; do not start it again.`,
  );
}
async function startCase(
  context: Context,
  entry: VideoCase,
  report: Report,
  persist: () => Promise<void>,
) {
  if ("of" in entry.start) {
    const parent = entry.start.of;
    const found = await context.db.query(
      "SELECT id FROM tasks WHERE user_id=$1 AND title=$2 ORDER BY created_at DESC LIMIT 1",
      [
        context.userId,
        `Eval ${parent}: ${entries.find((item) => item.id === parent)!.name}`,
      ],
    );
    if (!found.rows[0])
      throw new Error(
        `Run ${parent} successfully first; ${entry.id} follows up on that work.`,
      );
    report.taskId = found.rows[0].id;
    await persist();
    const task = await request(context, `/tasks/${report.taskId}`);
    if (
      task.turns.at(-1)?.status !== "completed" ||
      !task.turns.some((turn: any) =>
        turn.artifacts.some((artifact: any) => artifact.kind === "video"),
      )
    )
      throw new Error(
        `The latest ${parent} task has no completed video to revise.`,
      );
    for (const message of entry.start.messages) {
      const previous = await finished(context, report.taskId!);
      await request(context, `/tasks/${report.taskId}/turns`, "POST", {
        message,
      });
      const turn = await finished(context, report.taskId!, previous.id);
      report.turns.push(turn);
      await persist();
      if (
        turn.status !== "completed" ||
        toolEvidence(turn.messages).some(
          (call) =>
            call.failed &&
            /quota|provider request|may already have been billed/i.test(
              String(call.result?.error),
            ),
        )
      )
        throw new Error(
          "The follow-up failed or hit a provider failure. Further paid follow-ups were not started.",
        );
    }
    return;
  }
  const routine = await request(context, "/routines", "POST", {
    title: `Eval ${entry.id}: ${entry.name}`,
    instructions: entry.start.brief,
    run_at: new Date(Date.now() + 40_000).toISOString(),
    timezone: context.timezone,
  });
  report.routineId = routine.id;
  await persist();
  const deadline = Date.now() + 10 * 60_000;
  while (Date.now() < deadline) {
    const rows = await context.db.query(
      "SELECT task_id FROM routine_runs WHERE routine_id=$1 AND task_id IS NOT NULL",
      [routine.id],
    );
    if (rows.rows[0]) {
      report.taskId = rows.rows[0].task_id;
      break;
    }
    await delay(3000);
  }
  if (!report.taskId)
    throw new Error(
      "The scheduler has not started the task within 10 minutes. The pending schedule was retained; do not duplicate it.",
    );
  await persist();
  console.log(`Task: ${report.taskId}`);
  const first = await finished(context, report.taskId);
  report.turns.push(first);
  await persist();
  if (entry.id === "M1") {
    if (
      first.status !== "completed" ||
      !first.artifacts.some((artifact: any) => artifact.kind === "image") ||
      !first.artifacts.some((artifact: any) => artifact.kind === "audio") ||
      toolEvidence(first.messages).some((call) => call.failed)
    )
      throw new Error(
        "Media creation was incomplete or had a tool failure. The paid revision was not started.",
      );
    await request(context, `/tasks/${report.taskId}/turns`, "POST", {
      message:
        "Revise the image you just made: change only the terracotta pot to blue. Preserve the green sprout, square framing and cream background. Deliver the revised image as a new artifact, keeping the original. Keep the existing speech; do not generate it again.",
    });
    report.turns.push(await finished(context, report.taskId, first.id));
    await persist();
  }
}

function binaries() {
  const suffix = process.platform === "win32" ? "-msvc" : "";
  const directory = dirname(
    require.resolve(
      `@remotion/compositor-${process.platform}-${process.arch}${suffix}/package.json`,
    ),
  );
  return {
    directory,
    path: (name: string) =>
      join(directory, name + (process.platform === "win32" ? ".exe" : "")),
  };
}
async function videoEvidence(file: string, folder: string, name: string) {
  const binary = binaries();
  const { stdout } = await runBinary(
    binary.path("ffprobe"),
    ["-v", "error", "-show_streams", "-show_format", "-of", "json", file],
    { cwd: binary.directory },
  );
  const probe = JSON.parse(stdout);
  const seconds = Number(probe.format.duration);
  const frames: string[] = [];
  for (const [index, time] of [
    0.3,
    seconds / 3,
    (seconds * 2) / 3,
    Math.max(0, seconds - 1),
  ].entries()) {
    const output = join(folder, `${name}-${index + 1}-${time.toFixed(1)}s.jpg`);
    await runBinary(
      binary.path("ffmpeg"),
      [
        "-v",
        "error",
        "-y",
        "-ss",
        String(time),
        "-i",
        file,
        "-frames:v",
        "1",
        "-q:v",
        "3",
        output,
      ],
      { cwd: binary.directory },
    );
    frames.push(output);
  }
  return { seconds, streams: probe.streams, frames };
}
async function usage(taskId: string, turnId: string) {
  const directory = turnTraceDirectory({ taskId, turnId, step: 1 });
  const files = await readdir(directory).catch(() => [] as string[]);
  const totals = { steps: 0, input: 0, cached: 0, output: 0, largestInput: 0 };
  for (const file of files.filter((name) => name.endsWith(".result.json"))) {
    const result = JSON.parse(await readFile(join(directory, file), "utf8"));
    if (!result.usage) continue;
    totals.steps++;
    totals.input += result.usage.input_tokens ?? 0;
    totals.cached += result.usage.input_tokens_details?.cached_tokens ?? 0;
    totals.output += result.usage.output_tokens ?? 0;
    totals.largestInput = Math.max(
      totals.largestInput,
      result.usage.input_tokens ?? 0,
    );
  }
  return totals;
}
async function downloadedArtifact(context: Context, artifact: EvalArtifact) {
  let metadata;
  try {
    metadata = JSON.parse(artifact.content);
  } catch {
    throw new Error("Media artifact has no structured metadata.");
  }
  if (!isUserFileKey(context.userId, metadata.file))
    throw new Error("Media artifact does not belong to the selected founder.");
  const response = await fetch(
    `${api}/files?key=${encodeURIComponent(metadata.file)}`,
    {
      headers: { Authorization: `Bearer ${context.token}` },
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok)
    throw new Error(`Saved artifact read failed: HTTP ${response.status}`);
  const downloaded = Buffer.from(await response.arrayBuffer());
  const source = await readFile(filePath(metadata.file));
  if (!downloaded.equals(source))
    throw new Error("Downloaded bytes do not match the saved file.");
  return {
    artifactId: artifact.id,
    kind: artifact.kind,
    file: metadata.file,
    bytes: source.length,
    sha256: createHash("sha256").update(source).digest("hex"),
  };
}

async function score(
  context: Context,
  entry: VideoCase,
  report: Report,
  folder: string,
) {
  const task = await request(context, `/tasks/${report.taskId}`);
  const turns = report.turns;
  const scored = [];
  for (const [index, retained] of turns.entries()) {
    const turn = task.turns.find((item: any) => item.id === retained.id);
    if (!turn) throw new Error("Retained turn is missing from task history.");
    const expected = Array.isArray(entry.expect.exports)
      ? entry.expect.exports[index]
      : entry.expect.exports;
    const result = gradeVideo(entry, turn.messages, turn.artifacts, expected);
    if (entry.id === "M1")
      result.checks = result.checks.filter((check) =>
        /^No (paid|publishing|browser)/.test(check.name),
      );
    result.checks.push({
      name: "Agent completed without requesting help",
      ok: turn.status === "completed",
      detail: turn.status,
    });
    const saved = [];
    for (const artifact of turn.artifacts.filter((item: any) =>
      ["image", "audio", "video"].includes(item.kind),
    )) {
      try {
        saved.push(await downloadedArtifact(context, artifact));
      } catch (error) {
        result.checks.push({
          name: `Artifact ${artifact.id} can be reopened/downloaded`,
          ok: false,
          detail: String(error),
        });
      }
    }
    result.checks.push({
      name: "Delivered artifacts persist and download with original bytes",
      ok:
        saved.length > 0 &&
        saved.length ===
          turn.artifacts.filter((item: any) =>
            ["image", "audio", "video"].includes(item.kind),
          ).length,
      detail: `${saved.length} validated files`,
    });
    if (entry.id === "M1") {
      if (index === 0) {
        result.checks.push({
          name: "Delivered an image and speech",
          ok:
            saved.some((item) => item.kind === "image") &&
            saved.some((item) => item.kind === "audio"),
          detail: "",
        });
        result.checks.push({
          name: "Used image and speech generation",
          ok:
            result.calls.some(
              (call) => call.name === "media_generate_image" && !call.failed,
            ) &&
            result.calls.some(
              (call) => call.name === "media_generate_speech" && !call.failed,
            ),
          detail: "",
        });
      } else {
        const original = scored[0].downloads.find(
          (item) => item.kind === "image",
        );
        const originalRef = original?.file.split("/").at(-1)?.slice(0, 8);
        result.checks.push({
          name: "Revision edits the existing image and delivers a new one",
          ok:
            !!original &&
            result.calls.some(
              (call) =>
                call.name === "media_edit_image" &&
                !call.failed &&
                [original.file, originalRef].includes(call.args.file),
            ) &&
            saved.some(
              (item) => item.kind === "image" && item.file !== original.file,
            ),
          detail: "",
        });
        result.checks.push({
          name: "Original artifact remains available unchanged",
          ok:
            !!original &&
            task.turns
              .flatMap((item: any) => item.artifacts)
              .some((item: any) => item.id === original.artifactId) &&
            createHash("sha256")
              .update(await readFile(filePath(original!.file)))
              .digest("hex") === original!.sha256,
          detail: "",
        });
        result.checks.push({
          name: "Kept existing speech without regeneration",
          ok: !result.calls.some(
            (call) => call.name === "media_generate_speech",
          ),
          detail: "",
        });
      }
    }
    const videos = [];
    for (const [position, key] of result.files.entries()) {
      if (!isUserFileKey(context.userId, key))
        throw new Error("An export is outside the selected founder's storage.");
      const target = join(folder, `t${index + 1}-v${position + 1}.mp4`);
      await copyFile(filePath(key), target);
      report.videos.push(target);
      const evidence = await videoEvidence(
        target,
        folder,
        `t${index + 1}-v${position + 1}`,
      );
      const [minimum, maximum] = entry.expect.seconds ?? [0, 90];
      const audioExpected =
        !entry.expect.music?.noVoiceover || !!entry.expect.music;
      result.checks.push({
        name: `Video ${position + 1} duration and streams`,
        ok:
          evidence.seconds >= minimum &&
          evidence.seconds <= maximum &&
          (!audioExpected ||
            evidence.streams.some(
              (stream: any) => stream.codec_type === "audio",
            )),
        detail: `${evidence.seconds.toFixed(2)} s; expected ${minimum}–${maximum} s`,
      });
      videos.push({ file: target, ...evidence });
    }
    scored.push({
      turnId: turn.id,
      status: turn.status,
      minutes:
        (new Date(turn.finished_at).getTime() -
          new Date(turn.started_at).getTime()) /
        60_000,
      ...result,
      modelUsage: await usage(report.taskId!, turn.id),
      downloads: saved,
      videos,
    });
  }
  report.results = scored;
  report.mechanicalPass =
    scored.length > 0 &&
    scored.every(
      (result) =>
        result.checks.every((check) => check.ok !== false) &&
        result.errors.length === 0,
    );
  report.acceptance =
    "Pending visual review and complete playback with sound; mechanical checks alone are not acceptance.";
  return scored;
}

function markdown(report: Report) {
  const lines = [
    `# ${report.caseId}: ${report.name}`,
    "",
    `Task: ${report.taskId ?? "not started"}`,
    `Mechanical pass: ${report.mechanicalPass ?? false}`,
    "",
    String(report.acceptance ?? ""),
    "",
  ];
  if (report.failure) lines.push(`Failure: ${report.failure}`, "");
  for (const result of (report.results ?? []) as any[]) {
    lines.push(
      `## Turn ${result.turnId}: ${result.status}`,
      "",
      `Time: ${result.minutes.toFixed(1)} min`,
      `Model usage: ${JSON.stringify(result.modelUsage)}`,
      `Paid/tool calls: ${JSON.stringify(result.usage)}`,
      "",
    );
    for (const [heading, value] of [
      ["Worked", true],
      ["Didn't work", false],
      ["Needs review", null],
    ] as const) {
      lines.push(
        `### ${heading}`,
        "",
        ...result.checks
          .filter((check: Check) => check.ok === value)
          .map(
            (check: Check) =>
              `- ${check.name}${check.detail ? `: ${check.detail}` : ""}`,
          ),
        "",
      );
    }
    lines.push(
      ...result.errors.map((error: string) => `- ${error}`),
      "",
      "Script:",
      ...result.speech.map((text: string) => `> ${text}`),
      "",
      `On-screen text: ${JSON.stringify(result.texts)}`,
      "",
      "Agent summary:",
      result.summary,
      "",
    );
  }
  return lines.join("\n");
}
async function rebuildReview() {
  const review = join(root, "review");
  await mkdir(review, { recursive: true });
  const folders = (await readdir(root))
    .filter((name) => name !== "review")
    .sort()
    .reverse();
  const seen = new Set<string>();
  for (const folder of folders) {
    const report: Report | null = await readFile(
      join(root, folder, "report.json"),
      "utf8",
    )
      .then(JSON.parse)
      .catch(() => null);
    if (
      !report ||
      !entries.some((entry) => entry.id === report.caseId) ||
      !report.videos.length ||
      seen.has(report.caseId)
    )
      continue;
    seen.add(report.caseId);
    for (const [index, video] of report.videos.entries()) {
      if (resolve(dirname(video)) !== resolve(root, folder)) continue;
      await copyFile(video, join(review, `${report.caseId}-${index + 1}.mp4`));
    }
  }
  console.log(`Latest retained videos: ${review}`);
}

export async function main(args = process.argv.slice(2)) {
  if (!args.length || args.includes("--list")) {
    for (const entry of entries)
      console.log(`${entry.id.padEnd(4)} ${entry.name}`);
    return;
  }
  if (args.includes("--review")) {
    await mkdir(root, { recursive: true });
    return rebuildReview();
  }
  const entry = entries.find((candidate) => candidate.id === args[0]);
  const preflightOnly = args[0] === "--preflight";
  if (!entry && !preflightOnly) throw new Error("Choose a case from --list.");
  const taskIndex = args.indexOf("--task");
  const existingTask = taskIndex >= 0 ? args[taskIndex + 1] : undefined;
  if (taskIndex >= 0 && !/^[0-9a-f-]{36}$/i.test(existingTask ?? ""))
    throw new Error("--task requires an existing task ID.");
  if (
    !preflightOnly &&
    args.some(
      (argument, index) =>
        index > 0 && argument !== "--task" && index !== taskIndex + 1,
    )
  )
    throw new Error(
      "Run one case at a time; inspect its report before the next.",
    );
  const config = configFromEnv();
  const db = createDatabase(config.databaseUrl);
  try {
    const context = await contextFor(db, config.jwtSecret);
    await preflight(context, !existingTask);
    if (preflightOnly) {
      console.log(
        "Preflight passed: API, catalog, account, credentials and idle agent. The agent checks desktop availability before generating assets.",
      );
      return;
    }
    await mkdir(root, { recursive: true });
    const lock = join(root, "running.lock");
    await writeFile(
      lock,
      JSON.stringify({
        pid: process.pid,
        caseId: entry!.id,
        started: new Date().toISOString(),
      }),
      { flag: "wx", mode: 0o600 },
    );
    const folder = join(
      root,
      `${entry!.id}-${new Date().toISOString().replace(/[:.]/g, "-")}`,
    );
    await mkdir(folder, { recursive: true });
    const report: Report = {
      caseId: entry!.id,
      name: entry!.name,
      entry,
      model: orcaFromEnv(process.env)?.model,
      platform: process.platform,
      started: new Date().toISOString(),
      taskId: existingTask,
      turns: [],
      videos: [],
    };
    const persist = () =>
      writeFile(join(folder, "report.json"), JSON.stringify(report, null, 2), {
        mode: 0o600,
      });
    let colors: unknown;
    try {
      report.commit = (
        await runBinary("git", ["rev-parse", "HEAD"], { cwd: repo })
      ).stdout.trim();
      report.workingChanges = (
        await runBinary("git", ["status", "--short"], { cwd: repo })
      ).stdout.trim();
      await persist();
      console.log(
        `${entry!.id}: ${existingTask ? "scoring retained task" : "starting paid case"}; evidence: ${folder}`,
      );
      if (existingTask) {
        const task = await request(context, `/tasks/${existingTask}`);
        if (
          task.turns.some((turn: any) =>
            ["queued", "running"].includes(turn.status),
          )
        )
          throw new Error("Wait for the task to finish before scoring it.");
        report.turns =
          "of" in entry!.start
            ? task.turns
                .filter((turn: any) =>
                  turn.messages.some(
                    (message: any) =>
                      message.kind === "user" &&
                      (
                        entry!.start as { messages: string[] }
                      ).messages.includes(message.content.text),
                  ),
                )
                .slice(-2)
            : task.turns;
      } else {
        if (entry!.expect.noProfileColors) {
          colors = (
            await db.query(
              "SELECT colors FROM brand_profiles WHERE user_id=$1",
              [context.userId],
            )
          ).rows[0].colors;
          await db.query(
            "UPDATE brand_profiles SET colors='{}' WHERE user_id=$1",
            [context.userId],
          );
        }
        await startCase(context, entry!, report, persist);
      }
      await score(context, entry!, report, folder);
    } catch (error) {
      report.failure =
        error instanceof Error ? error.message : "Evaluation failed.";
      process.exitCode = 1;
    } finally {
      try {
        if (colors !== undefined)
          await db.query(
            "UPDATE brand_profiles SET colors=$2 WHERE user_id=$1",
            [context.userId, colors],
          );
        report.finished = new Date().toISOString();
        await persist();
        await writeFile(join(folder, "report.md"), markdown(report));
      } finally {
        await rm(lock, { force: true });
      }
    }
    console.log(markdown(report));
    console.log(`Report: ${join(folder, "report.md")}`);
    if (report.mechanicalPass === false) process.exitCode = 1;
  } finally {
    await db.end();
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
