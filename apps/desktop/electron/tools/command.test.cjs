const { test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { mkdtemp, rm, mkdir, symlink, writeFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { execFileSync } = require("node:child_process");
const { createCommandTools, shellCommand } = require("./command.cjs");

const deviceId = randomUUID();
const context = { taskId: "demo-task", deviceId };
const quote = (text) => `'${text.replace(/'/g, "'\\''")}'`;
const node = (script) => `node -e ${quote(script)}`;

async function fixture(t, options = {}) {
  const cwd = await mkdtemp(join(tmpdir(), "postorca-command-"));
  const tools = createCommandTools({ resolveDirectory: async () => cwd, ...options });
  t.after(async () => { tools.shutdown(); await rm(cwd, { recursive: true, force: true }); });
  return { ...tools, cwd, run: (args, ctx = context) => tools.command.run(args, ctx) };
}
async function until(run, session, predicate) {
  let result = session;
  for (let attempt = 0; attempt < 30 && !predicate(result); attempt++)
    result = await run({ action: "read", session_id: session.session_id, wait_ms: 100 });
  assert.ok(predicate(result), JSON.stringify(result));
  return result;
}

test("short commands report terminal output, cwd and a nonzero exit code", { skip: process.platform === "win32" }, async (t) => {
  const { run, cwd } = await fixture(t);
  const result = await run({ action: "run", command: node("console.log(process.cwd(), Boolean(process.stdin.isTTY));process.exit(7)") });
  assert.equal(result.status, "exited");
  assert.equal(result.exit_code, 7);
  assert.match(result.output, /true/);
  assert.equal(result.cwd, cwd);
  assert.match(result.session_id, new RegExp(`^${deviceId}:`));
  assert.equal((await run({ action: "list" })).sessions[0].exit_code, 7);
  await assert.rejects(run({ action: "run", session_id: result.session_id, input: "hello\r" }), /exited/);
});

test("interactive sessions accept literal input, Enter and Ctrl+C through run", { skip: process.platform === "win32" }, async (t) => {
  const { run } = await fixture(t);
  let result = await run({ action: "run", command: node("const r=require('readline').createInterface({input:process.stdin,output:process.stdout});r.on('SIGINT',()=>process.exit(130));r.question('Your name? ',n=>{console.log('hello '+n);setInterval(()=>{},1000)})"), wait_ms: 100 });
  result = await until(run, result, (r) => r.output.includes("Your name?"));
  assert.equal(result.status, "running");
  result = await run({ action: "run", session_id: result.session_id, input: "Orca\r", cursor: result.cursor, wait_ms: 100 });
  assert.match(result.output, /hello Orca/);
  result = await run({ action: "run", session_id: result.session_id, input: "\u0003", wait_ms: 1000 });
  assert.equal(result.status, "exited");
});

test("a server stays alive across calls and kill terminates its child process tree", { skip: process.platform === "win32" }, async (t) => {
  const { run } = await fixture(t);
  const server = "require('http').createServer((q,s)=>s.end('demo-ready')).listen(0,'127.0.0.1',function(){console.log('PORT='+this.address().port)});console.log('CHILD='+process.pid)";
  const parent = `const c=require('child_process').spawn(process.execPath,['-e',${JSON.stringify(server)}],{stdio:'inherit'});setInterval(()=>{},1000)`;
  let result = await run({ action: "run", command: node(parent), wait_ms: 100 });
  result = await until(run, result, (r) => r.output.includes("PORT="));
  const port = Number(/PORT=(\d+)/.exec(result.output)[1]);
  const child = Number(/CHILD=(\d+)/.exec(result.output)[1]);
  assert.equal(await (await fetch(`http://127.0.0.1:${port}`)).text(), "demo-ready");
  assert.equal((await run({ action: "list" })).sessions[0].status, "running");
  const stopped = await run({ action: "kill", session_id: result.session_id });
  assert.equal(stopped.stop_requested, true);
  assert.equal(stopped.status, "exited");
  await assert.rejects(fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(1000) }));
  // A just-killed process may be a zombie awaiting the OS reaper, but must not run.
  let state = "";
  try { state = execFileSync("/bin/ps", ["-p", String(child), "-o", "stat="], { encoding: "utf8" }).trim(); } catch {}
  assert.ok(!state || state.startsWith("Z"), `child still running: ${state}`);
});

test("sessions are task-owned, input validation happens before writing, and shutdown clears them", { skip: process.platform === "win32" }, async (t) => {
  const { run, shutdown } = await fixture(t);
  const result = await run({ action: "run", command: "cat", wait_ms: 0 });
  assert.deepEqual((await run({ action: "list" }, { ...context, taskId: "other-task" })).sessions, []);
  await assert.rejects(run({ action: "kill", session_id: result.session_id }, { ...context, taskId: "other-task" }), /Unknown command session/);
  await assert.rejects(run({ action: "run", session_id: result.session_id, input: "must-not-send", cursor: 999999 }), /cursor/);
  await assert.rejects(run({ action: "run", session_id: result.session_id, command: "no" }), /run needs/);
  await assert.rejects(run({ action: "read" }), /Invalid session/);
  await assert.rejects(run({ action: "list", roots: [], input: "no" }), /only for run/);
  assert.equal((await run({ action: "read", session_id: result.session_id, wait_ms: 0 })).output, "");
  shutdown();
  assert.deepEqual((await run({ action: "list" })).sessions, []);
  await assert.rejects(run({ action: "read", session_id: result.session_id }), /Unknown command session/);
});

test("bounded output uses replayable cursors and reports lost output", { skip: process.platform === "win32" }, async (t) => {
  const { run } = await fixture(t, { maxOutput: 100, maxReply: 20 });
  let result = await run({ action: "run", command: node("process.stdout.write('x'.repeat(500))") });
  assert.equal(result.output.length, 20);
  assert.equal(result.output_lost, true);
  assert.equal(result.has_more, true);
  const replay = await run({ action: "read", session_id: result.session_id, wait_ms: 0 });
  assert.equal(replay.cursor, result.cursor);
  let retained = result.output;
  while (result.has_more) {
    result = await run({ action: "read", session_id: result.session_id, cursor: result.cursor, wait_ms: 0 });
    assert.equal(result.output_lost, false);
    retained += result.output;
  }
  assert.equal(retained.length, 100);
  const empty = await run({ action: "read", session_id: result.session_id, cursor: result.cursor, wait_ms: 0 });
  assert.equal(empty.output, "");
});

test("aborting a tool wait does not lose or kill its running command", { skip: process.platform === "win32" }, async (t) => {
  const { run } = await fixture(t);
  const result = await run({ action: "run", command: "cat", wait_ms: 0 });
  const controller = new AbortController();
  const reading = run({ action: "read", session_id: result.session_id, wait_ms: 10000 }, { ...context, signal: controller.signal });
  controller.abort();
  await assert.rejects(reading, /process may still be running/);
  assert.equal((await run({ action: "list" })).sessions[0].status, "running");
});

test("shell selection loads a Unix login environment and uses cmd on Windows", () => {
  assert.deepEqual(shellCommand("npm run dev", "darwin", { SHELL: "/bin/zsh" }), { file: "/bin/zsh", args: ["-l", "-c", "npm run dev"] });
  assert.deepEqual(shellCommand("npm run dev", "win32", { ComSpec: "cmd.exe" }), { file: "cmd.exe", args: ["/d", "/s", "/c", "npm run dev"] });
});


test("new sessions reuse real-path folder checks, including symlink escapes", { skip: process.platform === "win32" }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "postorca-command-path-"));
  const source = join(root, "source"), outside = join(root, "outside");
  await mkdir(source); await mkdir(outside);
  await symlink(outside, join(source, "escape"));
  await writeFile(join(source, "file.txt"), "text");
  const tools = createCommandTools({ environment: async () => process.env });
  t.after(async () => { tools.shutdown(); await rm(root, { recursive: true, force: true }); });
  const run = (cwd) => tools.command.run({ action: "run", command: "printf ready", cwd, roots: [source] }, context);
  await assert.rejects(run(outside), /Not in the working folder or a project folder/);
  await assert.rejects(run(join(source, "escape")), /Not in the working folder or a project folder/);
  await assert.rejects(run(join(source, "file.txt")), /must be a directory/);
  assert.equal((await run(source)).output, "ready");
});

test("sign-out during asynchronous preparation prevents a late process launch", async (t) => {
  let ready;
  const blocked = new Promise((resolve) => { ready = resolve; });
  const { run, shutdown } = await fixture(t, {
    environment: () => blocked,
    spawn: () => assert.fail("a signed-out desktop must not launch a process"),
  });
  const starting = run({ action: "run", command: "echo should-not-run" });
  // Wait until folder resolution has completed and environment preparation begins.
  await new Promise((resolve) => setTimeout(resolve, 30));
  shutdown();
  ready(process.env);
  await assert.rejects(starting, /signed out before the command started/);
});
