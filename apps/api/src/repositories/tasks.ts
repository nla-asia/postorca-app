import { transaction, type Database, type Queryable } from "../db.js";
import { HttpError } from "../handlers/errors.js";
import type { StoredMessage } from "../schemas/tasks.js";
import { completeTurn } from "./turns.js";

/** Agent chat and onboarding (one conversation each per founder), or Inbox work. */
export const TASK_KINDS = ["chat", "onboarding", "work"] as const;
export type TaskKind = (typeof TASK_KINDS)[number];
export async function ownedTask(db: Queryable, userId: string, taskId: string) {
  const {
    rows: [task],
  } = await db.query(
    "SELECT t.*,r.status FROM tasks t LEFT JOIN turns r ON r.id=t.current_turn_id WHERE t.id=$1 AND t.user_id=$2",
    [taskId, userId],
  );
  if (!task) throw new HttpError(404, "Task not found.");
  return task;
}
/**
 * JSON that PostgreSQL accepts: page text can hold half of an emoji (a snapshot cut
 * mid-pair) or a NUL character, and jsonb rejects both, which would fail the turn.
 */
const loneSurrogate =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
export const storableJson = (value: unknown) =>
  JSON.stringify(value, (_key, item) =>
    typeof item === "string"
      ? item.replace(loneSurrogate, "\uFFFD").replace(/\u0000/g, "")
      : item,
  );

export async function appendMessage(
  db: Queryable,
  turnId: string,
  kind: StoredMessage["kind"],
  content: unknown,
) {
  const {
    rows: [message],
  } = await db.query(
    "INSERT INTO messages(turn_id,kind,content) VALUES ($1,$2,$3) RETURNING *",
    [turnId, kind, storableJson(content)],
  );
  return message;
}
export async function taskHistory(
  db: Queryable,
  taskId: string,
  afterMessageId = "0",
): Promise<StoredMessage[]> {
  return (
    await db.query(
      "SELECT m.* FROM messages m JOIN turns t ON t.id=m.turn_id WHERE t.task_id=$1 AND m.id>$2 ORDER BY m.id",
      [taskId, afterMessageId],
    )
  ).rows;
}

export async function createTurn(
  db: Database,
  userId: string,
  taskId: string,
  text: string,
) {
  return transaction(db, (client) =>
    createTurnInTransaction(client, userId, taskId, text),
  );
}

async function createTurnInTransaction(
  client: Queryable,
  userId: string,
  taskId: string,
  text?: string,
) {
  const {
    rows: [task],
  } = await client.query(
    "SELECT * FROM tasks WHERE id=$1 AND user_id=$2 FOR UPDATE",
    [taskId, userId],
  );
  if (!task) throw new HttpError(404, "Task not found.");
  if (task.archived_at) throw new HttpError(409, "This task is archived.");
  if (task.current_turn_id) {
    const {
      rows: [current],
    } = await client.query("SELECT status FROM turns WHERE id=$1", [
      task.current_turn_id,
    ]);
    if (["queued", "running"].includes(current.status))
      throw new HttpError(409, "Orca is already working on this task.");
  }
  const {
    rows: [turn],
  } = await client.query("INSERT INTO turns(task_id) VALUES ($1) RETURNING *", [
    taskId,
  ]);
  if (text !== undefined)
    await appendMessage(client, turn.id, "user", { text });
  await client.query(
    "UPDATE tasks SET current_turn_id=$2,approved_at=NULL WHERE id=$1",
    [taskId, turn.id],
  );
  return turn;
}

/** Open the onboarding conversation, if it has no messages yet, with a fixed first question. */
export async function startOnboarding(
  db: Database,
  userId: string,
  taskId: string,
) {
  return transaction(db, async (client) => {
    // Same lock order as normal turns: task first, then profile.
    const task = await client.query(
      "SELECT id FROM tasks WHERE id=$1 AND user_id=$2 AND kind='onboarding' FOR UPDATE",
      [taskId, userId],
    );
    if (!task.rowCount) throw new HttpError(404, "Onboarding not found.");
    const {
      rows: [profile],
    } = await client.query(
      "SELECT onboarding_status FROM brand_profiles WHERE user_id=$1 FOR UPDATE",
      [userId],
    );
    if (profile.onboarding_status === "completed") return null;
    // Only an empty conversation opens itself; existing history waits for the founder.
    const history = await client.query(
      "SELECT 1 FROM messages m JOIN turns t ON t.id=m.turn_id WHERE t.task_id=$1 LIMIT 1",
      [taskId],
    );
    if (history.rowCount) return null;
    const turn = await createTurnInTransaction(client, userId, taskId);
    await appendMessage(client, turn.id, "assistant", {
      text: "Hi, I’m Orca. Let’s set up your brand profile—it takes about 3 minutes. We’ll cover what you’re building, choose the platforms to grow your brand on, add those accounts, and pick the topics you want to share, then confirm the profile together. You can pick from the suggestions or write your own answers.\n\nTo start: what are you building?",
    });
    // The opening is fixed text, so it completes without a model call;
    // Orca picks up from the founder's first reply.
    await completeTurn(client, turn.id);
    await client.query(
      "UPDATE brand_profiles SET onboarding_status='in_progress' WHERE user_id=$1",
      [userId],
    );
    return turn;
  });
}

/** Create the work container and its initial turn atomically, before dispatch. */
export async function createWorkTask(
  db: Database,
  userId: string,
  title: string,
  instructions: string,
  platform?: string,
) {
  return transaction(db, async (client) => {
    const {
      rows: [task],
    } = await client.query(
      "INSERT INTO tasks(user_id,kind,title,platform) VALUES ($1,'work',$2,$3) RETURNING *",
      [userId, title, platform ?? null],
    );
    const turn = await createTurnInTransaction(
      client,
      userId,
      task.id,
      instructions,
    );
    return { task, turn };
  });
}

/** Shared founder-visible detail. Provider replay stays inside the agent loop. */
export async function taskDetail(
  db: Queryable,
  userId: string,
  taskId: string,
) {
  const task = await ownedTask(db, userId, taskId);
  const turns = (
    await db.query(
      "SELECT * FROM turns WHERE task_id=$1 ORDER BY started_at,id",
      [taskId],
    )
  ).rows;
  const messages = (
    await db.query(
      "SELECT m.* FROM messages m JOIN turns t ON t.id=m.turn_id WHERE t.task_id=$1 ORDER BY m.id",
      [taskId],
    )
  ).rows;
  const artifacts =
    // Ideas carry the content work queued from them (routines.source_artifact_id).
    (
      await db.query(
        `SELECT a.*, CASE WHEN ro.id IS NOT NULL THEN jsonb_build_object(
          'routine_id', ro.id,
          'run_at', to_char(ro.run_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          'task_id', lr.task_id, 'status', lt.status) END AS content_work
       FROM artifacts a
       LEFT JOIN routines ro ON ro.source_artifact_id = a.id
       LEFT JOIN LATERAL (SELECT task_id FROM routine_runs WHERE routine_id = ro.id
         ORDER BY created_at DESC LIMIT 1) lr ON true
       LEFT JOIN tasks ct ON ct.id = lr.task_id
       LEFT JOIN turns lt ON lt.id = ct.current_turn_id
       WHERE a.task_id=$1 ORDER BY a.created_at, a.id`,
        [taskId],
      )
    ).rows;
  return {
    ...task,
    turns: turns.map((turn) => ({
      ...turn,
      messages: messages
        .filter((message) => message.turn_id === turn.id)
        .map(({ content, ...message }) => ({
          ...message,
          content:
            message.kind === "assistant" ? { text: content.text } : content,
        })),
      artifacts: artifacts.filter((artifact) => artifact.turn_id === turn.id),
    })),
  };
}

/** A founder has one Agent chat: creating it again returns the existing one. */
export async function createTask(
  db: Queryable,
  userId: string,
  kind: TaskKind,
  title: string,
) {
  // Agent chat and onboarding are one conversation per founder; reuse it.
  const {
    rows: [task],
  } =
    kind !== "work"
      ? await db.query(
          `INSERT INTO tasks(user_id,kind,title) VALUES ($1,$2,$3) ON CONFLICT (user_id) WHERE kind='${kind}' DO UPDATE SET user_id=EXCLUDED.user_id RETURNING *`,
          [userId, kind, title],
        )
      : await db.query(
          "INSERT INTO tasks(user_id,kind,title) VALUES ($1,'work',$2) RETURNING *",
          [userId, title],
        );
  return task;
}

/** Newest tasks first, with live status, routine, and the latest assistant text. */
export async function listTasks(
  db: Queryable,
  userId: string,
  kind?: TaskKind,
) {
  return (
    await db.query(
      `SELECT t.*,r.status,r.finished_at,CASE WHEN ro.run_at IS NULL THEN ro.title END AS routine_title,
        (SELECT left(m.content->>'text',280) FROM messages m JOIN turns mt ON mt.id=m.turn_id
         WHERE mt.task_id=t.id AND m.kind='assistant' AND coalesce(m.content->>'text','')<>''
         ORDER BY m.id DESC LIMIT 1) AS summary
       FROM tasks t LEFT JOIN turns r ON r.id=t.current_turn_id
       LEFT JOIN routine_runs rr ON rr.task_id=t.id LEFT JOIN routines ro ON ro.id=rr.routine_id
       WHERE t.user_id=$1 AND ($2::text IS NULL OR t.kind=$2) ORDER BY t.created_at DESC,t.id LIMIT 100`,
      [userId, kind ?? null],
    )
  ).rows;
}

/** Kind and platform the agent loop needs to set a turn's limits and context. */
export async function taskKind(
  db: Queryable,
  taskId: string,
): Promise<{ kind: TaskKind; platform: string | null } | undefined> {
  return (
    await db.query("SELECT kind, platform FROM tasks WHERE id=$1", [taskId])
  ).rows[0];
}

/** Approve or archive finished work. Repeating an action keeps the first timestamp. */
export async function reviewTask(
  db: Database,
  userId: string,
  taskId: string,
  action: "approve" | "archive",
) {
  return transaction(db, async (client) => {
    await client.query(
      "SELECT id FROM tasks WHERE id=$1 AND user_id=$2 FOR UPDATE",
      [taskId, userId],
    );
    const current = await ownedTask(client, userId, taskId);
    if (["queued", "running"].includes(current.status))
      throw new HttpError(
        409,
        "Wait for Orca to finish before reviewing this work.",
      );
    if (action === "approve" && current.status !== "completed")
      throw new HttpError(409, "Only completed work can be approved.");
    const field = action === "approve" ? "approved_at" : "archived_at";
    return (
      await client.query(
        `UPDATE tasks SET ${field}=COALESCE(${field},now()) WHERE id=$1 RETURNING *`,
        [taskId],
      )
    ).rows[0];
  });
}
