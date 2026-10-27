import type { Queryable } from "../db.js";

export async function createArtifact(
  db: Queryable,
  taskId: string,
  turnId: string,
  artifact: {
    kind: "document" | "idea" | "url" | "image" | "audio" | "video";
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
