// Persistent PTYs are independent of a turn, plugin, or WebSocket connection.
// They are local to the signed-in desktop lifetime; results remain task-owned.
const { randomUUID } = require("node:crypto");
const { execFile, execFileSync } = require("node:child_process");
const { EventEmitter } = require("node:events");
const fs = require("node:fs/promises");
const os = require("node:os");
const { promisify } = require("node:util");
const execute = promisify(execFile);

function shellCommand(command, platform = process.platform, env = process.env) {
  if (platform === "win32")
    return { file: env.ComSpec || "C:\\Windows\\System32\\cmd.exe", args: ["/d", "/s", "/c", command] };
  const file = env.SHELL || os.userInfo().shell || (platform === "darwin" ? "/bin/zsh" : "/bin/sh");
  return { file, args: ["-l", "-c", command] };
}

async function shellEnvironment(file) {
  if (process.platform === "win32") return { ...process.env };
  // Read the interactive login environment separately: .zshrc loads nvm and
  // developer PATHs, but interactive exit hooks can overwrite a command's status.
  // Never send this environment (which can contain credentials) to the server.
  const marker = "\u0000POSTORCA_SHELL_ENV\u0000";
  const { stdout } = await execute(file, ["-i", "-l", "-c", "printf '\\0POSTORCA_SHELL_ENV\\0'; /usr/bin/env -0"], {
    env: process.env, encoding: "utf8", timeout: 10_000, maxBuffer: 1024 * 1024,
  });
  const start = stdout.indexOf(marker);
  if (start < 0) throw new Error("Could not read the developer's shell environment.");
  const env = { ...process.env };
  for (const entry of stdout.slice(start + marker.length).split("\u0000")) {
    const equals = entry.indexOf("=");
    if (equals > 0) env[entry.slice(0, equals)] = entry.slice(equals + 1);
  }
  return env;
}

function killTree(terminal) {
  const pid = terminal.pid;
  if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid)
    throw new Error("Invalid command process ID.");
  if (process.platform === "win32") {
    execFileSync("taskkill.exe", ["/pid", String(pid), "/T", "/F"], { timeout: 5000, windowsHide: true });
    terminal.kill();
    return;
  }
  // PTYs start their own session/process group. Also collect descendants because
  // programs can create additional groups (shell job control, npm wrappers).
  const rows = execFileSync("/bin/ps", ["-A", "-o", "pid=,ppid="], { encoding: "utf8", timeout: 3000 })
    .trim().split("\n").map((line) => line.trim().split(/\s+/).map(Number));
  const descendants = [pid];
  for (let index = 0; index < descendants.length; index++)
    for (const [child, parent] of rows)
      if (parent === descendants[index] && !descendants.includes(child)) descendants.push(child);
  const kill = (target) => {
    try { process.kill(target, "SIGKILL"); }
    catch (error) { if (error.code !== "ESRCH") throw error; }
  };
  for (const child of descendants.slice(1).reverse()) kill(child);
  kill(-pid);
  terminal.kill("SIGKILL");
}

function createCommandTools({
  spawn = (...args) => require("node-pty").spawn(...args),
  environment = shellEnvironment,
  resolveDirectory = (cwd, roots) => require("./files.cjs").allowed(cwd, roots),
  stop = killTree,
  maxOutput = 256_000,
  maxReply = 24_000,
  maxSessions = 128,
} = {}) {
  const sessions = new Map();
  let generation = 0;

  function status(session) {
    return {
      session_id: session.id, command: session.command.slice(0, 1000), command_truncated: session.command.length > 1000, cwd: session.cwd,
      pid: session.terminal.pid, status: session.status,
      started_at: session.startedAt, exited_at: session.exitedAt ?? null,
      exit_code: session.exitCode ?? null, signal: session.signal ?? null,
      output_start: session.offset, output_end: session.offset + session.output.length,
    };
  }
  function output(session, cursor = 0) {
    const start = Math.max(cursor, session.offset);
    const end = Math.min(start + maxReply, session.offset + session.output.length);
    if (cursor > session.offset + session.output.length)
      throw new Error("Output cursor is past the end of this session's output.");
    return {
      ...status(session), output: session.output.slice(start - session.offset, end - session.offset),
      cursor: end, output_lost: cursor < session.offset,
      has_more: end < session.offset + session.output.length,
    };
  }
  function owned(id, taskId, deviceId) {
    const session = sessions.get(id);
    if (!session || session.taskId !== taskId || !id.startsWith(`${deviceId}:`))
      throw new Error("Unknown command session for this task on this desktop. Use command list; sessions end on sign-out or app exit.");
    return session;
  }
  function wait(session, ms, signal) {
    signal?.throwIfAborted();
    if (session.status !== "running" || ms === 0) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const finish = (error) => {
        clearTimeout(timer);
        session.events.removeListener("exit", onExit);
        signal?.removeEventListener("abort", onAbort);
        if (error) reject(error); else resolve();
      };
      const onExit = () => finish();
      const onAbort = () => finish(new Error("Command wait was stopped. The process may still be running; list sessions before starting it again."));
      const timer = setTimeout(onExit, ms);
      session.events.once("exit", onExit);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }
  function validate(args) {
    if (!args || typeof args !== "object") throw new Error("Invalid command arguments.");
    const { action, session_id: id, command, input, cwd, cursor, wait_ms: ms } = args;
    if (Object.keys(args).some((key) => !["action", "session_id", "command", "input", "cwd", "cursor", "wait_ms", "roots"].includes(key)))
      throw new Error("Invalid command arguments.");
    if (!["run", "list", "read", "kill"].includes(action)) throw new Error("Unknown command action.");
    if (id !== undefined && (typeof id !== "string" || !/^[0-9a-f-]{36}:[0-9a-f-]{36}$/.test(id))) throw new Error("Invalid session_id.");
    if (ms !== undefined && (!Number.isInteger(ms) || ms < 0 || ms > 10_000)) throw new Error("wait_ms must be 0–10000.");
    if (cursor !== undefined && (!Number.isSafeInteger(cursor) || cursor < 0)) throw new Error("Invalid output cursor.");
    for (const value of [command, input])
      if (value !== undefined && (typeof value !== "string" || !value.length || value.length > 20_000)) throw new Error("Invalid command/input text.");
    if (cwd !== undefined && (typeof cwd !== "string" || !cwd.length || cwd.length > 4096)) throw new Error("Invalid cwd.");
    if (action === "run") {
      if (id ? (!input || command !== undefined || cwd !== undefined) : (!command || input !== undefined || cursor !== undefined))
        throw new Error("run needs command/cwd for a new session, or session_id/input for an existing session.");
    } else {
      if (command !== undefined || input !== undefined || cwd !== undefined) throw new Error("command/input/cwd are only for run.");
      if (action === "list" ? (id !== undefined || cursor !== undefined || ms !== undefined) : !id) throw new Error("Invalid session for action.");
      if (action === "kill" && cursor !== undefined) throw new Error("kill does not accept cursor.");
    }
  }

  const command = { run: async (args, context) => {
    validate(args);
    const { taskId, deviceId, signal } = context;
    if (!taskId || !deviceId) throw new Error("Command requires a task and desktop identity. Update server and desktop together.");
    signal?.throwIfAborted();
    const epoch = generation;
    const { action, session_id: id, wait_ms: ms = 1000, cursor = 0 } = args;
    if (action === "list")
      return { device_id: deviceId, sessions: [...sessions.values()].filter((s) => s.taskId === taskId).map(status) };
    let session;
    if (action === "run" && !id) {
      const cwd = await resolveDirectory(args.cwd, args.roots);
      if (!(await fs.stat(cwd)).isDirectory()) throw new Error("cwd must be a directory.");
      const { file, args: shellArgs } = shellCommand(args.command);
      const env = { ...await environment(file), TERM: "xterm-256color" };
      signal?.throwIfAborted();
      if (epoch !== generation) throw new Error("Desktop signed out before the command started.");
      if ([...sessions.values()].filter((s) => s.taskId === taskId && s.status === "running").length >= 16)
        throw new Error("This task already has 16 running command sessions. Kill an unused session first.");
      if (sessions.size >= maxSessions) {
        const oldest = [...sessions.values()].find((s) => s.status !== "running");
        if (oldest) sessions.delete(oldest.id);
        else throw new Error("The desktop has too many running command sessions. Stop unused sessions first.");
      }
      // A terminal's child must run as the user's normal program, not inherit
      // Electron's special Node mode or an unrelated parent Node inspector.
      delete env.ELECTRON_RUN_AS_NODE;
      delete env.NODE_OPTIONS;
      const terminal = spawn(file, shellArgs, { cwd, env, name: "xterm-256color", cols: 120, rows: 40 });
      session = {
        id: `${deviceId}:${randomUUID()}`, taskId, command: args.command, cwd, terminal,
        status: "running", startedAt: new Date().toISOString(), output: "", offset: 0,
        events: new EventEmitter(),
      };
      sessions.set(session.id, session);
      terminal.onData((data) => {
        session.output += data;
        if (session.output.length > maxOutput) {
          const removed = session.output.length - maxOutput;
          session.output = session.output.slice(removed);
          session.offset += removed;
        }
      });
      terminal.onExit(({ exitCode, signal: exitSignal }) => {
        session.status = "exited";
        session.exitCode = exitCode;
        session.signal = exitSignal;
        session.exitedAt = new Date().toISOString();
        session.events.emit("exit");
      });
    } else {
      session = owned(id, taskId, deviceId);
      if (action === "run") {
        if (session.status !== "running") throw new Error("This command session has exited. Start a new session without session_id.");
        // Validate before sending input, so an invalid read cursor cannot obscure
        // whether an irreversible terminal input was delivered.
        output(session, cursor);
        session.terminal.write(args.input);
      } else if (action === "kill" && session.status === "running") {
        stop(session.terminal);
      }
    }
    await wait(session, ms, signal);
    return { ...output(session, action === "kill" ? session.offset : cursor), ...(action === "kill" ? { stop_requested: true } : {}) };
  } };
  function shutdown() {
    generation++;
    for (const session of sessions.values()) {
      if (session.status === "running") {
        try { stop(session.terminal); }
        catch { try { session.terminal.kill(); } catch {} }
      }
    }
    sessions.clear();
  }
  return { command, shutdown };
}

module.exports = { ...createCommandTools(), createCommandTools, shellCommand, shellEnvironment, killTree };
