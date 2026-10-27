import { z } from "zod";
import type { Database } from "../db.js";
import { HttpError } from "../handlers/errors.js";
import type { ToolDefinition } from "../providers/types.js";
import { ownedTask } from "../repositories/tasks.js";

/** Queues a turn for the agent once its task and turn are saved. */
export type DispatchTask = (
  taskId: string,
  turnId: string,
  userId: string,
) => void;

/** What a tool call runs with: the founder, the task and turn making the call. */
export type ToolContext = {
  db: Database;
  userId: string;
  taskId: string;
  turnId: string;
  signal?: AbortSignal;
  /** Absent when background execution is unavailable. */
  dispatchTask?: DispatchTask;
};

/**
 * One tool: the definition the model sees and the code that runs it, kept together.
 * chatOnly tools are offered in Agent chat and onboarding, never in background work.
 */
export type Tool = {
  definition: ToolDefinition;
  chatOnly?: boolean;
  run(context: ToolContext, args: unknown): Promise<unknown>;
};

/** A strict JSON Schema object for tool parameters. */
export const object = (
  properties: Record<string, unknown>,
  required: string[],
) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

export const editsParameter = {
  type: "array",
  items: object(
    { find: { type: "string" }, replace: { type: "string" } },
    ["find", "replace"],
  ),
};
export const editsSchema = z
  .array(z.object({ find: z.string().min(1), replace: z.string() }).strict())
  .min(1);

/** Applies find/replace edits in order; each find must appear exactly once. */
export function applyEdits(
  content: string,
  edits: { find: string; replace: string }[],
  /** Completes "is not in the current …", naming what to read for the exact text. */
  source: string,
) {
  for (const [index, edit] of edits.entries()) {
    const count = content.split(edit.find).length - 1;
    if (count !== 1)
      throw new HttpError(
        400,
        `Edit ${index + 1}: the find text ${count ? `appears ${count} times; include more surrounding text so it matches once` : `is not in the current ${source} for its exact current text`}. No edits were saved.`,
      );
    content = content.replace(edit.find, () => edit.replace);
  }
  return content;
}

/** Rejects a chat-only tool called from background work, after checking task ownership. */
export async function requireChatTask(context: ToolContext, refusal: string) {
  const task = await ownedTask(context.db, context.userId, context.taskId);
  if (task.kind === "work") throw new HttpError(400, refusal);
}
