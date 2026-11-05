# Command sessions

Orca's core `command` tool runs on the connected desktop, independently of the
active plugin. The desktop uses `node-pty` 1.1.0; no terminal UI is required.

| Action | Arguments | Result |
| --- | --- | --- |
| `run` (new) | `command`, optional `cwd`, `wait_ms` | Starts a shell command and returns `session_id`, output, cursor and status. |
| `run` (existing) | `session_id`, `input`, optional `cursor`, `wait_ms` | Sends literal input, then returns output and status. |
| `list` | No other arguments | Lists this task's running and retained exited sessions on the current desktop. |
| `read` | `session_id`, optional `cursor`, `wait_ms` | Reads output without consuming it. |
| `kill` | `session_id`, optional `wait_ms` | Forcibly stops the session and its process tree. Use Ctrl+C input for a normal interrupt. |

Examples (tool arguments):

```json
{"action":"run","command":"npm run dev","cwd":"/Users/founder/project","wait_ms":1000}
{"action":"list"}
{"action":"read","session_id":"<returned ID>","cursor":120,"wait_ms":1000}
{"action":"run","session_id":"<returned ID>","input":"i\r","cursor":120}
{"action":"run","session_id":"<returned ID>","input":"\u0003"}
{"action":"kill","session_id":"<returned ID>"}
```

Input is not a new shell command when a session ID is present: it goes to the
running program's terminal. Nothing is appended automatically. Use `\r` for Enter
and terminal escape sequences for keys, e.g. `\u001b[A` for Up. Once the process
exits, start a new session for another command.

## Lifetime and output

- A process keeps running after the tool returns; do not use `&`, `nohup` or
  detach the server. `wait_ms` is a response wait, not a command timeout (default
  1000, maximum 10000). It returns early when the process exits.
- Sessions survive turns, plugin switches and temporary WebSocket disconnections.
  Sign-out, account replacement and app exit stop them. They are not persisted
  across desktop restarts. Session IDs route follow-up calls to their original
  device; an unavailable device never falls back to another computer.
- Only the owning task can list, read, write or kill its sessions. Calls still use
  the existing device authentication and task ownership checks. A timed-out call
  has an unknown outcome: list sessions and inspect logs before starting again.
- Output combines stdout/stderr and retains terminal escape sequences. Offsets
  count JavaScript string characters, not bytes. Each session retains the latest
  256000 characters, returning at most 24000 per call. Pass the returned `cursor`
  to read more. `has_more` means more retained output is available; `output_lost`
  means the requested cursor predates the retained buffer. Reads are replayable.
- Exited sessions retain their exit code, signal and output. There are at most
  16 running sessions per task and 128 retained sessions per desktop; at capacity,
  the oldest exited session is evicted before accepting another command.

## Integration and boundaries

The API schema is in `apps/api/src/tools/command.ts`, registered through the
existing core desktop tool wrapper. The handler is
`apps/desktop/electron/tools/command.cjs`. The connection adds the stable device
identity and calls shutdown when its signed-in session changes. No database
migration or separate service is needed. Deploy the updated API and install the
updated desktop together; an older desktop cannot execute this tool.

New command directories use the same real-path checks as existing file tools:
the working folder or the task's project folders, including symlink resolution.
This is **not a command/filesystem sandbox**. Commands have the user's OS access.
Demo instructions allow documented startup/build/install commands and their normal
generated files, while prohibiting unrelated source edits, destructive operations,
deployment and printing credentials. Existing file-tool write restrictions and
the computer plugin's terminal-input block remain in place.

On Unix, the developer's interactive login shell supplies the environment, which
stays local. The requested command runs in a login shell attached to a PTY, with
its exit status preserved separately from interactive startup/exit hooks. On
Windows the command uses `ComSpec` (`cmd.exe`). The process environment removes
Electron's Node mode and inherited Node inspector options.

`node-pty` is a native dependency: electron-builder rebuilds it for Electron and
unpacks its binaries. The desktop postinstall and packaging hook ensure its Unix
`spawn-helper` is executable before signing. Run `npm install` from the repository
root after checking out the branch; build the desktop normally for distribution.

## Verification

`npm run check` and `npm test` include schema/device routing, connection lifetime
and real PTY tests. The CLI integration tests exercise exit codes, prompts,
Enter/Ctrl+C, a background Node HTTP server, process-tree termination, task
isolation and bounded replayable output. The POSIX integration fixtures run on
macOS/Linux; Windows shell selection is unit-tested but needs a Windows runtime
check before a Windows release.
