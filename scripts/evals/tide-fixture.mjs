/** Tide fixture for the commit-to-demo eval: a small, good-looking web todo app in a git
 * repository at ~/PostOrca Evals/tide, with three weeks of real commit history.
 *
 * The recent work is deliberately mixed. Quick add (type a sentence, get a dated task)
 * is the moment worth a demo; the two-tab sync fix is a story for a text post; a
 * refactor and a dependency bump are not content. notes/beta.md says what testers asked.
 * Add that folder to the founder's Brand Profile projects once; prepare rebuilds it.
 *
 *   node tide-fixture.mjs prepare <attempt>  rebuild the repo, start the app on :4120
 *   node tide-fixture.mjs observe <attempt>  report whether the agent changed the repo
 *   node tide-fixture.mjs cleanup <attempt>  stop the app this attempt started
 *   node tide-fixture.mjs serve <nonce>      (internal) the app's static server
 */
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const folder = join(homedir(), "PostOrca Evals", "tide");
const port = 4120;
const base = `http://127.0.0.1:${port}`;
const marker = ".postorca-eval-fixture";
const [mode, arg] = process.argv.slice(2);

const readme = `# Tide

A calm todo app for people with too many tabs open.

Open http://127.0.0.1:${port} while the dev server runs. Open /?reset to restore the sample tasks.
`;
const earlyNotes = `# Beta notes

- 9 beta testers this month.
- 6 of them said adding a task takes too many clicks: title, then date picker, then project.
`;
const syncNotes = `${earlyNotes}- 2 testers lost edits with Tide open in two tabs. The tab that saved last overwrote the other.
`;
const allNotes = `${syncNotes}- Added quick add: type one sentence, and the date, time and project are read from it.
- First tester to try it added 11 tasks in a row without touching the mouse.
`;

const style = (colors) => `:root {
  --ink: #16212e; --soft: #5d6b7a; --line: #e6ebf0; --page: #f6f8fa; --card: #fff;
  --accent: #0e7c86; --accent-soft: #e0f3f4; --late: #c2410c;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--page); color: var(--ink); font: 17px/1.45 -apple-system, "Segoe UI", system-ui, sans-serif; }
#shell { display: grid; grid-template-columns: 240px minmax(0, 720px); gap: 40px; max-width: 1040px; margin: 0 auto; padding: 48px 32px; }
.logo { font-size: 26px; font-weight: 700; color: var(--accent); letter-spacing: -0.02em; margin: 0 0 24px; }
nav button { display: flex; justify-content: space-between; width: 100%; padding: 10px 14px; border: 0; border-radius: 10px; background: none; font: inherit; color: var(--soft); cursor: pointer; }
nav button.on { background: var(--accent-soft); color: var(--accent); font-weight: 600; }
h1 { font-size: 32px; letter-spacing: -0.02em; margin: 0 0 20px; }
form.add { display: flex; gap: 10px; flex-wrap: wrap; background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 14px; margin-bottom: 8px; }
form.add input[type="text"] { flex: 1; min-width: 220px; border: 0; outline: 0; font: inherit; font-size: 19px; background: none; color: var(--ink); }
form.add select, form.add input[type="date"], form.add button { font: inherit; border: 1px solid var(--line); border-radius: 9px; padding: 7px 11px; background: var(--card); color: var(--ink); }
form.add button { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; cursor: pointer; }
#chips { display: flex; gap: 8px; min-height: 34px; padding: 4px 2px 12px; flex-wrap: wrap; }
.chip { padding: 3px 11px; border-radius: 999px; font-size: 15px; font-weight: 600; background: var(--accent-soft); color: var(--accent); animation: pop .18s ease-out; }
@keyframes pop { from { transform: scale(.8); opacity: 0; } }
ul { list-style: none; margin: 0; padding: 0; }
li.task { display: flex; align-items: center; gap: 14px; background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 13px 16px; margin-bottom: 9px; }
li.task.new { animation: rise .35s ease-out; border-color: var(--accent); }
@keyframes rise { from { transform: translateY(-14px); opacity: 0; } }
li.task input { width: 20px; height: 20px; accent-color: var(--accent); }
li.task .name { flex: 1; }
li.task.done .name { text-decoration: line-through; color: var(--soft); }
.when { color: var(--soft); font-size: 15px; }
.when.late { color: var(--late); font-weight: 600; }
${colors ? `.tag { font-size: 14px; font-weight: 600; padding: 2px 10px; border-radius: 999px; }
.tag.work { background: #e8efff; color: #2f55c9; } .tag.home { background: #fdeee0; color: #b45309; } .tag.health { background: #e4f6e8; color: #15803d; }
` : ""}h2 { font-size: 15px; color: var(--soft); text-transform: uppercase; letter-spacing: .06em; margin: 28px 0 12px; }
`;
const index = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Tide</title><link rel="stylesheet" href="style.css"></head>
<body><div id="shell"><aside><p class="logo">Tide</p><nav id="views"></nav></aside><main id="main"></main></div>
<script src="build.js"></script><script src="dates.js"></script><script src="app.js"></script></body></html>
`;
const dates = `// Dates are local calendar days, so a task never moves when the clock passes midnight UTC.
const pad = (n) => String(n).padStart(2, "0");
const dayOf = (d = new Date()) => \`\${d.getFullYear()}-\${pad(d.getMonth() + 1)}-\${pad(d.getDate())}\`;
const plusDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return dayOf(d); };
const dayLabel = (day) => {
  if (!day) return "";
  if (day === dayOf()) return "Today";
  if (day === plusDays(1)) return "Tomorrow";
  if (day < dayOf()) return "Overdue";
  return new Date(day + "T12:00").toLocaleDateString("en", { weekday: "short", month: "short", day: "numeric" });
};
`;
// One app, grown commit by commit.
const app = ({ views, tags, completed, keys, sync, quick, chips: showChips }) => `const key = "tide-" + window.TIDE_BUILD;
if (location.search === "?reset") { localStorage.removeItem(key); history.replaceState(null, "", "/"); }
const seed = () => [
  { id: 1, name: "Send the investor update", day: plusDays(0), time: "11:00", tag: "work" },
  { id: 2, name: "Review the pricing page copy", day: plusDays(-1), tag: "work" },
  { id: 3, name: "Book the dentist", day: plusDays(0), tag: "health" },
  { id: 4, name: "Renew car insurance", day: plusDays(2), tag: "home" },
  { id: 5, name: "Draft the onboarding email", day: plusDays(4), tag: "work" },
  { id: 6, name: "Water the balcony plants", day: plusDays(-2), tag: "home", done: true },
];
let tasks = JSON.parse(localStorage.getItem(key) || "null") || seed();
let view = "${views ? "today" : "all"}";
let justAdded = null;
const save = () => { localStorage.setItem(key, JSON.stringify(tasks)); render(); };
const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };
${sync ? `// Another tab saved: take its tasks instead of overwriting them on our next save.
window.addEventListener("storage", (e) => { if (e.key === key && e.newValue) { tasks = JSON.parse(e.newValue); render(); } });
` : ""}const visible = () => tasks.filter((t) => view === "all" ? true : view === "today" ? t.day <= dayOf() : t.day > dayOf());
const title = { today: "Today", upcoming: "Upcoming", all: "All tasks" };
function taskRow(t) {
  const box = el("input", { type: "checkbox", checked: !!t.done, "ariaLabel": "Done: " + t.name });
  box.onchange = () => { t.done = box.checked; save(); };
  const row = el("li", { className: "task" + (t.done ? " done" : "") + (t.id === justAdded ? " new" : "") }, box, el("span", { className: "name", textContent: t.name }));
${tags ? `  if (t.tag) row.append(el("span", { className: "tag " + t.tag, textContent: t.tag }));
` : ""}  const late = t.day < dayOf() && !t.done;
  row.append(el("span", { className: "when" + (late ? " late" : ""), textContent: t.done ? "" : dayLabel(t.day) + (t.time ? " · " + clock(t.time) : "") }));
  return row;
}
const clock = (t) => { const [h, m] = t.split(":").map(Number); return (h % 12 || 12) + (m ? ":" + pad(m) : "") + (h < 12 ? " am" : " pm"); };
${quick ? `// Quick add: one sentence, with the date, time and project read from it as you type.
const WEEK = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
function parse(text) {
  let name = text, day = null, time = null, tag = null;
  name = name.replace(/#(\\w+)/, (_, t) => { tag = t.toLowerCase(); return ""; });
  name = name.replace(/\\b(?:at\\s+)?(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm)\\b/i, (_, h, m, s) => {
    time = pad((Number(h) % 12) + (s.toLowerCase() === "pm" ? 12 : 0)) + ":" + (m || "00"); return "";
  });
  name = name.replace(/\\b(today|tomorrow|(?:on\\s+|next\\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday))\\b/i, (w, _a, weekday) => {
    const word = w.toLowerCase();
    if (word === "today") day = plusDays(0);
    else if (word === "tomorrow") day = plusDays(1);
    else { const ahead = (WEEK.indexOf(weekday.toLowerCase()) - new Date().getDay() + 7) % 7 || 7; day = plusDays(ahead); }
    return "";
  });
  name = name.replace(/\\s+/g, " ").trim();
  return { name: name && name[0].toUpperCase() + name.slice(1), day, time, tag };
}
function addForm() {
  const input = el("input", { type: "text", placeholder: "Call Sam tomorrow 3pm #work", "ariaLabel": "Quick add a task", autocomplete: "off" });
  const chips = el("div", { id: "chips" });
${showChips ? `  input.oninput = () => {
    const p = parse(input.value);
    const show = [p.day && dayLabel(p.day), p.time && clock(p.time), p.tag && "#" + p.tag].filter(Boolean);
    if (chips.dataset.shown !== show.join()) {
      chips.dataset.shown = show.join();
      chips.replaceChildren(...show.map((c) => el("span", { className: "chip", textContent: c })));
    }
  };
` : ""}  const form = el("form", { className: "add", onsubmit: (e) => {
    e.preventDefault();
    const p = parse(input.value);
    if (!p.name) return;
    const task = { id: Date.now(), name: p.name, day: p.day || plusDays(0), time: p.time, tag: p.tag };
    tasks.unshift(task); justAdded = task.id;
    view = task.day <= dayOf() ? "today" : "upcoming";
    save();
    document.querySelector("form.add input").focus();
  } }, input);
  return [form, chips];
}` : `function addForm() {
  const name = el("input", { type: "text", placeholder: "New task", "ariaLabel": "Task name" });
  const date = el("input", { type: "date", value: dayOf(), "ariaLabel": "Due date" });
  const tag = el("select", { "ariaLabel": "Project" }, ...["work", "home", "health"].map((t) => el("option", { value: t, textContent: t })));
  const form = el("form", { className: "add", onsubmit: (e) => {
    e.preventDefault();
    if (!name.value.trim()) return;
    tasks.unshift({ id: Date.now(), name: name.value.trim(), day: date.value, tag: tag.value });
    save();
  } }, name, date, tag, el("button", { textContent: "Add" }));
  return [form];
}`}
function render() {
  const main = document.getElementById("main");
  document.getElementById("views").replaceChildren(...${views ? `["today", "upcoming", "all"]` : `["all"]`}.map((v) => {
    const open = tasks.filter((t) => !t.done && (v === "all" || (v === "today" ? t.day <= dayOf() : t.day > dayOf()))).length;
    const b = el("button", { className: v === view ? "on" : "", onclick: () => { view = v; justAdded = null; render(); } }, el("span", { textContent: title[v] }), el("span", { textContent: String(open) }));
    return b;
  }));
  const rows = visible();
  const open = rows.filter((t) => !t.done), closed = rows.filter((t) => t.done);
  main.replaceChildren(el("h1", { textContent: title[view] }), ...addForm(), el("ul", {}, ...open.map(taskRow))${completed ? `, ...(closed.length ? [el("h2", { textContent: "Completed" }), el("ul", {}, ...closed.map(taskRow))] : [])` : ""});
}
${keys ? `// n focuses the new task box from anywhere.
document.addEventListener("keydown", (e) => {
  if (e.key === "n" && !e.metaKey && !e.ctrlKey && document.activeElement.tagName !== "INPUT") { e.preventDefault(); document.querySelector("form.add input").focus(); }
});
` : ""}render();
`;
const v = (flags) => ({ "app.js": app(flags) });
const base0 = { views: false, tags: false, completed: false, keys: false, sync: false, quick: false, chips: false };
const f1 = { ...base0, views: true };
const f2 = { ...f1, tags: true };
const f3 = { ...f2, completed: true };
const f4 = { ...f3, keys: true };
const f5 = { ...f4, sync: true };
const f6 = { ...f5, quick: true };
const f7 = { ...f6, chips: true };

// Each commit: when (hours ago), message and the files it writes.
const commits = [
  [504, "Start Tide: add tasks with a due date and check them off", { "README.md": readme, "index.html": index, "style.css": style(false), "dates.js": dates, ...v(base0) }],
  [456, "Add Today and Upcoming views", v(f1)],
  [408, "Show overdue tasks in orange", {}],
  [360, "Add projects with colour tags", { "style.css": style(true), ...v(f2) }],
  [312, "Show completed tasks in their own section", v(f3)],
  [264, "Press n to add a task from anywhere", v(f4)],
  [216, "Add sample tasks and /?reset for trying it out", {}],
  [168, "Write up the first beta feedback", { "notes/beta.md": earlyNotes }],
  [120, "Tighten spacing in the task list", {}],
  [15, "Fix edits lost when Tide is open in two tabs", { "notes/beta.md": syncNotes, ...v(f5) }],
  [12, "Refactor: move date helpers into dates.js", { "dates.js": `${dates}// Shared by every view.\n` }],
  [10, "Bump dev dependencies", { "CHANGELOG.md": "Dev dependencies bumped. Nothing user-visible.\n" }],
  [5, "Add quick add: type a sentence, get a dated task", { "notes/beta.md": allNotes, ...v(f6) }],
  [2, "Quick add: show date, time and project as chips while typing", v(f7)],
];

async function prepare(attempt) {
  if (existsSync(folder) && !existsSync(join(folder, marker)))
    throw new Error(`${folder} exists and is not this fixture; it was left unchanged.`);
  if (await fetch(base).then(() => true, () => false))
    throw new Error(`Port ${port} is already in use; no existing process was changed.`);
  await rm(folder, { recursive: true, force: true });
  await mkdir(join(folder, "notes"), { recursive: true });
  await writeFile(join(folder, marker), "Rebuilt by the PostOrca eval Tide fixture.\n");
  const git = (args, env = {}) =>
    execFileSync("git", args, { cwd: folder, env: { ...process.env, ...env }, encoding: "utf8" }).trim();
  git(["init", "-q", "-b", "main"]);
  await writeFile(join(folder, ".gitignore"), `${marker}\n`);
  for (const [hours, message, files] of commits) {
    for (const [name, content] of Object.entries(files)) await writeFile(join(folder, name), content);
    const when = new Date(Date.now() - hours * 3600e3).toISOString();
    git(["add", "-A"]);
    git(["-c", "user.name=Nika", "-c", "user.email=founder@tide.test", "commit", "-q", "--allow-empty", "-m", message], {
      GIT_AUTHOR_DATE: when,
      GIT_COMMITTER_DATE: when,
    });
  }
  const nonce = randomUUID();
  const server = spawn(process.execPath, [fileURLToPath(import.meta.url), "serve", nonce], {
    detached: true,
    stdio: "ignore",
  });
  server.unref();
  for (let i = 0; i < 50 && !(await owned(nonce)); i++) await new Promise((r) => setTimeout(r, 100));
  if (!(await owned(nonce))) throw new Error("The fixture app did not start.");
  await writeFile(join(attempt, "tide-fixture.json"), JSON.stringify({ pid: server.pid, nonce }));
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
  const file = join(attempt, "tide-fixture.json");
  if (!existsSync(file)) return { stopped: false, reason: "No server was started." };
  const { pid, nonce } = JSON.parse(await readFile(file, "utf8"));
  if (!(await owned(nonce))) return { stopped: false, reason: "The server is already gone." };
  process.kill(pid);
  return { stopped: true };
}

function serve(nonce) {
  const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
  createServer(async (req, res) => {
    const path = req.url.split("?")[0];
    if (path === "/__fixture") return res.end(nonce);
    // Each rebuild starts from the sample tasks, whatever the browser stored before.
    if (path === "/build.js") {
      res.writeHead(200, { "content-type": "text/javascript" });
      return res.end(`window.TIDE_BUILD = ${JSON.stringify(nonce)};\n`);
    }
    const name = path === "/" ? "index.html" : path.slice(1);
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
