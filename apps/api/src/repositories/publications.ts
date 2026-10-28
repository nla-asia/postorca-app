import { transaction, type Database, type Queryable } from "../db.js";
import { HttpError } from "../handlers/errors.js";
import { createRoutine } from "./routines.js";
import { savePublishedPost } from "./social-posts.js";

export type Publisher = "founder" | "agent";
export type PublicationRow = {
  id: string;
  artifact_id: string;
  task_id: string | null;
  platform: string | null;
  publisher: Publisher;
  text: string;
  post_at: string;
  status: "scheduled" | "due" | "posted" | "skipped";
  posted_url: string | null;
  posted_at: string | null;
  /** The content task the post was written in (its images and clips are there). */
  source_task_id: string;
};

const iso = (column: string) =>
  `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

const columns = `p.id, p.artifact_id, p.task_id, p.platform, p.publisher, p.text,
  ${iso("p.post_at")} AS post_at, p.status, p.posted_url, ${iso("p.posted_at")} AS posted_at,
  (SELECT a.task_id FROM artifacts a WHERE a.id = p.artifact_id) AS source_task_id`;

/** The instructions a publish task runs with: Orca's brief, or the founder's reminder. */
function publishInstructions(
  publisher: Publisher,
  platform: string,
  text: string,
) {
  return publisher === "agent"
    ? `Read the publish-post skill with read_skill, then follow it to post this on ${platform}.\n\nPost:\n${text}`
    : `Time to post this on ${platform}. Copy it, post it from your account, then mark it as posted with the post's link.\n\nPost:\n${text}`;
}

/**
 * Schedules a post from a document artifact the founder owns: a one-time publish
 * routine at post_at, and its publication record. One open schedule per post.
 */
export async function schedulePost(
  db: Database,
  userId: string,
  taskId: string,
  artifactId: string,
  data: {
    text: string;
    post_at: string;
    publisher: Publisher;
    platform?: string;
  },
) {
  if (new Date(data.post_at).getTime() < Date.now() - 60_000)
    throw new HttpError(400, "Choose a time in the future.");
  const {
    rows: [post],
  } = await db.query(
    `SELECT a.title, t.platform, coalesce(u.timezone, 'UTC') AS timezone
     FROM artifacts a JOIN tasks t ON t.id = a.task_id JOIN users u ON u.id = t.user_id
     WHERE a.id = $1 AND a.task_id = $2 AND t.user_id = $3 AND a.kind = 'document'`,
    [artifactId, taskId, userId],
  );
  if (!post) throw new HttpError(404, "Post not found.");
  // Where it goes: the founder's choice, or the task's own platform.
  post.platform = data.platform ?? post.platform;
  const alreadyScheduled = () =>
    new HttpError(409, "This post is already scheduled.");
  if (
    (
      await db.query(
        "SELECT 1 FROM publications WHERE artifact_id = $1 AND status IN ('scheduled', 'due')",
        [artifactId],
      )
    ).rowCount
  )
    throw alreadyScheduled();
  const routineId = await createRoutine(db, userId, {
    title: `Post: ${post.title}`,
    platform: post.platform,
    instructions: publishInstructions(
      data.publisher,
      post.platform ?? "your account",
      data.text,
    ),
    run_at: data.post_at,
    timezone: post.timezone,
    work_type: "publish",
  });
  try {
    const {
      rows: [publication],
    } = await db.query(
      `INSERT INTO publications(user_id, artifact_id, routine_id, platform, publisher, text, post_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [
        userId,
        artifactId,
        routineId,
        post.platform,
        data.publisher,
        data.text,
        data.post_at,
      ],
    );
    return getPublication(db, userId, publication.id);
  } catch (error) {
    // Scheduled at the same moment by another request: keep only that one.
    await db.query("DELETE FROM routines WHERE id = $1", [routineId]);
    if ((error as { code?: string }).code === "23505") throw alreadyScheduled();
    throw error;
  }
}

export async function getPublication(
  db: Queryable,
  userId: string,
  id: string,
) {
  const {
    rows: [publication],
  } = await db.query<PublicationRow>(
    `SELECT ${columns} FROM publications p WHERE p.id = $1 AND p.user_id = $2`,
    [id, userId],
  );
  if (!publication) throw new HttpError(404, "Scheduled post not found.");
  return publication;
}

/** Cancels a post that hasn't come due yet: its schedule and record go. */
export async function cancelPost(db: Database, userId: string, id: string) {
  await transaction(db, async (client) => {
    const {
      rows: [publication],
    } = await client.query(
      "SELECT status, routine_id FROM publications WHERE id = $1 AND user_id = $2 FOR UPDATE",
      [id, userId],
    );
    if (!publication) throw new HttpError(404, "Scheduled post not found.");
    if (publication.status !== "scheduled")
      throw new HttpError(
        409,
        "This post is already due; mark it as posted or skipped instead.",
      );
    await client.query("DELETE FROM publications WHERE id = $1", [id]);
    if (publication.routine_id)
      await client.query("DELETE FROM routines WHERE id = $1", [
        publication.routine_id,
      ]);
  });
}

/**
 * Records how a due post ended: posted (with its link) or skipped. A posted one is
 * also saved among the founder's posts (social_posts).
 */
export async function recordPostResult(
  db: Database,
  userId: string,
  id: string,
  result: { status: "posted"; url: string } | { status: "skipped" },
) {
  return transaction(db, async (client) => {
    const {
      rows: [publication],
    } = await client.query(
      `UPDATE publications SET status = $3,
         posted_url = $4, posted_at = CASE WHEN $3 = 'posted' THEN now() END
       WHERE id = $1 AND user_id = $2 AND status IN ('scheduled', 'due') RETURNING id`,
      [id, userId, result.status, result.status === "posted" ? result.url : null],
    );
    if (!publication)
      throw new HttpError(404, "No open scheduled post with this id.");
    const recorded = await getPublication(client, userId, id);
    if (recorded.posted_url)
      await savePublishedPost(client, userId, {
        ...recorded,
        posted_url: recorded.posted_url,
      });
    return recorded;
  });
}

/** The publication a publish task is for, if any. */
export async function taskPublication(db: Queryable, taskId: string) {
  const {
    rows: [publication],
  } = await db.query<PublicationRow>(
    `SELECT ${columns} FROM publications p WHERE p.task_id = $1`,
    [taskId],
  );
  return publication ?? null;
}

/**
 * When a publish routine runs (inside startRoutineRun's transaction): links its task
 * and marks the post due. Returns who posts it, or null for other routines.
 */
export async function startPublication(
  client: Queryable,
  routineId: string,
  taskId: string,
): Promise<Publisher | null> {
  const {
    rows: [publication],
  } = await client.query(
    "UPDATE publications SET task_id = $2, status = 'due' WHERE routine_id = $1 AND status = 'scheduled' RETURNING publisher",
    [routineId, taskId],
  );
  return publication?.publisher ?? null;
}
