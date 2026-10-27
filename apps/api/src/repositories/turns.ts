import type { Queryable } from "../db.js";

/** Atomically moves a queued turn to running. False when another worker claimed it. */
export async function claimQueuedTurn(
  db: Queryable,
  taskId: string,
  turnId: string,
) {
  return !!(
    await db.query(
      "UPDATE turns SET status='running' WHERE id=$1 AND task_id=$2 AND status='queued' RETURNING id",
      [turnId, taskId],
    )
  ).rowCount;
}

export async function completeTurn(db: Queryable, turnId: string) {
  await db.query(
    "UPDATE turns SET status='completed',finished_at=now() WHERE id=$1",
    [turnId],
  );
}

export async function failTurn(db: Queryable, turnId: string, error: string) {
  await db.query(
    "UPDATE turns SET status='failed',finished_at=now(),error=$2 WHERE id=$1",
    [turnId, error],
  );
}

/** Interrupted work is visible as failed, never silently replayed after a restart. */
export async function failInterruptedTurns(db: Queryable) {
  await db.query(
    "UPDATE turns SET status='failed',finished_at=now(),error='The server restarted. Please send a follow-up to continue.' WHERE status IN ('queued','running')",
  );
}

/** Turns left queued (e.g. a crash between commit and dispatch) for over a minute. */
export async function staleQueuedTurns(
  db: Queryable,
): Promise<{ turn_id: string; task_id: string; user_id: string }[]> {
  return (
    await db.query(
      `SELECT r.id AS turn_id, r.task_id, t.user_id FROM turns r JOIN tasks t ON t.id = r.task_id
       WHERE r.status = 'queued' AND r.started_at < now() - interval '1 minute' LIMIT 20`,
    )
  ).rows;
}
