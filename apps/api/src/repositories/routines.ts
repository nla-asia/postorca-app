import { transaction, type Database, type Queryable } from "../db.js";
import { HttpError } from "../handlers/errors.js";
import {
  DEFAULT_ROUTINES,
  PLATFORM_BY_KIND,
  type LinkKind,
} from "../seeds/default-routines.js";

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
 * Creates the default routines (seeds/default-routines.ts) for each social link not
 * seeded yet, once onboarding is completed and the founder's time zone is known.
 * Runs inside the caller's transaction after profile, link, or time zone writes.
 * A link is seeded whole or not at all, so the per-user cap can leave it for later.
 */
export async function seedDefaultRoutines(db: Queryable, userId: string) {
  const {
    rows: [user],
  } = await db.query(
    `SELECT u.timezone FROM users u JOIN brand_profiles p ON p.user_id = u.id
     WHERE u.id = $1 AND p.onboarding_status = 'completed' AND u.timezone IS NOT NULL
     FOR UPDATE OF u`,
    [userId],
  );
  if (!user) return [];
  const { rows: links } = await db.query(
    `SELECT id, name, url, kind FROM brand_profile_links
     WHERE user_id = $1 AND routines_seeded_at IS NULL AND kind = ANY($2)
     ORDER BY name, id FOR UPDATE`,
    [userId, Object.keys(PLATFORM_BY_KIND)],
  );
  if (!links.length) return [];
  const {
    rows: [{ count }],
  } = await db.query(
    "SELECT count(*)::int AS count FROM routines WHERE user_id = $1 AND (run_at IS NULL OR active)",
    [userId],
  );
  let room = MAX_ROUTINES - count;
  const created: { title: string; platform: string; account: string }[] = [];
  for (const link of links) {
    const kind = link.kind as LinkKind;
    const defaults = DEFAULT_ROUTINES.filter((d) => d.kinds.includes(kind));
    if (defaults.length > room) break;
    for (const routine of defaults) {
      const values: Record<string, string> = {
        account: link.name,
        url: link.url,
      };
      await db.query(
        `INSERT INTO routines(user_id, platform, title, instructions, time_of_day, days, timezone, active, next_run_at, link_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, true,
           routine_next_run($5::time, $6::smallint[], $7, now()), $8)`,
        [
          userId,
          PLATFORM_BY_KIND[kind],
          routine.title,
          routine.instructions.replace(/{{(\w+)}}/g, (_, key) => values[key]),
          routine.time,
          routine.days,
          user.timezone,
          link.id,
        ],
      );
      created.push({
        title: routine.title,
        platform: PLATFORM_BY_KIND[kind],
        account: link.name,
      });
    }
    room -= defaults.length;
    await db.query(
      "UPDATE brand_profile_links SET routines_seeded_at = now() WHERE id = $1",
      [link.id],
    );
  }
  return created;
}

/**
 * Pauses the routines working on links that are about to be deleted. Call before
 * the delete; the foreign key then clears link_id. Returns how many were paused.
 */
export async function pauseLinkRoutines(
  db: Queryable,
  userId: string,
  linkIds: string[],
) {
  if (!linkIds.length) return 0;
  const paused = await db.query(
    `UPDATE routines SET active = false, next_run_at = NULL
     WHERE user_id = $1 AND link_id = ANY($2::uuid[]) AND active`,
    [userId, linkIds],
  );
  return paused.rowCount ?? 0;
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
