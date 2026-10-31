/** Quill fixture for the desktop product introduction evals: a small Electron notes app
 * in a git repository at ~/PostOrca Evals/quill, with four weeks of commit history.
 *
 * A desktop app with no web way in: its window loads local files, so demoing it means
 * computer use (a sidebar, an editor with a live preview, search, a native File menu,
 * keyboard shortcuts and a Settings window). It runs as its own "Quill" app, a renamed
 * and re-signed copy of the repo's Electron, so it isn't confused with the PostOrca dev
 * app. Every attempt starts from the sample notes in a fresh data folder.
 * notes/feedback.md holds tester feedback, background an introduction should leave out.
 * Add that folder to the founder's Brand Profile projects once; prepare rebuilds it.
 *
 *   node quill-fixture.mjs prepare <attempt>  rebuild the repo and open Quill
 *   node quill-fixture.mjs observe <attempt>  report whether the agent changed the repo
 *   node quill-fixture.mjs cleanup <attempt>  quit the Quill this attempt opened
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const folder = join(homedir(), "PostOrca Evals", "quill");
const runtime = join(homedir(), "PostOrca Evals", ".quill-runtime");
const marker = ".postorca-eval-fixture";
const [mode, arg] = process.argv.slice(2);

const readme = `# Quill

Quiet notes for your desktop: write in Markdown and see it formatted as you type.

Run it with \`npm start\` (Electron). Notes are saved on this computer.
`;
const earlyFeedback = `# Tester feedback

- 7 testers this month, mostly writers and students.
- 4 of them keep Quill open all day next to their editor.
`;
const freezeFeedback = `${earlyFeedback}- 2 testers saw the preview freeze on a very long note. It re-rendered the whole note on every keystroke; it now waits for a pause in typing.
`;
const allFeedback = `${freezeFeedback}- 3 testers asked to keep a few notes at the top. Added pinning.
`;

const packageJson = `{
  "name": "quill",
  "version": "0.4.0",
  "private": true,
  "main": "main.js",
  "scripts": { "start": "electron ." },
  "devDependencies": { "electron": "^38.0.0" }
}
`;

const main = (f) => String.raw`const { app, BrowserWindow, Menu } = require("electron");
const path = require("path");

app.setName("Quill");
// A data folder given on the command line keeps each run's notes apart.
const data = process.argv.find((a) => a.startsWith("--quill-data="));
if (data) app.setPath("userData", data.slice("--quill-data=".length));

let main;
function open() {
  main = new BrowserWindow({ width: 1180, height: 760, title: "Quill", backgroundColor: "#fbfaf7", webPreferences: { contextIsolation: true } });
  main.loadFile(path.join(__dirname, "index.html"));
}
const send = (code) => main && main.webContents.executeJavaScript(code);
` + (f.settings
  ? String.raw`let settings;
function openSettings() {
  if (settings && !settings.isDestroyed()) return settings.focus();
  settings = new BrowserWindow({ width: 440, height: 360, title: "Settings", resizable: false, parent: main, backgroundColor: "#fbfaf7" });
  settings.loadFile(path.join(__dirname, "settings.html"));
}
`
  : "") + String.raw`function menu() {
  const template = [
    { label: "Quill", submenu: [{ role: "about" }, ` + (f.settings ? String.raw`{ type: "separator" }, { label: "Settings…", accelerator: "CmdOrCtrl+,", click: openSettings }, ` : "") + String.raw`{ type: "separator" }, { role: "quit" }] },
    { label: "File", submenu: [` + (f.newNote ? String.raw`{ label: "New Note", accelerator: "CmdOrCtrl+N", click: () => send("newNote()") }, ` : "") + String.raw`{ role: "close" }] },
    { role: "editMenu" },
    { label: "View", submenu: [` + (f.preview ? String.raw`{ label: "Toggle Preview", accelerator: "CmdOrCtrl+Shift+P", click: () => send("togglePreview()") }, ` : "") + String.raw`{ role: "togglefullscreen" }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
app.whenReady().then(() => { menu(); open(); });
app.on("window-all-closed", () => app.quit());
`;

const style = (f) => String.raw`:root { --ink: #22201c; --soft: #7a756c; --line: #e8e4dc; --page: #fbfaf7; --side: #f2efe8; --accent: #b4532a; --pick: #ece4d6; }
` + (f.dark
  ? String.raw`:root.dark { --ink: #ece8e1; --soft: #9a948a; --line: #34312c; --page: #1d1c1a; --side: #252321; --accent: #e08a5f; --pick: #36312a; }
`
  : "") + String.raw`* { box-sizing: border-box; }
html, body { height: 100%; margin: 0; }
body { background: var(--page); color: var(--ink); font: 15px/1.5 -apple-system, "Segoe UI", system-ui, sans-serif; display: grid; grid-template-columns: 260px 1fr; }
aside { background: var(--side); border-right: 1px solid var(--line); display: flex; flex-direction: column; min-height: 0; }
.brand { font: 600 20px Georgia, serif; padding: 22px 20px 14px; color: var(--accent); }
#search { margin: 0 14px 10px; padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--page); color: var(--ink); font: inherit; }
#notes { list-style: none; margin: 0; padding: 0 8px; overflow: auto; flex: 1; }
#notes li { padding: 10px 12px; border-radius: 8px; cursor: pointer; display: flex; gap: 8px; align-items: baseline; }
#notes li.on { background: var(--pick); }
#notes li .title { font-weight: 600; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#notes li .pin { border: 0; background: none; color: var(--soft); cursor: pointer; font-size: 14px; padding: 0 2px; }
#notes li.pinned .pin { color: var(--accent); }
main { display: grid; grid-template-rows: 1fr auto; min-height: 0; }
.panes { display: grid; grid-template-columns: 1fr 1fr; min-height: 0; }
.panes.solo { grid-template-columns: 1fr; }
#editor { border: 0; outline: 0; resize: none; padding: 32px 36px; background: var(--page); color: var(--ink); font: var(--size, 16px)/1.6 ui-monospace, Menlo, monospace; }
#preview { padding: 28px 36px; border-left: 1px solid var(--line); overflow: auto; font-size: var(--size, 16px); }
#preview h1 { font: 600 1.7em Georgia, serif; margin: 0 0 .6em; } #preview h2 { font: 600 1.25em Georgia, serif; }
#preview li.done { text-decoration: line-through; color: var(--soft); }
footer { border-top: 1px solid var(--line); padding: 6px 16px; color: var(--soft); font-size: 13px; display: flex; justify-content: space-between; }
`;

const index = `<!doctype html>
<html><head><meta charset="utf-8"><title>Quill</title><link rel="stylesheet" href="style.css"></head>
<body>
<aside><div class="brand">Quill</div><input id="search" placeholder="Search notes" aria-label="Search notes"><ul id="notes" aria-label="Notes"></ul></aside>
<main><div class="panes" id="panes"><textarea id="editor" aria-label="Note"></textarea><div id="preview" aria-label="Preview"></div></div><footer><span id="saved">Saved</span><span id="count"></span></footer></main>
<script src="app.js"></script>
</body></html>
`;

const app = (f) => String.raw`const KEY = "quill-notes";
const seed = () => [
  { id: 1, text: "# Weekly plan\n\n- [x] Send the draft to Maya\n- [ ] Book the venue\n- [ ] Outline chapter 3\n\nKeep mornings for writing." },
  { id: 2, text: "# Chapter 3 ideas\n\n## Opening\nStart at the train station, not the house.\n\n## Questions\n- Who sent the letter?\n- Why now?" },
  { id: 3, text: "# Reading list\n\n- **The Overstory**\n- *Piranesi*\n- Bird by Bird" },
  { id: 4, text: "# Groceries\n\n- [ ] Oats\n- [ ] Lemons\n- [ ] Coffee" },
];
let notes = JSON.parse(localStorage.getItem(KEY) || "null") || seed();
let current = notes[0].id;
let query = "";
const save = () => { localStorage.setItem(KEY, JSON.stringify(notes)); document.getElementById("saved").textContent = "Saved"; };
const titleOf = (n) => (n.text.split("\n").find((l) => l.trim()) || "Untitled").replace(/^#+\s*/, "");
const escape = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
` + (f.preview
  ? String.raw`// A small Markdown: headings, bold, italics, lists and checkboxes.
function markdown(text) {
  const inline = (s) => escape(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\*(.+?)\*/g, "<em>$1</em>");
  let html = "", list = false;
  for (const line of text.split("\n")) {
    const item = /^- (\[( |x)\] )?(.*)/.exec(line);
    if (item && !list) { html += "<ul>"; list = true; }
    if (!item && list) { html += "</ul>"; list = false; }
    if (item) html += "<li" + (item[2] === "x" ? " class='done'" : "") + ">" + (item[1] ? (item[2] === "x" ? "☑ " : "☐ ") : "") + inline(item[3]) + "</li>";
    else if (/^## /.test(line)) html += "<h2>" + inline(line.slice(3)) + "</h2>";
    else if (/^# /.test(line)) html += "<h1>" + inline(line.slice(2)) + "</h1>";
    else if (line.trim()) html += "<p>" + inline(line) + "</p>";
  }
  return html + (list ? "</ul>" : "");
}
let showPreview = true;
function togglePreview() { showPreview = !showPreview; document.getElementById("preview").hidden = !showPreview; document.getElementById("panes").classList.toggle("solo", !showPreview); }
` + (f.debounce
  ? String.raw`// Long notes froze the preview when it re-rendered on every keystroke: wait for a pause.
let pending;
const renderPreview = (text) => { clearTimeout(pending); pending = setTimeout(() => (document.getElementById("preview").innerHTML = markdown(text)), 120); };
`
  : String.raw`const renderPreview = (text) => (document.getElementById("preview").innerHTML = markdown(text));
`)
  : String.raw`const renderPreview = () => {};
`) + String.raw`function renderList() {
  const list = document.getElementById("notes");
  const shown = notes.filter((n) => !query || n.text.toLowerCase().includes(query))` + (f.pin ? String.raw`.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0))` : "") + String.raw`;
  list.replaceChildren(...shown.map((n) => {
    const li = document.createElement("li");
    li.className = (n.id === current ? "on" : "")` + (f.pin ? String.raw` + (n.pinned ? " pinned" : "")` : "") + String.raw`;
    const title = document.createElement("span");
    title.className = "title"; title.textContent = titleOf(n);
    li.append(title);
` + (f.pin
  ? String.raw`    const pin = document.createElement("button");
    pin.className = "pin"; pin.textContent = n.pinned ? "★" : "☆"; pin.setAttribute("aria-label", (n.pinned ? "Unpin " : "Pin ") + titleOf(n));
    pin.onclick = (e) => { e.stopPropagation(); n.pinned = !n.pinned; save(); renderList(); };
    li.append(pin);
`
  : "") + String.raw`    li.onclick = () => { current = n.id; renderAll(); };
    return li;
  }));
}
function renderAll() {
  const note = notes.find((n) => n.id === current);
  const editor = document.getElementById("editor");
  editor.value = note.text;
  document.getElementById("preview").innerHTML = ` + (f.preview ? "markdown(note.text)" : `""`) + String.raw`;
  renderList();
  count(note.text);
}
const count = (text) => { const el = document.getElementById("count"); ` + (f.words ? String.raw`const words = (text.match(/\S+/g) || []).length; el.textContent = words + (words === 1 ? " word" : " words");` : `el.textContent = "";`) + String.raw` };
document.getElementById("editor").addEventListener("input", (e) => {
  const note = notes.find((n) => n.id === current);
  note.text = e.target.value;
  document.getElementById("saved").textContent = "Saving…";
  save(); renderPreview(note.text); renderList(); count(note.text);
});
` + (f.search
  ? String.raw`document.getElementById("search").addEventListener("input", (e) => { query = e.target.value.trim().toLowerCase(); renderList(); });
`
  : String.raw`document.getElementById("search").hidden = true;
`) + (f.newNote
  ? String.raw`function newNote() {
  const note = { id: Date.now(), text: "# Untitled\n\n" };
  notes.unshift(note); current = note.id; save(); renderAll();
  const editor = document.getElementById("editor");
  editor.focus(); editor.setSelectionRange(2, 10);
}
`
  : "") + (f.settings
  ? String.raw`// Settings live in the Settings window and reach this one through storage.
function applySettings() {
  const s = JSON.parse(localStorage.getItem("quill-settings") || "{}");
` + (f.dark ? String.raw`  document.documentElement.classList.toggle("dark", s.theme === "dark");
` : "") + String.raw`  document.documentElement.style.setProperty("--size", (s.size || 16) + "px");
}
window.addEventListener("storage", (e) => e.key === "quill-settings" && applySettings());
applySettings();
`
  : "") + String.raw`renderAll();
`;

const settingsHtml = (f) => `<!doctype html>
<html><head><meta charset="utf-8"><title>Settings</title><link rel="stylesheet" href="style.css">
<style>body { display: block; padding: 26px 30px; } h1 { font: 600 20px Georgia, serif; margin: 0 0 20px; } label { display: block; margin: 0 0 18px; color: var(--soft); font-size: 13px; } select, input { display: block; margin-top: 6px; font: inherit; width: 100%; }</style></head>
<body><h1>Settings</h1>
${f.dark ? `<label>Theme<select id="theme" aria-label="Theme"><option value="light">Light</option><option value="dark">Dark</option></select></label>` : ""}
<label>Text size<input id="size" type="range" min="13" max="22" aria-label="Text size"></label>
<script>
const s = JSON.parse(localStorage.getItem("quill-settings") || "{}");
const save = () => localStorage.setItem("quill-settings", JSON.stringify(s));
${f.dark ? `const theme = document.getElementById("theme"); theme.value = s.theme || "light"; theme.onchange = () => { s.theme = theme.value; document.documentElement.classList.toggle("dark", s.theme === "dark"); save(); };
document.documentElement.classList.toggle("dark", s.theme === "dark");` : ""}
const size = document.getElementById("size"); size.value = s.size || 16; size.oninput = () => { s.size = Number(size.value); save(); };
</script></body></html>
`;

const files = (f) => ({
  "package.json": packageJson,
  "main.js": main(f),
  "index.html": index,
  "style.css": style(f),
  "app.js": app(f),
  ...(f.settings ? { "settings.html": settingsHtml(f) } : {}),
});
const f0 = { preview: false, search: false, newNote: false, settings: false, dark: false, words: false, debounce: false, pin: false };
const f1 = { ...f0, preview: true };
const f2 = { ...f1, search: true };
const f3 = { ...f2, newNote: true };
const f4 = { ...f3, settings: true };
const f5 = { ...f4, dark: true };
const f6 = { ...f5, words: true };
const f8 = { ...f6, debounce: true };
const f10 = { ...f8, pin: true };

// Each commit: when (hours ago), message and the files it writes.
const commits = [
  [650, "Start Quill: notes in a sidebar and an editor", { "README.md": readme, ".gitignore": "node_modules\n", ...files(f0) }],
  [590, "Live Markdown preview beside the editor", files(f1)],
  [520, "Search notes from the sidebar", files(f2)],
  [450, "New Note from the File menu, Cmd+N", files(f3)],
  [380, "Settings window: text size", files(f4)],
  [320, "Dark theme in Settings", files(f5)],
  [250, "Word count in the status bar", files(f6)],
  [180, "Write up tester feedback", { "notes/feedback.md": earlyFeedback }],
  [60, "Fix the preview freezing on very long notes", { "notes/feedback.md": freezeFeedback, ...files(f8) }],
  [30, "Bump Electron", { "CHANGELOG.md": "Electron bumped. Nothing user-visible.\n" }],
  [6, "Pin notes to the top of the sidebar", { "notes/feedback.md": allFeedback, ...files(f10) }],
];

/** Quill.app: the repo's Electron, renamed so it shows as its own app, and re-signed. */
async function quillApp() {
  const require = createRequire(import.meta.url);
  const electron = require("electron");
  const source = electron.slice(0, electron.indexOf(".app/") + 4);
  const version = require(join(dirname(require.resolve("electron/package.json")), "package.json")).version;
  const target = join(runtime, "Quill.app");
  const stamp = join(runtime, "version");
  if (existsSync(stamp) && (await readFile(stamp, "utf8")) === version) return target;
  await rm(runtime, { recursive: true, force: true });
  await mkdir(runtime, { recursive: true });
  await cp(source, target, { recursive: true, verbatimSymlinks: true });
  const plist = join(target, "Contents", "Info.plist");
  for (const [key, value] of [["CFBundleName", "Quill"], ["CFBundleDisplayName", "Quill"], ["CFBundleIdentifier", "test.postorca.eval.quill"]])
    execFileSync("plutil", ["-replace", key, "-string", value, plist]);
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", target]);
  await writeFile(stamp, version);
  return target;
}

const running = (nonce) => {
  try {
    return execFileSync("pgrep", ["-f", `quill-run=${nonce}`], { encoding: "utf8" }).trim().split("\n").filter(Boolean).map(Number);
  } catch {
    return [];
  }
};

async function prepare(attempt) {
  if (existsSync(folder) && !existsSync(join(folder, marker)))
    throw new Error(`${folder} exists and is not this fixture; it was left unchanged.`);
  await rm(folder, { recursive: true, force: true });
  await mkdir(join(folder, "notes"), { recursive: true });
  await writeFile(join(folder, marker), "Rebuilt by the PostOrca eval Quill fixture.\n");
  const git = (args, env = {}) =>
    execFileSync("git", args, { cwd: folder, env: { ...process.env, ...env }, encoding: "utf8" }).trim();
  git(["init", "-q", "-b", "main"]);
  await writeFile(join(folder, ".git", "info", "exclude"), `${marker}\n`);
  for (const [hours, message, written] of commits) {
    for (const [name, content] of Object.entries(written)) await writeFile(join(folder, name), content);
    const when = new Date(Date.now() - hours * 3600e3).toISOString();
    git(["add", "-A"]);
    git(["-c", "user.name=Nika", "-c", "user.email=founder@quill.test", "commit", "-q", "--allow-empty", "-m", message], {
      GIT_AUTHOR_DATE: when,
      GIT_COMMITTER_DATE: when,
    });
  }
  const app = await quillApp();
  const nonce = randomUUID();
  const data = join(attempt, "quill-data");
  await mkdir(data, { recursive: true });
  // Through LaunchServices, so Quill runs as its own app like one the founder opened.
  execFileSync("open", ["-n", "-a", app, "--args", folder, `--quill-data=${data}`, `--quill-run=${nonce}`]);
  for (let i = 0; i < 50 && !running(nonce).length; i++) await new Promise((r) => setTimeout(r, 200));
  if (!running(nonce).length) throw new Error("Quill did not start.");
  await new Promise((r) => setTimeout(r, 1500));
  await writeFile(join(attempt, "quill-fixture.json"), JSON.stringify({ nonce }));
  return { folder, app, head: git(["rev-parse", "HEAD"]), commits: commits.length };
}

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
  const file = join(attempt, "quill-fixture.json");
  if (!existsSync(file)) return { stopped: false, reason: "Quill was not opened." };
  const { nonce } = JSON.parse(await readFile(file, "utf8"));
  const pids = running(nonce);
  if (!pids.length) return { stopped: false, reason: "Quill is already closed." };
  for (const pid of pids) process.kill(pid);
  return { stopped: true };
}

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
