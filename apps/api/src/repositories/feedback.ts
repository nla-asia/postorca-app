import type { Queryable } from "../db.js";

const MAX_TASKS = 30;
const MAX_TEXT = 4000;
const cut = (text: string) =>
  text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text;

/** What Orca changed in a draft in answer to the founder: edit_document's arguments. */
type DraftChange = { find: string; replace: string }[] | { content: string };

/**
 * The founder's messages in content work (tasks.work_type 'content') since `since`,
 * for the daily voice review: per task, the first draft, each message the founder
 * sent with what Orca changed and said in that turn, and the drafts as they are now.
 * A task's first message is the routine's or chat's instructions, never feedback.
 */
export async function contentFeedback(
  db: Queryable,
  userId: string,
  since: Date,
) {
  const { rows: tasks } = await db.query(
    `SELECT t.id, t.title, t.platform FROM tasks t
     WHERE t.user_id = $1 AND t.kind = 'work' AND t.work_type = 'content'
       AND EXISTS (
         SELECT 1 FROM messages m JOIN turns r ON r.id = m.turn_id
         WHERE r.task_id = t.id AND m.kind = 'user' AND m.created_at >= $2
           AND m.id > (SELECT min(f.id) FROM messages f JOIN turns fr ON fr.id = f.turn_id
                       WHERE fr.task_id = t.id AND f.kind = 'user'))
     ORDER BY t.created_at, t.id LIMIT ${MAX_TASKS}`,
    [userId, since],
  );
  const result = [];
  for (const task of tasks) {
    const { rows: messages } = await db.query(
      `SELECT m.id, m.turn_id, m.kind, m.content, m.created_at FROM messages m
       JOIN turns r ON r.id = m.turn_id WHERE r.task_id = $1 ORDER BY m.id`,
      [task.id],
    );
    const { rows: drafts } = await db.query(
      "SELECT title, content FROM artifacts WHERE task_id = $1 AND kind = 'document' ORDER BY created_at, id",
      [task.id],
    );
    const firstUser = messages.find((m) => m.kind === "user");
    const firstDrafts: string[] = [];
    const feedback: {
      at: string;
      founder: string;
      changes: DraftChange[];
      orca: string;
    }[] = [];
    let current: (typeof feedback)[number] | undefined;
    for (const message of messages) {
      if (message.kind === "user" && message.id !== firstUser.id) {
        current = {
          at: new Date(message.created_at).toISOString(),
          founder: cut(message.content.text ?? ""),
          changes: [],
          orca: "",
        };
        // Only the window's messages are new feedback; earlier ones were reviewed before.
        if (new Date(message.created_at) >= since) feedback.push(current);
        continue;
      }
      if (message.kind === "tool_call") {
        const args = JSON.parse(message.content.arguments || "{}");
        if (
          !current &&
          message.content.name === "create_artifact" &&
          args.kind === "document"
        )
          firstDrafts.push(cut(args.content));
        if (current && message.content.name === "edit_document")
          current.changes.push(
            args.edits
              ? args.edits.map((e: { find: string; replace: string }) => ({
                  find: cut(e.find),
                  replace: cut(e.replace),
                }))
              : { content: cut(args.content ?? "") },
          );
      }
      if (current && message.kind === "assistant" && message.content.text)
        current.orca = cut(message.content.text);
    }
    if (!feedback.length) continue;
    result.push({
      task_id: task.id,
      title: task.title,
      platform: task.platform,
      first_drafts: firstDrafts,
      feedback,
      drafts_now: drafts.map((d) => ({
        title: d.title,
        content: cut(d.content),
      })),
    });
  }
  return result;
}
