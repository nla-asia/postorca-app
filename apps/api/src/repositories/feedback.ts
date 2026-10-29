import type { Queryable } from "../db.js";

const MAX_TASKS = 30;
const MAX_TEXT = 4000;

/**
 * The founder's messages in content work (tasks.work_type 'content') since `since`,
 * for the daily voice review, grouped by task. A task's first message is the
 * routine's or chat's instructions, never feedback.
 */
export async function contentFeedback(
  db: Queryable,
  userId: string,
  since: Date,
) {
  const { rows } = await db.query(
    `SELECT t.id, t.title, t.platform, m.content->>'text' AS text, m.created_at
     FROM tasks t JOIN turns r ON r.task_id = t.id JOIN messages m ON m.turn_id = r.id
     WHERE t.user_id = $1 AND t.kind = 'work' AND t.work_type = 'content'
       AND m.kind = 'user' AND m.created_at >= $2
       AND m.id > (SELECT min(f.id) FROM messages f JOIN turns fr ON fr.id = f.turn_id
                   WHERE fr.task_id = t.id AND f.kind = 'user')
     ORDER BY t.created_at, t.id, m.id`,
    [userId, since],
  );
  const tasks = new Map<
    string,
    {
      task_id: string;
      title: string;
      platform: string | null;
      messages: { at: string; text: string }[];
    }
  >();
  for (const row of rows) {
    if (!tasks.has(row.id)) {
      if (tasks.size === MAX_TASKS) break;
      tasks.set(row.id, {
        task_id: row.id,
        title: row.title,
        platform: row.platform,
        messages: [],
      });
    }
    tasks.get(row.id)!.messages.push({
      at: new Date(row.created_at).toISOString(),
      text: (row.text ?? "").slice(0, MAX_TEXT),
    });
  }
  return [...tasks.values()];
}
