import type { Database } from "../db.js";
import { HttpError } from "../handlers/errors.js";
import type { TaskKind } from "../repositories/tasks.js";
import { artifactTools } from "./artifacts.js";
import { brandTools } from "./brand.js";
import { memoryTools } from "./memory.js";
import { questionTool } from "./questions.js";
import type { DispatchTask, Tool, ToolContext } from "./shared.js";
import { taskTools } from "./tasks.js";

export type { DispatchTask } from "./shared.js";
export { questionRequestSchema, questionTool } from "./questions.js";

/** Every tool, in the order the model sees them. */
const tools: Tool[] = [
  ...brandTools,
  ...artifactTools,
  ...memoryTools,
  ...taskTools,
  questionTool,
];
const byName = new Map(tools.map((tool) => [tool.definition.name, tool]));

/** Tools offered to the model for a task of this kind. */
export function toolsForTask(kind: TaskKind) {
  return tools
    .filter((tool) => !tool.chatOnly || kind !== "work")
    .map((tool) => tool.definition);
}

/**
 * Runs one tool call for the founder's task. Throws HttpError for refusals the model
 * can act on, and ZodError for invalid arguments.
 */
export async function executeTool(
  db: Database,
  context: Omit<ToolContext, "db" | "dispatchTask">,
  name: string,
  args: unknown,
  dispatchTask?: DispatchTask,
) {
  const tool = byName.get(name);
  if (!tool) throw new HttpError(400, `Unknown tool ${name}.`);
  return tool.run({ ...context, db, dispatchTask }, args);
}
