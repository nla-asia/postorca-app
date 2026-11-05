import { z } from "zod";

export const commandArgs = z.object({
  action: z.enum(["run", "list", "read", "kill"]),
  session_id: z.string().regex(/^[0-9a-f-]{36}:[0-9a-f-]{36}$/).optional()
    .describe("Opaque session ID returned by command. Routes back to the same desktop."),
  command: z.string().min(1).max(20_000).optional()
    .describe("run without session_id: shell command to start."),
  input: z.string().min(1).max(20_000).optional()
    .describe("run with session_id: literal terminal input. Include \\r for Enter, \\u0003 for Ctrl+C, or terminal escape sequences for other keys. Nothing is appended automatically."),
  cwd: z.string().min(1).max(4096).optional()
    .describe("New sessions only: working directory in the active project's source folders or the working folder. Defaults to the working folder."),
  wait_ms: z.number().int().min(0).max(10_000).optional()
    .describe("Wait for output/exit before returning (default 1000 ms). Does not limit process lifetime."),
  cursor: z.number().int().nonnegative().optional()
    .describe("read/run with session_id: output offset returned by the previous call. Omit to read retained output from the beginning."),
}).strict().superRefine((args, context) => {
  let error;
  if (args.action === "run") {
    if (args.session_id) {
      if (!args.input || args.command !== undefined || args.cwd !== undefined)
        error = "run with session_id requires input; command and cwd are only for a new session.";
    } else if (!args.command || args.input !== undefined || args.cursor !== undefined) {
      error = "run without session_id requires command; input and cursor require an existing session.";
    }
  } else if (args.command !== undefined || args.input !== undefined || args.cwd !== undefined) {
    error = "command, input and cwd are only accepted for run.";
  } else if (args.action === "list" && (args.session_id !== undefined || args.cursor !== undefined || args.wait_ms !== undefined)) {
    error = "list takes only action.";
  } else if (args.action !== "list" && !args.session_id) {
    error = `${args.action} requires session_id.`;
  } else if (args.action === "kill" && args.cursor !== undefined) {
    error = "kill does not accept cursor.";
  }
  if (error) context.addIssue({ code: "custom", message: error });
});

export const commandDefinition = {
  name: "command",
  description: "Run shell commands in persistent terminal sessions on the founder's desktop. action=run without session_id starts command in cwd; with session_id it sends literal input to that existing process. list shows this task's sessions on the current desktop; read returns output/status; kill forcibly stops a session and its process tree. Commands keep running across tool calls, turns, plugin switches and temporary disconnects while the desktop remains open. A returned running status is not proof an app is ready: inspect logs and verify it opens. No need for &, nohup or a separate Terminal app. Output is bounded, includes terminal escape sequences, and combines stdout/stderr; use returned cursor for subsequent reads. A timeout has an unknown outcome: list before retrying a start. Sessions belong to this task and end on sign-out/app exit. Runs with the user's OS permissions, not in a filesystem sandbox. Use for the requested work; never expose secrets or edit application source for demo preparation.",
  parameters: z.toJSONSchema(commandArgs),
};
