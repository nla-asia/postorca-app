import { z } from "zod";
import type { Database } from "../db.js";
import { HttpError } from "../handlers/errors.js";
import { memoryIndex } from "../memory.js";
import { loadPluginState } from "../plugins/service.js";
import { ContextTooLongError, type Provider } from "../providers/types.js";
import { getProfile } from "../repositories/brand.js";
import { appendMessage, taskKind } from "../repositories/tasks.js";
import {
  claimQueuedTurn,
  completeTurn,
  failTurn,
} from "../repositories/turns.js";
import {
  executeTool,
  questionTool,
  toolsForTask,
  type DispatchTask,
} from "../tools/index.js";
import { compactTask, loadModelContext } from "./context.js";
import { systemPrompt } from "./prompts.js";
import { writeTurnTrace } from "./trace.js";

/**
 * Per-turn limits on model responses ("steps"). The last step gets no tools, so a turn
 * that runs out ends with an answer from what was done instead of failing. Inbox work
 * runs unattended and gets more room than chat.
 */
const LIMITS = {
  chat: { ms: 6 * 60_000, responses: 30 },
  work: { ms: 45 * 60_000, responses: 100 },
};
/** Abort reasons, saved as the failed turn's error for the founder. */
const timedOut = (ms: number) =>
  `This turn reached its ${ms / 60_000}-minute time limit before finishing. Send a follow-up to continue.`;
const SERVER_STOPPED =
  "The server restarted while Orca was working on this turn. Send a follow-up to continue.";
const FAILED = "Orca could not complete this turn. Please try a follow-up.";

/** The model kept calling tools on a step that offered none. */
class ActionLimitError extends Error {
  constructor() {
    super("Orca reached the action limit for this turn.");
  }
}

/**
 * What a failed tool call tells the model. Refusals and argument problems are
 * described so it can correct the call; other failures stay generic so internals
 * don't leak into the context.
 */
function toolError(error: unknown) {
  if (error instanceof HttpError) return error.message;
  if (error instanceof z.ZodError)
    return `Invalid arguments:\n${z.prettifyError(error).slice(0, 1500)}`;
  if (error instanceof SyntaxError) return "The arguments are not valid JSON.";
  return "The tool could not complete. Check its arguments and try again.";
}

/** Runs one claimed turn: model responses and their tool calls until Orca answers. */
export class AgentLoop {
  private active = new Map<string, AbortController>();
  constructor(
    private db: Database,
    private provider: Provider,
    private dispatchTask?: DispatchTask,
  ) {}

  async run(taskId: string, turnId: string, userId: string) {
    // Another worker, or an earlier dispatch of the same turn, already has it.
    if (!(await claimQueuedTurn(this.db, taskId, turnId))) return;
    const controller = new AbortController();
    this.active.set(turnId, controller);
    let deadline = setTimeout(
      () => controller.abort(timedOut(LIMITS.chat.ms)),
      LIMITS.chat.ms,
    );
    try {
      const task = await taskKind(this.db, taskId);
      if (!task) throw new Error(`Task ${taskId} no longer exists.`);
      const limits = task.kind === "work" ? LIMITS.work : LIMITS.chat;
      clearTimeout(deadline);
      deadline = setTimeout(
        () => controller.abort(timedOut(limits.ms)),
        limits.ms,
      );
      const memory = await memoryIndex(userId);
      for (let step = 1; step <= limits.responses; step++) {
        controller.signal.throwIfAborted();
        // Re-read each step: tools such as update_brand_profile change it mid-turn.
        const profile = await getProfile(this.db, userId);
        // Activation changes the task's plugin mid-turn, so it is re-read too.
        const plugins = await loadPluginState(this.db, taskId);
        const lastStep = step === limits.responses;
        const trace = { taskId, turnId, step };
        const instructions = systemPrompt({
          task,
          profile,
          plugins,
          memory,
          lastStep,
        });
        const respond = async () =>
          this.provider.respond({
            instructions,
            messages: await loadModelContext(
              this.db,
              this.provider,
              { taskId, userId },
              { instructions, signal: controller.signal, trace },
            ),
            tools: lastStep ? [] : toolsForTask(task.kind, plugins),
            cacheKey: taskId,
            signal: controller.signal,
            trace,
          });
        let response;
        try {
          response = await respond();
        } catch (error) {
          // The estimate missed: compact down to the current step and retry once.
          if (
            !(error instanceof ContextTooLongError) ||
            !(await compactTask(this.db, this.provider, taskId, {
              keepSteps: 1,
              signal: controller.signal,
              trace: { ...trace, step: `${step}-compaction` },
            }))
          )
            throw error;
          response = await respond();
        }
        controller.signal.throwIfAborted();
        await appendMessage(this.db, turnId, "assistant", {
          text: response.text,
          ...(response.replay ? { replay: response.replay } : {}),
        });
        let awaitingInput = false;
        for (const call of response.calls) {
          await appendMessage(this.db, turnId, "tool_call", call);
          let result: unknown;
          try {
            controller.signal.throwIfAborted();
            result = await executeTool(
              this.db,
              { userId, taskId, turnId, signal: controller.signal, plugins },
              call.name,
              JSON.parse(call.arguments),
              this.dispatchTask,
            );
          } catch (error) {
            // Every call gets a result, even after an abort, so the history the
            // provider replays never has an unanswered call. The next step's abort
            // check then ends the turn.
            result = { error: toolError(error) };
          }
          await appendMessage(this.db, turnId, "tool_result", {
            callId: call.callId,
            result,
          });
          if (
            call.name === questionTool.definition.name &&
            (result as { status?: string } | undefined)?.status ===
              "awaiting_user_input"
          )
            awaitingInput = true;
        }
        // A question ends the turn until the founder answers.
        if (!response.calls.length || awaitingInput) {
          await completeTurn(this.db, turnId);
          return;
        }
      }
      throw new ActionLimitError();
    } catch (error) {
      const message = controller.signal.aborted
        ? String(controller.signal.reason)
        : error instanceof ActionLimitError
          ? error.message
          : FAILED;
      // The founder sees the short message; the cause goes to the turn's trace.
      console.error(`Agent turn ${turnId} failed:`, error);
      await writeTurnTrace({ taskId, turnId, step: "turn" }, "error", {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      await failTurn(this.db, turnId, message);
    } finally {
      clearTimeout(deadline);
      this.active.delete(turnId);
    }
  }

  /** Aborts every running turn; each fails with a message asking for a follow-up. */
  stop() {
    for (const controller of this.active.values())
      controller.abort(SERVER_STOPPED);
  }
}
