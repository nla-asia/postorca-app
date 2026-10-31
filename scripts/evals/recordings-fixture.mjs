/** Recordings fixture for the editing evals: the founder's screen recordings are given,
 * so the agent edits rather than records.
 *
 * Copies the pinned clips from fixtures/evals/recordings/<set> into the founder's
 * working folder (eval-fixtures/<set>-recordings/), where the brief names them, and
 * removes them afterwards. Set POSTORCA_WORKING_FOLDER when the desktop uses a folder
 * other than ~/Documents/PostOrca.
 *
 *   node recordings-fixture.mjs prepare <set> <attempt>  copy the clips in
 *   node recordings-fixture.mjs observe <set> <attempt>  report whether they are unchanged
 *   node recordings-fixture.mjs cleanup <set> <attempt>  remove the copies this attempt made
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, readdir, rm, rmdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const [mode, set, attempt] = process.argv.slice(2);
const source = fileURLToPath(new URL(`../../fixtures/evals/recordings/${set}/`, import.meta.url));
const parent = join(process.env.POSTORCA_WORKING_FOLDER ?? join(homedir(), "Documents", "PostOrca"), "eval-fixtures");
const folder = join(parent, `${set}-recordings`);
const sha = async (file) => createHash("sha256").update(await readFile(file)).digest("hex");
const clips = async () => (await readdir(source)).filter((name) => name.endsWith(".mp4")).sort();

async function prepare() {
  if (existsSync(folder)) throw new Error(`${folder} already exists; it was left unchanged.`);
  await mkdir(folder, { recursive: true });
  for (const name of await clips()) await copyFile(join(source, name), join(folder, name));
  await writeFile(join(attempt, "recordings-fixture.json"), JSON.stringify({ folder }));
  return { folder, clips: await clips() };
}

async function observe() {
  for (const name of await clips())
    if (!existsSync(join(folder, name)) || (await sha(join(folder, name))) !== (await sha(join(source, name))))
      return { unchanged: false, changed: name };
  return { unchanged: true };
}

async function cleanup() {
  if (!existsSync(join(attempt, "recordings-fixture.json"))) return { removed: false, reason: "This attempt copied nothing." };
  await rm(folder, { recursive: true, force: true });
  if (existsSync(parent) && !(await readdir(parent)).length) await rmdir(parent);
  return { removed: true };
}

if (set && ["prepare", "observe", "cleanup"].includes(mode))
  ({ prepare, observe, cleanup })[mode]().then(
    (result) => console.log(JSON.stringify(result)),
    (error) => {
      console.error(error.message);
      process.exit(1);
    },
  );
