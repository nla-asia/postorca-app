/** A small Expo mobile product for both web and Simulator demo evals.
 * setup installs dependencies once; prepare resets only this owned fixture and
 * starts Metro. It never starts a PostOrca task or a paid eval.
 *
 * node scripts/evals/packlight-fixture.mjs setup
 * node scripts/evals/packlight-fixture.mjs prepare <attempt-folder>
 * node scripts/evals/packlight-fixture.mjs observe <attempt-folder>
 * node scripts/evals/packlight-fixture.mjs cleanup <attempt-folder>
 */
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, openSync, closeSync } from "node:fs";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const folder = join(homedir(), "PostOrca Evals", "packlight");
const source = fileURLToPath(new URL("./fixtures/packlight/", import.meta.url));
const marker = ".postorca-eval-fixture";
const dependencies = ".postorca-dependencies";
const port = 4140;
const url = `http://127.0.0.1:${port}`;
const [mode, argument] = process.argv.slice(2);
const git = (...args) =>
  execFileSync("git", args, { cwd: folder, encoding: "utf8" }).trim();
const lockHash = async () =>
  createHash("sha256")
    .update(await readFile(join(source, "package-lock.json")))
    .digest("hex");

async function scaffold() {
  if (
    existsSync(folder) &&
    (!existsSync(join(folder, marker)) ||
      (await readFile(join(folder, marker), "utf8")).trim() !== "packlight")
  )
    throw new Error(
      `${folder} is not an owned Packlight fixture; it was left unchanged.`,
    );
  await mkdir(folder, { recursive: true });
  for (const entry of await readdir(folder)) {
    if (!["node_modules", dependencies].includes(entry))
      await rm(join(folder, entry), { recursive: true, force: true });
  }
  await cp(source, folder, {
    recursive: true,
    filter: (path) =>
      !["node_modules", ".expo", "dist", "dist-ios", ".git"].includes(
        path.slice(path.lastIndexOf("/") + 1),
      ),
  });
  await writeFile(join(folder, marker), "packlight\n");
  git("init", "-q", "-b", "main");
  await writeFile(
    join(folder, ".git", "info", "exclude"),
    `${marker}\n${dependencies}\n`,
  );
  git("add", "-A");
  git(
    "-c",
    "user.name=PostOrca fixture",
    "-c",
    "user.email=fixtures@postorca.test",
    "commit",
    "-qm",
    "Scaffold Packlight: trips, packing progress and native sharing",
  );
}
function ownedProcess(pid) {
  try {
    return execFileSync("ps", ["-p", String(pid), "-o", "command="], {
      encoding: "utf8",
    }).includes(join(folder, "node_modules", "expo", "bin", "cli"));
  } catch {
    return false;
  }
}
async function setup() {
  // Do not reset a fixture while a previous Metro is using it.
  await assertPortFree();
  await scaffold();
  execFileSync("npm", ["ci", "--no-audit", "--no-fund"], {
    cwd: folder,
    stdio: ["ignore", process.stderr, process.stderr],
  });
  await writeFile(join(folder, dependencies), await lockHash());
  return {
    folder,
    url,
    installed: true,
    simulator:
      "Run npm run ios -- --port 4140 here once to install/open a compatible Expo Go.",
  };
}
async function assertPortFree() {
  const net = await import("node:net");
  const server = net.createServer();
  await new Promise((accept, reject) => {
    server.once("error", () =>
      reject(
        new Error(
          `Port ${port} is in use; clean up its current fixture first.`,
        ),
      ),
    );
    server.listen(port, "127.0.0.1", accept);
  });
  await new Promise((resolve) => server.close(resolve));
}
async function prepare(attempt) {
  if (!attempt) throw new Error("Supply an attempt folder.");
  attempt = resolve(attempt);
  if (
    !existsSync(join(folder, "node_modules", "expo", "bin", "cli")) ||
    !existsSync(join(folder, dependencies)) ||
    (await readFile(join(folder, dependencies), "utf8")) !== (await lockHash())
  )
    throw new Error(
      "Run node scripts/evals/packlight-fixture.mjs setup first; dependencies are missing or changed.",
    );
  await assertPortFree();
  await scaffold();
  await mkdir(attempt, { recursive: true });
  const log = openSync(join(attempt, "packlight-metro.log"), "a");
  const child = spawn(
    process.execPath,
    [
      join(folder, "node_modules", "expo", "bin", "cli"),
      "start",
      "--web",
      "--localhost",
      "--port",
      String(port),
      "--clear",
    ],
    {
      cwd: folder,
      detached: true,
      stdio: ["ignore", log, log],
      env: { ...process.env, CI: "1", BROWSER: "none", EXPO_NO_TELEMETRY: "1" },
    },
  );
  closeSync(log);
  child.unref();
  await writeFile(
    join(attempt, "packlight-fixture.json"),
    JSON.stringify({ pid: child.pid, url, folder }),
  );
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (response.ok) {
        // Like a founder's app already open on their iPhone: open it in a booted
        // Simulator with Expo Go, if there is one. A web video case is an app that
        // only runs as a web page, so there it is closed instead.
        const demo = await readFile(join(attempt, "case.json"), "utf8").then((c) => JSON.parse(c).demo, () => null);
        const webOnly = demo?.app === "web" && !!demo?.video;
        let simulator = "none booted";
        try {
          if (webOnly) {
            execFileSync("xcrun", ["simctl", "terminate", "booted", "host.exp.Exponent"], { stdio: "ignore" });
            simulator = "Expo Go closed: web only";
          } else {
            execFileSync("xcrun", ["simctl", "openurl", "booted", "exp://127.0.0.1:4140"], { stdio: "ignore" });
            simulator = "opened exp://127.0.0.1:4140";
          }
        } catch {}
        return {
          folder,
          url,
          head: git("rev-parse", "HEAD"),
          reset: "fresh in-memory sample trips",
          simulator,
        };
      }
    } catch {}
    if (!ownedProcess(child.pid))
      throw new Error("Packlight Metro exited; see packlight-metro.log.");
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  await cleanup(attempt);
  throw new Error(
    "Packlight Metro did not become ready; see packlight-metro.log.",
  );
}
async function observe() {
  const uncommitted = git("status", "--porcelain");
  return {
    folder,
    head: git("rev-parse", "HEAD"),
    uncommitted,
    unchanged: !uncommitted,
  };
}
async function cleanup(attempt) {
  const state = join(resolve(attempt), "packlight-fixture.json");
  if (!existsSync(state))
    return { stopped: false, reason: "No Metro was started by this attempt." };
  const { pid } = JSON.parse(await readFile(state, "utf8"));
  if (!ownedProcess(pid))
    return {
      stopped: false,
      reason: "This attempt’s Metro is already stopped.",
    };
  process.kill(-pid, "SIGTERM");
  return { stopped: true };
}
if (["setup", "prepare", "observe", "cleanup"].includes(mode)) {
  ({ setup, prepare, observe, cleanup })[mode](argument).then(
    (result) => console.log(JSON.stringify(result)),
    (error) => {
      console.error(error.message);
      process.exitCode = 1;
    },
  );
}
