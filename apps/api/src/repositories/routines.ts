import { transaction, type Database, type Queryable } from "../db.js";
import { HttpError } from "../handlers/errors.js";

export type RoutineFields = {
  platform: string;
  title: string;
  instructions: string;
  time: string;
  days: number[];
  timezone: string;
  active: boolean;
};
export type OnceFields = {
  title: string;
  instructions: string;
  platform?: string | null;
  run_at: string;
  timezone: string;
};

// Client-facing routine shape, including the most recent run and its live status.
const routineSelect = `
  SELECT r.id, r.platform, r.title, r.instructions,
    to_char(r.time_of_day, 'HH24:MI') AS time, r.days, r.timezone, r.active,
    r.next_run_at, r.run_at, r.created_at,
    lr.created_at AS last_run_at, lr.trigger AS last_run_trigger,
    lr.task_id AS last_task_id, lt.status AS last_run_status
  FROM routines r
  LEFT JOIN LATERAL (
    SELECT * FROM routine_runs WHERE routine_id = r.id ORDER BY created_at DESC, id LIMIT 1
  ) lr ON true
  LEFT JOIN tasks t ON t.id = lr.task_id
  LEFT JOIN turns lt ON lt.id = t.current_turn_id`;

const MAX_ROUTINES = 50;
// SQL for next_run_at given the parameter positions of active/time/days/timezone.
const NEXT_RUN =
  "CASE WHEN $8 THEN routine_next_run($5::time, $6::smallint[], $7, now()) END";

export async function assertValidTimezone(db: Queryable, timezone: string) {
  if (
    !(
      await db.query("SELECT 1 FROM pg_timezone_names WHERE name = $1", [
        timezone,
      ])
    ).rowCount
  )
    throw new HttpError(400, "Unknown time zone.");
}

export async function listRoutines(
  db: Queryable,
  userId: string,
  once = false,
) {
  return (
    await db.query(
      `${routineSelect} WHERE r.user_id = $1 AND r.run_at IS ${once ? "NOT NULL" : "NULL"} ORDER BY r.created_at, r.id`,
      [userId],
    )
  ).rows;
}

export async function getRoutine(
  db: Queryable,
  userId: string,
  routineId: string,
) {
  const {
    rows: [routine],
  } = await db.query(`${routineSelect} WHERE r.user_id = $1 AND r.id = $2`, [
    userId,
    routineId,
  ]);
  if (!routine) throw new HttpError(404, "Routine not found.");
  return routine;
}

/** Creates a routine, enforcing the per-user cap. Returns its id. */
export async function createRoutine(
  db: Database,
  userId: string,
  data: RoutineFields | OnceFields,
): Promise<string> {
  return transaction(db, async (client) => {
    // Serialize creation per user so the cap holds under concurrency.
    await client.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [
      userId,
    ]);
    const {
      rows: [{ count }],
    } = await client.query(
      "SELECT count(*)::int AS count FROM routines WHERE user_id = $1 AND (run_at IS NULL OR active)",
      [userId],
    );
    if (count >= MAX_ROUTINES)
      throw new HttpError(
        409,
        `You can have up to ${MAX_ROUTINES} pending schedules and routines.`,
      );
    if ("run_at" in data) {
      const {
        rows: [created],
      } = await client.query(
        `INSERT INTO routines(user_id, platform, title, instructions, timezone, run_at, next_run_at)
         VALUES ($1,$2,$3,$4,$5,$6,$6) RETURNING id`,
        [
          userId,
          data.platform ?? null,
          data.title,
          data.instructions,
          data.timezone,
          data.run_at,
        ],
      );
      return created.id;
    }
    const {
      rows: [created],
    } = await client.query(
      `INSERT INTO routines(user_id, platform, title, instructions, time_of_day, days, timezone, active, next_run_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
         ${NEXT_RUN})
       RETURNING id`,
      [
        userId,
        data.platform,
        data.title,
        data.instructions,
        data.time,
        data.days,
        data.timezone,
        data.active,
      ],
    );
    return created.id;
  });
}

/**
 * Any schedule change (including resuming) re-plans from now; a paused routine
 * never accumulates missed runs.
 */
export async function updateRoutine(
  db: Database,
  userId: string,
  routineId: string,
  changes: Partial<Omit<RoutineFields, "platform"> & OnceFields>,
) {
  await transaction(db, async (client) => {
    const {
      rows: [current],
    } = await client.query(
      `SELECT platform, title, instructions, to_char(time_of_day, 'HH24:MI') AS time, days, timezone, active, run_at
       FROM routines WHERE id = $1 AND user_id = $2 FOR UPDATE`,
      [routineId, userId],
    );
    if (!current) throw new HttpError(404, "Routine not found.");
    if (current.run_at) {
      if (!current.active)
        throw new HttpError(409, "This scheduled task has already started.");
      if (["time", "days", "active"].some((key) => key in changes))
        throw new HttpError(
          400,
          "One-time tasks do not repeat. Cancel them to remove the schedule.",
        );
      const next = { ...current, ...changes };
      await client.query(
        `UPDATE routines SET platform=$2,title=$3,instructions=$4,timezone=$5,run_at=$6,next_run_at=$6 WHERE id=$1`,
        [
          routineId,
          next.platform,
          next.title,
          next.instructions,
          next.timezone,
          next.run_at,
        ],
      );
      return;
    }
    if ("run_at" in changes)
      throw new HttpError(
        400,
        "Create a Calendar task for a one-time schedule.",
      );
    if (changes.platform === null)
      throw new HttpError(400, "Choose a platform for this routine.");
    const next = { ...current, ...changes };
    await client.query(
      `UPDATE routines SET platform = $2, title = $3, instructions = $4, time_of_day = $5,
         days = $6, timezone = $7, active = $8,
         next_run_at = ${NEXT_RUN}
       WHERE id = $1`,
      [
        routineId,
        next.platform,
        next.title,
        next.instructions,
        next.time,
        next.days,
        next.timezone,
        next.active,
      ],
    );
  });
}

export async function deleteRoutine(
  db: Database,
  userId: string,
  routineId: string,
) {
  await transaction(db, async (client) => {
    const {
      rows: [current],
    } = await client.query(
      "SELECT run_at,active FROM routines WHERE id=$1 AND user_id=$2 FOR UPDATE",
      [routineId, userId],
    );
    if (!current) throw new HttpError(404, "Routine not found.");
    if (current.run_at && !current.active)
      throw new HttpError(409, "This scheduled task has already started.");
    await client.query("DELETE FROM routines WHERE id=$1", [routineId]);
  });
}
