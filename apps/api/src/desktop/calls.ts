import { randomUUID } from "node:crypto";
import { HttpError } from "../handlers/errors.js";
import { desktopConnections } from "./connections.js";

/**
 * Tool calls that run on the founder's computer, in the desktop app's main process.
 * The server owns each tool's schema (the model needs it). A call is sent to an
 * online desktop over its WebSocket; the desktop posts the result back over HTTP
 * (routes/desktop.ts), which resolves the waiting call here.
 *
 * The tool call is already persisted as a message before it runs (agent loop), so
 * the record of what was asked lives in PostgreSQL, not in the socket.
 */
type Outcome = { ok: true; result: unknown } | { ok: false; error: string };
type Pending = {
  userId: string;
  deviceId: string;
  settle: (outcome: Outcome) => void;
};
/** Calls sent to a desktop and waiting for its result, by execution ID. */
const pending = new Map<string, Pending>();

/** Sends one validated tool call to the user's most recently connected desktop and waits for its result. */
export async function callDesktop(
  context: {
    userId: string;
    taskId?: string;
    turnId?: string;
    signal?: AbortSignal;
  },
  name: string,
  tool: { timeoutMs: number; offline?: () => unknown },
  args: unknown,
) {
  const deviceId = desktopConnections.online(context.userId).at(-1);
  if (!deviceId) {
    if (tool.offline) return tool.offline();
    throw new HttpError(503, "The desktop app is not connected.");
  }
  const executionId = randomUUID();
  const outcome = await new Promise<Outcome>((resolve) => {
    const finish = (value: Outcome) => {
      clearTimeout(timer);
      context.signal?.removeEventListener("abort", abort);
      pending.delete(executionId);
      resolve(value);
    };
    const timer = setTimeout(
      () =>
        finish({
          ok: false,
          error:
            "The desktop app did not respond in time. It may still finish this call; its outcome is unknown.",
        }),
      tool.timeoutMs,
    );
    const abort = () => finish({ ok: false, error: "The turn was stopped." });
    context.signal?.addEventListener("abort", abort, { once: true });
    pending.set(executionId, {
      userId: context.userId,
      deviceId,
      settle: finish,
    });
    if (
      !desktopConnections.send(deviceId, "desktop_tool_execution", {
        executionId,
        taskId: context.taskId,
        turnId: context.turnId,
        tool: name,
        arguments: args,
        timeoutMs: tool.timeoutMs,
      })
    )
      finish({ ok: false, error: "The desktop app disconnected." });
  });
  if (!outcome.ok)
    throw new HttpError(
      502,
      `Desktop tool ${name} failed: ${outcome.error.slice(0, 500)}`,
    );
  return outcome.result;
}

/**
 * Delivers a desktop's result to the waiting call. Only the device the call was sent
 * to may answer it. Returns false when nothing is waiting (timed out or unknown).
 */
export function settleDesktopTool(
  device: { userId: string; deviceId: string },
  executionId: string,
  outcome: Outcome,
) {
  const call = pending.get(executionId);
  if (!call || call.userId !== device.userId || call.deviceId !== device.deviceId)
    return false;
  call.settle(outcome);
  return true;
}
