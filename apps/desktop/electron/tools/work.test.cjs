const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { git_activity, recent_files } = require("./work.cjs");
const { read_file } = require("./files.cjs");

test("git_activity and recent_files read only project folders and leave secrets out", async (t) => {
  const repo = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "postorca-repo-")));
  const outside = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "postorca-outside-")));
  t.after(async () => {
    await fs.rm(repo, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  });
  const git = (...args) =>
    execFileSync("git", ["-c", "user.name=Founder", "-c", "user.email=f@example.com", ...args], { cwd: repo });
  git("init", "-q", "-b", "main");
  await fs.writeFile(path.join(repo, "app.ts"), "export const answer = 42;\n");
  await fs.writeFile(path.join(repo, ".env"), "API_KEY=do-not-read\n");
  await fs.writeFile(path.join(repo, "package-lock.json"), "{}\n");
  git("add", "-f", ".");
  git("commit", "-q", "-m", "Fix the half-emoji crash", "-m", "Lone surrogates broke the save.");
  await fs.writeFile(path.join(repo, "notes.md"), "# Plan\n");
  await fs.mkdir(path.join(repo, "node_modules"));
  await fs.writeFile(path.join(repo, "node_modules", "dep.js"), "x\n");
  const roots = [repo];

  const activity = await git_activity.run({ path: repo, roots });
  assert.equal(activity.branch, "main");
  assert.equal(activity.commits.length, 1);
  const [commit] = activity.commits;
  assert.equal(commit.message, "Fix the half-emoji crash\n\nLone surrogates broke the save.");
  assert.deepEqual(commit.files.map((f) => f.file).sort(), ["app.ts", "package-lock.json"]);
  assert.deepEqual(activity.uncommitted.files.map((f) => [f.file, f.change]).sort(), [
    ["node_modules/dep.js", "new"],
    ["notes.md", "new"],
  ]);
  // Nothing since a later time.
  const later = await git_activity.run({ path: repo, since: new Date(Date.now() + 60_000).toISOString(), roots });
  assert.equal(later.commits.length, 0);

  const shown = await git_activity.run({ path: repo, commit: commit.hash, roots });
  assert.match(shown.commit.changes, /answer = 42/);
  assert.doesNotMatch(shown.commit.changes, /do-not-read|API_KEY/);
  assert.doesNotMatch(shown.commit.changes, /package-lock/);
  await assert.rejects(git_activity.run({ path: repo, commit: "--all", roots }), /commit hash/);

  const recent = await recent_files.run({ path: repo, hours: 1, roots });
  assert.deepEqual(recent.files.map((f) => f.file).sort(), ["app.ts", "notes.md", "package-lock.json"]);

  // Outside the project folders, and secrets inside them, are refused.
  await assert.rejects(git_activity.run({ path: outside, roots }), /Not in the working folder or a project folder/);
  await assert.rejects(recent_files.run({ path: outside, roots }), /Not in the working folder or a project folder/);
  await assert.rejects(read_file.run({ path: path.join(repo, ".env"), roots }, {}), /secrets/);
  assert.match((await read_file.run({ path: path.join(repo, "app.ts"), roots }, {})).text, /answer/);
  await assert.rejects(git_activity.run({ path: repo, roots: [] }), /Not in the working folder or a project folder|No working folder or project folder/);
});
