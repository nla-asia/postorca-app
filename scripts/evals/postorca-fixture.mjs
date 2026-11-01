/** PostOrca fixture for the code-to-script evals: PostOrca's own repository, frozen at a
 * commit in ~/PostOrca Evals/postorca, with its full history.
 *
 * A real product, far larger than the other fixtures: an agent, an Inbox, a Calendar,
 * routines, a Brand Profile, connectors, a browser extension, credits and plans. The
 * repository also holds plenty that viewers should never hear about: eval docs, the git
 * workflow, credit economics and model providers. The commit predates this eval, so the
 * eval's own criteria aren't in it. The running app is the dev desktop itself; nothing
 * is recorded. Add that folder to the founder's Brand Profile projects once; prepare
 * rebuilds it.
 *
 *   node postorca-fixture.mjs prepare <attempt>  rebuild the repo at the pinned commit
 *   node postorca-fixture.mjs observe <attempt>  report whether the agent changed the repo
 *   node postorca-fixture.mjs cleanup <attempt>  nothing to stop
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const folder = join(homedir(), "PostOrca Evals", "postorca");
// develop after "Content scripts: written for the public, as the product's owner" (#93).
const commit = "77686bc5aa8ded8c0bbfeabb0580c22270d75e4c";
const source = fileURLToPath(new URL("../..", import.meta.url));
const marker = ".postorca-eval-fixture";
const [mode, arg] = process.argv.slice(2);

const git = (args, cwd = folder) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

async function prepare() {
  if (existsSync(folder) && !existsSync(join(folder, marker)))
    throw new Error(`${folder} exists and is not this fixture; it was left unchanged.`);
  git(["cat-file", "-e", `${commit}^{commit}`], source);
  await rm(folder, { recursive: true, force: true });
  await mkdir(folder, { recursive: true });
  git(["init", "-q", "-b", "main"]);
  git(["fetch", "-q", "--no-tags", source, commit]);
  git(["reset", "-q", "--hard", commit]);
  // Nothing newer than the pinned commit stays in the repository.
  await rm(join(folder, ".git", "FETCH_HEAD"), { force: true });
  git(["reflog", "expire", "--expire=now", "--all"]);
  git(["gc", "-q", "--prune=now"]);
  await writeFile(join(folder, marker), "Rebuilt by the PostOrca eval fixture.\n");
  await writeFile(join(folder, ".git", "info", "exclude"), `${marker}\n`);
  return { folder, head: git(["rev-parse", "HEAD"]), commits: Number(git(["rev-list", "--count", "HEAD"])) };
}

async function observe() {
  const head = git(["rev-parse", "HEAD"]);
  const uncommitted = git(["status", "--porcelain"]);
  return { head, uncommitted, unchanged: head === commit && !uncommitted };
}

const cleanup = async () => ({ stopped: false, reason: "No server was started." });

if (mode === "prepare" || mode === "observe" || mode === "cleanup") {
  const run = { prepare, observe, cleanup }[mode];
  run(arg).then(
    (result) => console.log(JSON.stringify(result)),
    (error) => {
      console.error(error.message);
      process.exit(1);
    },
  );
}
