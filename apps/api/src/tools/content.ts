import { z } from "zod";
import { callDesktop } from "../desktop/calls.js";
import { HttpError } from "../handlers/errors.js";
import type { Queryable } from "../db.js";
import { object, type Tool, type ToolContext } from "./shared.js";

/**
 * A content task is one piece of content, made in stages: a plan, then a script the
 * founder approves, then the content. plan.md and script.md live in the task's folder
 * in the founder's working folder (tasks.content_dir), with the recordings and
 * exports; the task records when each was saved and when the script was approved.
 */
type ContentState = {
  work_type: string;
  title: string;
  content_dir: string | null;
  plan_saved_at: Date | null;
  script_saved_at: Date | null;
  script_turn_id: string | null;
  script_approved_at: Date | null;
};

async function contentState(db: Queryable, userId: string, taskId: string) {
  const {
    rows: [task],
  } = await db.query<ContentState>(
    `SELECT work_type, title, content_dir, plan_saved_at, script_saved_at, script_turn_id,
       script_approved_at FROM tasks WHERE id=$1 AND user_id=$2`,
    [taskId, userId],
  );
  if (!task) throw new HttpError(404, "Task not found.");
  return task;
}

async function contentTask(context: ToolContext) {
  const task = await contentState(context.db, context.userId, context.taskId);
  if (task.work_type !== "content")
    throw new HttpError(
      400,
      "Only a content task has a plan and a script; start one with work_type content.",
    );
  return task;
}

/** Tools that make the content itself: they wait for an approved script. */
export const contentProduction = new Set([
  "screen_capture",
  "screen_record_start",
  "video_export",
  "media_generate_speech",
  "media_generate_music",
  "media_generate_image",
  "media_edit_image",
]);

/**
 * On a content task, refuses a tool that makes content until plan.md and script.md
 * are saved and the founder has approved the script. Other tasks are not affected.
 */
export async function requireApprovedScript(
  db: Queryable,
  context: { userId: string; taskId: string },
  name: string,
) {
  if (!contentProduction.has(name)) return;
  const task = await contentState(db, context.userId, context.taskId);
  if (task.work_type !== "content") return;
  if (!task.plan_saved_at || !task.script_saved_at)
    throw new HttpError(
      409,
      `A content task starts with a plan and a script: save plan.md and script.md with save_content_file, then reply with the script for the founder to review, and stop. ${name} waits until they approve it.`,
    );
  if (!task.script_approved_at)
    throw new HttpError(
      409,
      `The founder hasn't approved the script yet. Reply with it for their review and stop; when they approve it, record that with approve_content_script. ${name} waits until then.`,
    );
}

const fileArgs = z
  .object({
    name: z.enum(["plan.md", "script.md"]),
    text: z.string().trim().min(1).max(50_000),
  })
  .strict();

/** The folder a new content task gets, inside the working folder, named for the task. */
const folderFor = (title: string) =>
  "Content/" +
  (title
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "Untitled");

export const contentTools: Tool[] = [
  {
    definition: {
      name: "save_content_file",
      description:
        "On a content task, save its plan (plan.md: what the content is for, who it's for, the format, what it shows and what was assumed or left out) or its script (script.md: numbered shots with what's on screen, on-screen text and the voiceover line) into the task's folder in the founder's working folder. The first save creates the folder. Both come before any content is made; saving the script asks for the founder's approval again. Needs the desktop app.",
      parameters: object(
        {
          name: { type: "string", enum: ["plan.md", "script.md"] },
          text: { type: "string", description: "The whole file, in Markdown." },
        },
        ["name", "text"],
      ),
    },
    run: async (context, rawArgs) => {
      const { name, text } = fileArgs.parse(rawArgs);
      const task = await contentTask(context);
      const saved = (await callDesktop(
        context,
        "write_content_file",
        { timeoutMs: 15_000 },
        task.content_dir
          ? { folder: task.content_dir, name, text }
          : { folder: folderFor(task.title), name, text, new_folder: true },
      )) as { folder: string; path: string };
      await context.db.query(
        name === "plan.md"
          ? "UPDATE tasks SET content_dir=$3, plan_saved_at=now() WHERE id=$1 AND user_id=$2"
          : `UPDATE tasks SET content_dir=$3, script_saved_at=now(),
               script_turn_id=COALESCE(script_turn_id, $4), script_approved_at=NULL
             WHERE id=$1 AND user_id=$2`,
        name === "plan.md"
          ? [context.taskId, context.userId, saved.folder]
          : [context.taskId, context.userId, saved.folder, context.turnId],
      );
      return {
        path: saved.path,
        ...(name === "script.md" && {
          message:
            "Saved. Reply with the script for the founder to review and stop; nothing is recorded or made until they approve it.",
        }),
      };
    },
  },
  {
    definition: {
      name: "approve_content_script",
      description:
        "Record that the founder approved the content task's script, after they said so in a reply (as it is, or with changes you then saved). Never on your own judgment: only the founder approves.",
      parameters: object(
        {
          founder_words: {
            type: "string",
            description: "What the founder said that approves it, quoted.",
          },
        },
        ["founder_words"],
      ),
    },
    run: async (context, rawArgs) => {
      z.object({ founder_words: z.string().trim().min(1).max(2000) })
        .strict()
        .parse(rawArgs);
      const task = await contentTask(context);
      if (!task.plan_saved_at || !task.script_saved_at)
        throw new HttpError(409, "Save plan.md and script.md first.");
      // The turn that wrote the script ends with it for review: approval is a reply.
      if (task.script_turn_id === context.turnId)
        throw new HttpError(
          409,
          "The founder hasn't replied to the script yet. Reply with it for their review and stop.",
        );
      await context.db.query(
        "UPDATE tasks SET script_approved_at=now() WHERE id=$1 AND user_id=$2",
        [context.taskId, context.userId],
      );
      return { approved: true };
    },
  },
];
