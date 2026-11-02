/** Music fixture for media evals that test mixing, not finding music.
 *
 * Copies the pinned track from fixtures/evals/music into the founder's working folder
 * (eval-fixtures/), where the brief names it, and removes it afterwards. Set
 * POSTORCA_WORKING_FOLDER when the desktop uses a folder other than ~/Documents/PostOrca.
 *
 *   node music-fixture.mjs prepare <attempt>  copy the track in
 *   node music-fixture.mjs observe <attempt>  report whether the track is unchanged
 *   node music-fixture.mjs cleanup <attempt>  remove the copy this attempt made
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, readdir, rm, rmdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const track = "sleepy-cat-lofi.mp3";
const source = fileURLToPath(new URL(`../../fixtures/evals/music/${track}`, import.meta.url));
const folder = join(
  process.env.POSTORCA_WORKING_FOLDER ?? join(homedir(), "Documents", "PostOrca"),
  "eval-fixtures",
);
const target = join(folder, track);
const sha = async (file) => createHash("sha256").update(await readFile(file)).digest("hex");
const [mode, attempt] = process.argv.slice(2);

async function prepare() {
  if (existsSync(target)) throw new Error(`${target} already exists; it was left unchanged.`);
  await mkdir(folder, { recursive: true });
  await copyFile(source, target);
  await writeFile(join(attempt, "music-fixture.json"), JSON.stringify({ target }));
  return { track: target, sha256: await sha(target) };
}

async function observe() {
  return { unchanged: existsSync(target) && (await sha(target)) === (await sha(source)) };
}

async function cleanup() {
  const owned = join(attempt, "music-fixture.json");
  if (!existsSync(owned)) return { removed: false, reason: "This attempt copied nothing." };
  await rm(target, { force: true });
  if (existsSync(folder) && !(await readdir(folder)).length) await rmdir(folder);
  return { removed: true };
}

if (["prepare", "observe", "cleanup"].includes(mode))
  ({ prepare, observe, cleanup })[mode]().then(
    (result) => console.log(JSON.stringify(result)),
    (error) => {
      console.error(error.message);
      process.exit(1);
    },
  );
