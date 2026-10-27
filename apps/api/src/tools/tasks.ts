import { z } from "zod";
import { HttpError } from "../handlers/errors.js";
import {
  createTurn,
  createWorkTask,
  ownedTask,
  taskDetail,
} from "../repositories/tasks.js";
import { platforms } from "../schemas/platforms.js";
import {
  object,
  requireChatTask,
  type DispatchTask,
  type Tool,
  type ToolContext,
} from "./shared.js";

const CHAT_ONLY = "Task-management tools are available from Agent chat only.";
const message = z.string().trim().min(1).max(30000);

function backgroundDispatch(context: ToolContext): DispatchTask {
  if (!context.dispatchTask)
    throw new HttpError(503, "Background execution is unavailable.");
  return context.dispatchTask;
}

/** The founder's own background work task named by the model. */
async function workTask(context: ToolContext, taskId: string) {
  const task = await ownedTask(context.db, context.userId, taskId);
  if (task.kind !== "work") throw new HttpError(400, "Use an execution task ID.");
  return task;
}

/** Chat tools for handing work to background tasks that land in the Inbox. */
export const taskTools: Tool[] = [
  {
    definition: {
      name: "start_task",
      description:
        "Start work requested by the founder as a separate background execution task. Returns immediately with its ID; completed work lands in the founder's Inbox for review. Tell the founder this instead of waiting or repeatedly polling. Include all relevant context and instructions, since the worker does not receive this chat's history.",
      parameters: object(
        {
          title: { type: "string" },
          instructions: { type: "string" },
          platform: { type: "string", enum: [...platforms] },
        },
        ["title", "instructions"],
      ),
    },
    chatOnly: true,
    run: async (context, args) => {
      await requireChatTask(context, CHAT_ONLY);
      const data = z
        .object({
          title: z.string().trim().min(1).max(200),
          instructions: message,
          platform: z.enum(platforms).optional(),
        })
        .strict()
        .parse(args);
      const dispatch = backgroundDispatch(context);
      const { task, turn } = await createWorkTask(
        context.db,
        context.userId,
        data.title,
        data.instructions,
        data.platform,
      );
      dispatch(task.id, turn.id, context.userId);
      return {
        task_id: task.id,
        turn_id: turn.id,
        status: turn.status,
        message:
          "This task is running in the background. It will appear in your Inbox for review when finished.",
      };
    },
  },
  {
    definition: {
      name: "get_task",
      description:
        "Read an execution task's current status, messages, and artifacts by ID when the founder asks about its progress or results. This does not wait for completion or change the task.",
      parameters: object({ task_id: { type: "string" } }, ["task_id"]),
    },
    chatOnly: true,
    run: async (context, args) => {
      await requireChatTask(context, CHAT_ONLY);
      const { task_id } = z.object({ task_id: z.uuid() }).strict().parse(args);
      const task = await workTask(context, task_id);
      return taskDetail(context.db, context.userId, task.id);
    },
  },
  {
    definition: {
      name: "follow_up_task",
      description:
        "Send the founder's feedback to an existing execution task. Starts a new turn in that same task and returns immediately. Use the known task ID rather than creating duplicate work. An already-running or archived task cannot accept a follow-up.",
      parameters: object(
        { task_id: { type: "string" }, message: { type: "string" } },
        ["task_id", "message"],
      ),
    },
    chatOnly: true,
    run: async (context, args) => {
      await requireChatTask(context, CHAT_ONLY);
      const data = z
        .object({ task_id: z.uuid(), message })
        .strict()
        .parse(args);
      const task = await workTask(context, data.task_id);
      const dispatch = backgroundDispatch(context);
      const turn = await createTurn(
        context.db,
        context.userId,
        task.id,
        data.message,
      );
      dispatch(task.id, turn.id, context.userId);
      return {
        task_id: task.id,
        turn_id: turn.id,
        status: turn.status,
        message:
          "The follow-up is running in the same task. Its updated work will appear in your Inbox for review when finished.",
      };
    },
  },
];
