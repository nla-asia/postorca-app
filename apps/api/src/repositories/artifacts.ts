import type { Queryable } from "../db.js";

export async function createArtifact(
  db: Queryable,
  taskId: string,
  turnId: string,
  artifact: {
    kind: "document" | "idea" | "url" | "image" | "audio" | "video" | "reply";
    title: string;
    content: string;
  },
) {
  const {
    rows: [saved],
  } = await db.query(
    "INSERT INTO artifacts(task_id,turn_id,kind,title,content) VALUES ($1,$2,$3,$4,$5) RETURNING *",
    [taskId, turnId, artifact.kind, artifact.title, artifact.content],
  );
  return saved;
}

/** One of a task's artifacts with its current content, or undefined. */
export async function taskArtifact(
  db: Queryable,
  taskId: string,
  artifactId: string,
) {
  const {
    rows: [artifact],
  } = await db.query<{
    id: string;
    kind: string;
    title: string;
    content: string;
  }>("SELECT id,kind,title,content FROM artifacts WHERE id=$1 AND task_id=$2", [
    artifactId,
    taskId,
  ]);
  return artifact;
}

/** A task's artifacts, oldest first, without their content. */
export async function listArtifacts(db: Queryable, taskId: string) {
  const { rows } = await db.query(
    "SELECT id,kind,title FROM artifacts WHERE task_id=$1 ORDER BY created_at, id",
    [taskId],
  );
  return rows;
}

/** Only document artifacts are editable. Returns undefined when none matches. */
export async function updateDocumentArtifact(
  db: Queryable,
  taskId: string,
  artifactId: string,
  content: string,
) {
  const {
    rows: [artifact],
  } = await db.query(
    "UPDATE artifacts SET content=$3 WHERE id=$1 AND task_id=$2 AND kind='document' RETURNING *",
    [artifactId, taskId, content],
  );
  return artifact;
}

/**
 * The founder's changes to a reply: new text (content is already validated JSON)
 * and/or what they did with it. A null state undoes Done or Skip.
 */
export async function updateReplyArtifact(
  db: Queryable,
  taskId: string,
  artifactId: string,
  change: { content?: string; state?: "done" | "skipped" | null },
) {
  const {
    rows: [artifact],
  } = await db.query(
    `UPDATE artifacts SET content = coalesce($3, content),
       state = CASE WHEN $4 THEN $5 ELSE state END,
       state_at = CASE WHEN $4 THEN CASE WHEN $5::text IS NULL THEN NULL ELSE now() END ELSE state_at END
     WHERE id = $1 AND task_id = $2 AND kind = 'reply' RETURNING *`,
    [artifactId, taskId, change.content ?? null, change.state !== undefined, change.state ?? null],
  );
  return artifact;
}

/** Deletes one of a task's artifacts. Returns undefined when none matches. */
export async function deleteArtifact(
  db: Queryable,
  taskId: string,
  artifactId: string,
) {
  const {
    rows: [artifact],
  } = await db.query(
    "DELETE FROM artifacts WHERE id=$1 AND task_id=$2 RETURNING id,title",
    [artifactId, taskId],
  );
  return artifact;
}

/**
 * The founder's recent content ideas (idea artifacts on work that isn't archived),
 * newest first, with whether content is already queued for each.
 */
export async function recentIdeas(
  db: Queryable,
  userId: string,
  options: { days: number; limit: number; platform?: string },
) {
  const { rows } = await db.query(
    `SELECT a.id AS idea_id, a.title, left(a.content, 2000) AS content, t.platform,
       a.created_at, EXISTS (SELECT 1 FROM routines r WHERE r.source_artifact_id = a.id) AS content_queued
     FROM artifacts a JOIN tasks t ON t.id = a.task_id
     WHERE t.user_id = $1 AND a.kind = 'idea' AND t.archived_at IS NULL
       AND a.created_at > now() - make_interval(days => $2)
       AND ($3::text IS NULL OR t.platform = $3)
     ORDER BY a.created_at DESC, a.id DESC LIMIT $4`,
    [userId, options.days, options.platform ?? null, options.limit],
  );
  return rows;
}
