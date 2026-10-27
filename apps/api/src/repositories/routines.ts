import { transaction, type Database, type Queryable } from "../db.js";
import { HttpError } from "../handlers/errors.js";
import { appendMessage } from "./tasks.js";
import { startPublication } from "./publications.js";
import {
  DEFAULT_ROUTINES,
  PLATFORM_BY_KIND,
  WORK_IDEAS_ROUTINE,
  type LinkKind,
} from "../seeds/default-routines.js";

export type WorkType =
  | "general"
  | "ideas"
  | "content"
  | "publish"
  | "conversations"
  | "strategy";

export type RoutineRow = {
  id: string;
  user_id: string;
  platform: string | null;
  title: string;
  instructions: string;
  work_type?: WorkType;
  run_at?: Date | string | null;
};
export type RoutineFields = {
  platform: string;
  title: string;
  instructions: string;
  time: string;
  days: number[];
  timezone: string;
  active: boolean;
  work_type?: WorkType;
};
export type StartedRun = {
  runId: string;
  taskId: string;
  turnId: string;
  founderReminder?: { title: string; body: string };
  userId: string;
};
export type OnceFields = {
  title: string;
  instructions: string;
  platform?: string | null;
  run_at: string;
  timezone: string;
  /** The idea artifact this schedule turns into content. */
  source_artifact_id?: string;
  work_type?: WorkType;
};

// Client-facing routine shape, including the most recent run and its live status.
const routineSelect = `
  SELECT r.id, r.platform, r.title, r.instructions, r.work_type,
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

/** The work request Orca receives when a routine or Calendar task runs. */
export function routinePrompt(
  routine: Pick<RoutineRow, "platform" | "title" | "instructions" | "run_at">,
) {
  return `${routine.run_at ? "Scheduled task" : "Routine"}: ${routine.title}${routine.platform ? ` (${routine.platform})` : ""}\n\n${routine.instructions}`;
}

/**
 * Records a run and creates its Inbox work task with a queued first turn, inside
 * the caller's transaction. Returns null when this scheduled occurrence already
 * started, so duplicate ticks are harmless. The caller dispatches Orca only after
 * committing.
 */
export async function startRoutineRun(
  client: Queryable,
  routine: RoutineRow,
  trigger: "schedule" | "manual",
  scheduledFor: Date | string,
): Promise<StartedRun | null> {
  const {
    rows: [run],
  } = await client.query(
    `INSERT INTO routine_runs(routine_id, trigger, scheduled_for) VALUES ($1, $2, $3)
     ON CONFLICT (routine_id, scheduled_for) WHERE trigger = 'schedule' DO NOTHING
     RETURNING id`,
    [routine.id, trigger, scheduledFor],
  );
  if (!run) return null;
  const {
    rows: [task],
  } = await client.query(
    `INSERT INTO tasks(user_id, kind, title, platform, work_type)
     VALUES ($1, 'work', $2, $3, (SELECT work_type FROM routines WHERE id = $4)) RETURNING id`,
    [routine.user_id, routine.title, routine.platform, routine.id],
  );
  const {
    rows: [turn],
  } = await client.query(
    "INSERT INTO turns(task_id) VALUES ($1) RETURNING id",
    [task.id],
  );
  await appendMessage(client, turn.id, "user", {
    text: routinePrompt(routine),
  });
  await client.query("UPDATE tasks SET current_turn_id = $2 WHERE id = $1", [
    task.id,
    turn.id,
  ]);
  await client.query("UPDATE routine_runs SET task_id = $2 WHERE id = $1", [
    run.id,
    task.id,
  ]);
  const publisher = await startPublication(client, routine.id, task.id);
  if (publisher === "founder") {
    // Nothing for the agent to do: the task is the founder's reminder.
    await client.query(
      "UPDATE turns SET status = 'completed', finished_at = now() WHERE id = $1",
      [turn.id],
    );
    return {
      runId: run.id,
      taskId: task.id,
      turnId: turn.id,
      userId: routine.user_id,
      founderReminder: {
        title: `Time to post${routine.platform ? ` on ${routine.platform}` : ""}`,
        body: routine.title.replace(/^Post: /, ""),
      },
    };
  }
  return {
    runId: run.id,
    taskId: task.id,
    turnId: turn.id,
    userId: routine.user_id,
  };
}

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

/** How long a confirmed idea waits in the queue before the scheduler picks it up. */
export const IDEA_QUEUE_DELAY_MS = 5 * 60_000;

/**
 * Queues content work for an idea the founder chose: a one-time schedule a few
 * minutes out that runs the create-content skill on the idea. One per idea.
 */
export async function queueIdeaContent(
  db: Database,
  userId: string,
  taskId: string,
  artifactId: string,
  note?: string,
) {
  const {
    rows: [idea],
  } = await db.query(
    `SELECT a.id, a.title, a.content, t.platform, coalesce(u.timezone, 'UTC') AS timezone
     FROM artifacts a JOIN tasks t ON t.id = a.task_id JOIN users u ON u.id = t.user_id
     WHERE a.id = $1 AND a.task_id = $2 AND t.user_id = $3 AND a.kind = 'idea'`,
    [artifactId, taskId, userId],
  );
  if (!idea) throw new HttpError(404, "Idea not found.");
  const instructions = [
    "Read the create-content skill with read_skill, then follow it for this idea.",
    `Idea: ${idea.title}\n\n${idea.content}`,
    ...(note ? [`Founder's note: ${note}`] : []),
  ].join("\n\n");
  try {
    const routineId = await createRoutine(db, userId, {
      title: idea.title,
      platform: idea.platform,
      instructions,
      run_at: new Date(Date.now() + IDEA_QUEUE_DELAY_MS).toISOString(),
      timezone: idea.timezone,
      source_artifact_id: idea.id,
    });
    return getRoutine(db, userId, routineId);
  } catch (error) {
    // routines_source_artifact: content is already queued for this idea.
    if ((error as { code?: string }).code === "23505")
      throw new HttpError(409, "Content for this idea is already queued.");
    throw error;
  }
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
        `INSERT INTO routines(user_id, platform, title, instructions, timezone, run_at, next_run_at, source_artifact_id, work_type)
         VALUES ($1,$2,$3,$4,$5,$6,$6,$7,coalesce($8,'general')) RETURNING id`,
        [
          userId,
          data.platform ?? null,
          data.title,
          data.instructions,
          data.timezone,
          data.run_at,
          data.source_artifact_id ?? null,
          data.work_type ?? null,
        ],
      );
      return created.id;
    }
    const {
      rows: [created],
    } = await client.query(
      `INSERT INTO routines(user_id, platform, title, instructions, time_of_day, days, timezone, active, next_run_at, work_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
         ${NEXT_RUN}, coalesce($9, 'general'))
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
        data.work_type ?? null,
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
        `INSERT INTO routines(user_id, platform, title, instructions, time_of_day, days, timezone, active, next_run_at, link_id, work_type)
         VALUES ($1, $2, $3, $4, $5, $6, $7, true,
           routine_next_run($5::time, $6::smallint[], $7, now()), $8, $9)`,
        [
          userId,
          PLATFORM_BY_KIND[kind],
          routine.title,
          routine.instructions.replace(/{{(\w+)}}/g, (_, key) => values[key]),
          routine.time,
          routine.days,
          user.timezone,
          link.id,
          routine.workType,
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
 * Adds the "Ideas from my work" routine once, for the founder's first social account
 * of the preferred kinds, after onboarding and with a known timezone. Returns what
 * was added, or null when nothing was.
 */
export async function seedWorkIdeasRoutine(db: Queryable, userId: string) {
  const {
    rows: [user],
  } = await db.query(
    `SELECT u.timezone FROM users u JOIN brand_profiles p ON p.user_id = u.id
     WHERE u.id = $1 AND p.onboarding_status = 'completed' AND u.timezone IS NOT NULL
     FOR UPDATE OF u`,
    [userId],
  );
  if (!user) return null;
  const { rowCount: existing } = await db.query(
    "SELECT 1 FROM routines WHERE user_id = $1 AND instructions LIKE $2",
    [userId, `%${WORK_IDEAS_ROUTINE.skill}%`],
  );
  if (existing) return null;
  const { rows: links } = await db.query(
    "SELECT id, name, url, kind FROM brand_profile_links WHERE user_id = $1 AND kind = ANY($2) ORDER BY name, id",
    [userId, WORK_IDEAS_ROUTINE.kinds],
  );
  const link = WORK_IDEAS_ROUTINE.kinds
    .map((kind) => links.find((item) => item.kind === kind))
    .find(Boolean);
  if (!link) return null;
  const {
    rows: [{ count }],
  } = await db.query(
    "SELECT count(*)::int AS count FROM routines WHERE user_id = $1 AND (run_at IS NULL OR active)",
    [userId],
  );
  if (count >= MAX_ROUTINES) return null;
  const platform = PLATFORM_BY_KIND[link.kind as LinkKind];
  await db.query(
    `INSERT INTO routines(user_id, platform, title, instructions, time_of_day, days, timezone, active, next_run_at, link_id, work_type)
     VALUES ($1, $2, $3, $4, $5, $6, $7, true,
       routine_next_run($5::time, $6::smallint[], $7, now()), $8, $9)`,
    [
      userId,
      platform,
      WORK_IDEAS_ROUTINE.title,
      WORK_IDEAS_ROUTINE.instructions
        .replace("{{account}}", link.name)
        .replace("{{url}}", link.url),
      WORK_IDEAS_ROUTINE.time,
      WORK_IDEAS_ROUTINE.days,
      user.timezone,
      link.id,
      WORK_IDEAS_ROUTINE.workType,
    ],
  );
  return {
    title: WORK_IDEAS_ROUTINE.title,
    platform,
    account: link.name,
    time: WORK_IDEAS_ROUTINE.time,
  };
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

/** Run once now, outside the schedule. Does not change next_run_at. */
export async function startManualRun(
  db: Database,
  userId: string,
  routineId: string,
): Promise<StartedRun> {
  return transaction(db, async (client) => {
    const {
      rows: [routine],
    } = await client.query(
      "SELECT id, user_id, platform, title, instructions, run_at FROM routines WHERE id = $1 AND user_id = $2 FOR UPDATE",
      [routineId, userId],
    );
    if (!routine) throw new HttpError(404, "Routine not found.");
    if (routine.run_at)
      throw new HttpError(400, "Calendar tasks run once at their scheduled time.");
    const {
      rows: [busy],
    } = await client.query(
      `SELECT 1 FROM routine_runs rr JOIN tasks t ON t.id = rr.task_id JOIN turns r ON r.id = t.current_turn_id
       WHERE rr.routine_id = $1 AND r.status IN ('queued', 'running') LIMIT 1`,
      [routineId],
    );
    if (busy) throw new HttpError(409, "This routine is already running.");
    // Manual runs never conflict, so a run is always started.
    return (await startRoutineRun(client, routine, "manual", new Date()))!;
  });
}

/**
 * Claims up to `limit` due schedules (SKIP LOCKED), starts each occurrence, and
 * advances next_run_at, all in one transaction. A Calendar task finishes after its
 * one run. The caller dispatches after commit.
 */
export async function startDueRuns(db: Database, limit: number) {
  return transaction(db, async (client) => {
    const { rows: due } = await client.query(
      `SELECT id, user_id, platform, title, instructions, next_run_at, run_at FROM routines
       WHERE active AND next_run_at <= now()
       ORDER BY next_run_at FOR UPDATE SKIP LOCKED LIMIT $1`,
      [limit],
    );
    const runs: StartedRun[] = [];
    for (const routine of due) {
      const run = await startRoutineRun(
        client,
        routine,
        "schedule",
        routine.next_run_at,
      );
      if (run) runs.push(run);
      if (routine.run_at)
        await client.query(
          "UPDATE routines SET active=false,next_run_at=NULL WHERE id=$1",
          [routine.id],
        );
      else
        await client.query(
          "UPDATE routines SET next_run_at = routine_next_run(time_of_day, days, timezone, now()) WHERE id = $1",
          [routine.id],
        );
    }
    return { runs, claimed: due.length };
  });
}
