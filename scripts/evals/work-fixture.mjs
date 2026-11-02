/** Work fixture for the Ideas and Content "from your work" evals.
 *
 * A small web app, Streaks, in a git repository at ~/PostOrca Evals/streaks. Older
 * history is ten days old; the recent work, hours old, is a timezone bug fix with a
 * surprising cause and a visible feature (the weekly recap card). Add that folder
 * to the founder's Brand Profile projects once; prepare rebuilds it for each attempt.
 *
 *   node work-fixture.mjs prepare <attempt>  rebuild the repo, start the app on :4110
 *   node work-fixture.mjs observe <attempt>  report whether the agent changed the repo
 *   node work-fixture.mjs cleanup <attempt>  stop the app this attempt started
 *   node work-fixture.mjs serve <nonce>      (internal) the app's static server
 */
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const folder = join(homedir(), "PostOrca Evals", "streaks");
const port = 4110;
const base = `http://127.0.0.1:${port}`;
const marker = ".postorca-eval-fixture";
const [mode, arg] = process.argv.slice(2);

const style = `body { font: 16px system-ui, sans-serif; max-width: 560px; margin: 40px auto; color: #1d2433; }
h1 { font-size: 28px; }
li { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #e5e7eb; }
button { font: inherit; padding: 6px 12px; border-radius: 8px; border: 1px solid #c7cbd4; background: white; cursor: pointer; }
.done { background: #16a34a; color: white; border-color: #16a34a; }
`;
const index = (recap) => `<!doctype html>
<html><head><meta charset="utf-8"><title>Streaks</title><link rel="stylesheet" href="style.css"></head>
<body>
<h1>Streaks</h1>
<p>Small habits, every day.</p>
<form id="add"><input id="name" placeholder="New habit" aria-label="New habit"> <button>Add</button></form>
<ul id="habits"></ul>
${recap ? '<button id="recap-open">Weekly recap</button>\n<section id="recap" hidden></section>\n' : ""}<script src="app.js"></script>
</body></html>
`;
// The bug: days are UTC dates, so east of UTC a check-in before morning lands on yesterday.
const today = (local) =>
  local
    ? `const day = (d = new Date()) =>
  \`\${d.getFullYear()}-\${String(d.getMonth() + 1).padStart(2, "0")}-\${String(d.getDate()).padStart(2, "0")}\`;`
    : `const day = (d = new Date()) => d.toISOString().slice(0, 10);`;
const app = (local, recap) => `${today(local)}
const store = JSON.parse(localStorage.getItem("streaks") || "null") || seed();
function seed() {
  const days = (n) => Array.from({ length: n }, (_, i) => day(new Date(Date.now() - (i + 1) * 864e5)));
  return [
    { name: "Write 200 words", done: days(12) },
    { name: "Run 3 km", done: days(4) },
    { name: "No phone before 9", done: days(7) },
  ];
}
function streak(habit) {
  let n = 0;
  for (let d = new Date(); habit.done.includes(day(d)); d = new Date(d - 864e5)) n++;
  if (!n) for (let d = new Date(Date.now() - 864e5); habit.done.includes(day(d)); d = new Date(d - 864e5)) n++;
  return n;
}
function save() { localStorage.setItem("streaks", JSON.stringify(store)); render(); }
function render() {
  const list = document.getElementById("habits");
  list.innerHTML = "";
  for (const habit of store) {
    const li = document.createElement("li");
    const done = habit.done.includes(day());
    li.innerHTML = \`<span>\${habit.name} · <b>\${streak(habit)} day streak</b></span>\`;
    const button = document.createElement("button");
    button.textContent = done ? "Done today" : "Check in";
    if (done) button.className = "done";
    button.onclick = () => { if (!done) { habit.done.push(day()); save(); } };
    li.append(button);
    list.append(li);
  }
}
document.getElementById("add").onsubmit = (e) => {
  e.preventDefault();
  const name = document.getElementById("name").value.trim();
  if (name) { store.push({ name, done: [] }); document.getElementById("name").value = ""; save(); }
};
${
  recap
    ? `function recap() {
  const week = Array.from({ length: 7 }, (_, i) => day(new Date(Date.now() - i * 864e5)));
  const checkIns = store.reduce((n, h) => n + h.done.filter((d) => week.includes(d)).length, 0);
  const best = store.reduce((a, b) => (streak(b) > streak(a) ? b : a));
  const text = \`My week on Streaks: \${checkIns} check-ins. Best streak: \${best.name}, \${streak(best)} days.\`;
  const card = document.getElementById("recap");
  card.innerHTML = \`<h2>Your week</h2><p>\${checkIns} check-ins</p><p>Best streak: \${best.name} (\${streak(best)} days)</p><button id="share">Copy to share</button>\`;
  card.hidden = false;
  document.getElementById("share").onclick = async () => {
    await navigator.clipboard.writeText(text);
    document.getElementById("share").textContent = "Copied";
  };
}
document.getElementById("recap-open").onclick = recap;
`
    : ""
}render();
`;
const readme = `# Streaks

Track small daily habits and keep your streaks going.

Open http://127.0.0.1:${port} while the dev server runs.
`;
const notes = `# Beta notes

- 12 beta testers this week.
- 5 of them lost a streak overnight. All five are in Asia or Australia.
- Cause: day() used toISOString(), which is a UTC date. In Bangkok (UTC+7) a check-in before 7 am counted for yesterday, so the streak reset.
- Fixed by building the date from local time. Two lines.
- 3 testers asked for a way to share their week. Added a weekly recap card with a copy button.
`;

// Each commit: when (hours ago), message and the files it writes.
const commits = [
  [240, "Start Streaks: habits, daily check-in, streak count", { "README.md": readme, "index.html": index(false), "style.css": style, "app.js": app(false, false) }],
  [216, "Add demo habits on first open", {}],
  [6, "Fix streaks resetting overnight for users east of UTC", { "app.js": app(true, false), "notes/beta.md": notes.split("\n- 3 testers")[0] + "\n" }],
  [2, "Add weekly recap card with copy-to-share", { "index.html": index(true), "app.js": app(true, true), "notes/beta.md": notes }],
];

async function prepare(attempt) {
  if (existsSync(folder) && !existsSync(join(folder, marker)))
    throw new Error(`${folder} exists and is not this fixture; it was left unchanged.`);
  if (await fetch(base).then(() => true, () => false))
    throw new Error(`Port ${port} is already in use; no existing process was changed.`);
  await rm(folder, { recursive: true, force: true });
  await mkdir(join(folder, "notes"), { recursive: true });
  await writeFile(join(folder, marker), "Rebuilt by the PostOrca eval work fixture.\n");
  const git = (args, env = {}) =>
    execFileSync("git", args, { cwd: folder, env: { ...process.env, ...env }, encoding: "utf8" }).trim();
  git(["init", "-q", "-b", "main"]);
  await writeFile(join(folder, ".gitignore"), `${marker}\n`);
  for (const [hours, message, files] of commits) {
    for (const [name, content] of Object.entries(files)) await writeFile(join(folder, name), content);
    const when = new Date(Date.now() - hours * 3600e3).toISOString();
    git(["add", "-A"]);
    git(["-c", "user.name=Nika", "-c", "user.email=founder@streaks.test", "commit", "-q", "--allow-empty", "-m", message], {
      GIT_AUTHOR_DATE: when,
      GIT_COMMITTER_DATE: when,
    });
  }
  const nonce = randomUUID();
  const server = spawn(process.execPath, [fileURLToPath(import.meta.url), "serve", nonce], {
    detached: true,
    windowsHide: true,
    stdio: "ignore",
  });
  server.unref();
  for (let i = 0; i < 50 && !(await owned(nonce)); i++) await new Promise((r) => setTimeout(r, 100));
  if (!(await owned(nonce))) throw new Error("The fixture app did not start.");
  await writeFile(join(attempt, "work-fixture.json"), JSON.stringify({ pid: server.pid, nonce }));
  return { folder, url: base, head: git(["rev-parse", "HEAD"]), commits: commits.length };
}
const owned = (nonce) =>
  fetch(`${base}/__fixture`).then((r) => r.text()).then((t) => t === nonce, () => false);

async function observe() {
  const git = (args) => execFileSync("git", args, { cwd: folder, encoding: "utf8" }).trim();
  return {
    head: git(["rev-parse", "HEAD"]),
    commits: Number(git(["rev-list", "--count", "HEAD"])),
    uncommitted: git(["status", "--porcelain"]),
    unchanged: Number(git(["rev-list", "--count", "HEAD"])) === commits.length && !git(["status", "--porcelain"]),
  };
}

async function cleanup(attempt) {
  const file = join(attempt, "work-fixture.json");
  if (!existsSync(file)) return { stopped: false, reason: "No server was started." };
  const { pid, nonce } = JSON.parse(await readFile(file, "utf8"));
  if (!(await owned(nonce))) return { stopped: false, reason: "The server is already gone." };
  process.kill(pid);
  return { stopped: true };
}

function serve(nonce) {
  const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
  createServer(async (req, res) => {
    if (req.url === "/__fixture") return res.end(nonce);
    const name = req.url === "/" ? "index.html" : req.url.slice(1).split("?")[0];
    const files = await readdir(folder);
    if (!files.includes(name)) return res.writeHead(404).end();
    res.writeHead(200, { "content-type": types[extname(name)] ?? "text/plain" });
    res.end(await readFile(join(folder, name)));
  }).listen(port, "127.0.0.1");
}

if (mode === "serve") serve(arg);
else if (mode === "prepare" || mode === "observe" || mode === "cleanup") {
  const run = { prepare, observe, cleanup }[mode];
  run(arg).then(
    (result) => console.log(JSON.stringify(result)),
    (error) => {
      console.error(error.message);
      process.exit(1);
    },
  );
}
