import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const entry = fileURLToPath(new URL("./fixtures/computer-eval.ts", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const apiRoot = fileURLToPath(new URL("../", import.meta.url));

async function fixture() {
  const folder = await mkdtemp(join(tmpdir(), "postorca-computer-eval-"));
  return {
    folder,
    run: (args: string[], overrides: NodeJS.ProcessEnv = {}, cwd = repoRoot) => exec(process.execPath, ["--import", "tsx", entry, ...args], {
      // Exercise paths independently of npm's workspace working directory.
      cwd,
      env: {
        ...process.env,
        POSTORCA_TEST_EVAL_DIR: folder,
        OPENAI_API_KEY: "",
        OPENAI_MODEL: "",
        META_MODEL_API_KEY: "",
        META_MODEL: "",
        ORCA_PROVIDER: "",
        DATABASE_URL: "",
        JWT_SECRET: "",
        ...overrides,
      },
      timeout: 15_000,
    }),
    async close() {
      assert.equal(dirname(resolve(folder)), resolve(tmpdir()));
      assert.ok(basename(folder).startsWith("postorca-computer-eval-"));
      await rm(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    },
  };
}

test("eval list/status work without credentials from outside the API workspace", async () => {
  const f = await fixture();
  try {
    for (const mode of ["list", "status"]) {
      const result = await f.run([mode]);
      const rows = result.stdout.trim().split(/\r?\n/).map((line) => JSON.parse(line));
      assert.deepEqual(rows.map((row) => row.id), ["calculator", "notepad", "chatgpt", "edge-google"]);
      assert.ok(rows.every((row) => row.consecutive_passes === 0 && row.required === 3));
    }
    assert.deepEqual(await readdir(f.folder), []);
  } finally { await f.close(); }
});

test("live eval preflight refuses skipped gates and missing models before creating a run", async () => {
  const f = await fixture();
  try {
    await assert.rejects(f.run(["run", "notepad"]), (error: any) => {
      assert.match(error.stderr, /calculator needs three consecutive passes/);
      return true;
    });
    await assert.rejects(f.run(["run", "calculator"]), (error: any) => {
      assert.match(error.stderr, /Configure the existing internal-agent model\/key first/);
      return true;
    });
    if (process.platform === "win32")
      await assert.rejects(f.run(["run", "calculator"], {
        OPENAI_API_KEY: "test-key-never-used", OPENAI_MODEL: "test-model",
      }), (error: any) => {
        assert.match(error.stderr, /Invalid API configuration/);
        return true;
      });
    assert.deepEqual(await readdir(f.folder), []);
  } finally { await f.close(); }
});

test("regrading retains the original verdict and cannot replace missing app evidence with a claimed answer", async () => {
  const f = await fixture();
  try {
    const original = {
      turnId: "test-turn", final: "907", verdict: "passed", manualReview: false,
      observed: {}, checks: [
        { name: "Control released when turn finished", passed: true },
        { name: "Runtime unchanged during the run", passed: true },
      ],
    };
    const state = [{ caseId: "calculator", fingerprint: "old", verdict: "passed", folder: f.folder }];
    const { computerCase } = await import("../src/evals/computer-cases.js");
    for (const [file, data] of Object.entries({
      "state.json": state,
      "run.json": {
        platform: "win32", entry: computerCase("calculator", 1, "test"),
        hashes: {}, model: "test-model", fingerprint: "old",
      },
      "calls.json": [],
      "evidence.json": { turns: [{ id: "test-turn", status: "completed", artifacts: [] }] },
      "result.json": original,
    })) await writeFile(join(f.folder, file), JSON.stringify(data));
    await f.run(["regrade", relative(repoRoot, f.folder)], {}, apiRoot);
    assert.deepEqual(JSON.parse(await readFile(join(f.folder, "result.original.json"), "utf8")), original);
    const result = JSON.parse(await readFile(join(f.folder, "result.json"), "utf8"));
    assert.equal(result.verdict, "failed");
    assert.equal(result.regrade.noAgentExecution, true);
    assert.equal(JSON.parse(await readFile(join(f.folder, "state.json"), "utf8"))[0].verdict, "failed");
  } finally { await f.close(); }
});

test("observer review cannot override mechanical failure and records an explicit failed review", async () => {
  const f = await fixture();
  try {
    const resultFile = join(f.folder, "result.json");
    await writeFile(join(f.folder, "state.json"), JSON.stringify([
      { caseId: "edge-google", fingerprint: "test-runtime", verdict: "needs_review", folder: f.folder },
    ]));
    await writeFile(resultFile, JSON.stringify({
      caseId: "edge-google", manualReview: true, verdict: "needs_review",
      checks: [{ name: "Results independently verified", passed: false }],
    }));
    await assert.rejects(f.run(["review", f.folder, "passed", "Looks plausible"]), (error: any) => {
      assert.match(error.stderr, /Mechanical failures cannot be overridden/);
      return true;
    });
    assert.equal(JSON.parse(await readFile(resultFile, "utf8")).verdict, "needs_review");
    await f.run(["review", relative(repoRoot, f.folder), "failed", "The results page was not verified"], {}, apiRoot);
    const result = JSON.parse(await readFile(resultFile, "utf8"));
    assert.equal(result.verdict, "failed");
    assert.equal(result.review.reason, "The results page was not verified");
    assert.equal(JSON.parse(await readFile(join(f.folder, "state.json"), "utf8"))[0].verdict, "failed");
  } finally { await f.close(); }
});
