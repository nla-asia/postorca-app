import type { Database } from "../db.js";
import { HttpError } from "../handlers/errors.js";
import type { TaskKind } from "../repositories/tasks.js";
import { artifactTools } from "./artifacts.js";
import { brandTools } from "./brand.js";
import { desktopToolset } from "./desktop.js";
import { memoryTools } from "./memory.js";
import { questionTool } from "./questions.js";
import { socialPostTools } from "./social-posts.js";
import type { DispatchTask, Tool, ToolContext } from "./shared.js";
import {
  executePluginTool,
  isPluginRuntimeTool,
  loadPluginState,
  pluginToolDefinitions,
  type PluginState,
} from "../plugins/service.js";
import { taskTools } from "./tasks.js";

export type { DispatchTask } from "./shared.js";
export { questionRequestSchema, questionTool } from "./questions.js";

/** Every tool, in the order the model sees them. */
const tools: Tool[] = [
  ...brandTools,
  ...artifactTools,
  ...memoryTools,
  ...socialPostTools,
  ...desktopToolset,
  ...taskTools,
  questionTool,
];
const byName = new Map(tools.map((tool) => [tool.definition.name, tool]));

/** Tools offered to the model: the task kind's own tools, then plugin tools (src/plugins). */
export function toolsForTask(kind: TaskKind, plugins?: PluginState) {
  return [
    ...tools
      .filter((tool) => !tool.chatOnly || kind !== "work")
      .map((tool) => tool.definition),
    ...(plugins ? pluginToolDefinitions(plugins) : []),
  ];
}

/**
 * Runs one tool call for the founder's task. Throws HttpError for refusals the model
 * can act on, and ZodError for invalid arguments.
 */
export async function executeTool(
  db: Database,
  context: Omit<ToolContext, "db" | "dispatchTask"> & {
    /** The task's plugin state the model was given; read from the database if omitted. */
    plugins?: PluginState;
  },
  name: string,
  args: unknown,
  dispatchTask?: DispatchTask,
) {
  const { plugins, ...toolContext } = context;
  if (isPluginRuntimeTool(name))
    return executePluginTool(
      { ...toolContext, db },
      plugins ?? (await loadPluginState(db, context.taskId)),
      name,
      args,
    );
  const tool = byName.get(name);
  if (!tool) throw new HttpError(400, `Unknown tool ${name}.`);
  return tool.run({ ...toolContext, db, dispatchTask }, args);
}
