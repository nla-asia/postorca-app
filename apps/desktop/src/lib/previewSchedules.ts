export const PLATFORMS = [
  "X",
  "Threads",
  "Instagram",
  "Facebook",
  "LinkedIn",
] as const;
export type PlatformName = (typeof PLATFORMS)[number];
export type TurnStatus = "queued" | "running" | "completed" | "failed";
export type Routine = {
  id: string;
  platform: PlatformName;
  title: string;
  instructions: string;
  time: string;
  /** ISO weekdays, 1 = Monday … 7 = Sunday. */
  days: number[];
  timezone: string;
  active: boolean;
  next_run_at: string | null;
  last_run_at: string | null;
  last_run_trigger: "schedule" | "manual" | null;
  last_task_id: string | null;
  last_run_status: TurnStatus | null;
};
export type RoutineInput = Omit<
  Routine,
  | "id"
  | "next_run_at"
  | "last_run_at"
  | "last_run_trigger"
  | "last_task_id"
  | "last_run_status"
>;

export type ScheduledTask = Omit<Routine, "platform" | "time" | "days"> & {
  platform: PlatformName | null;
  run_at: string;
};
type ScheduledTaskInput = Pick<
  ScheduledTask,
  "title" | "instructions" | "run_at" | "timezone"
> & { platform?: PlatformName | null };
export type WorkTask = {
  id: string;
  kind: "work";
  title: string;
  platform: PlatformName | null;
  routine_title: string | null;
  summary: string | null;
  status: TurnStatus | null;
  approved_at: string | null;
  archived_at: string | null;
  created_at: string;
  finished_at: string | null;
};

// Temporary session-only adapter. Replace with the authenticated schedule API.
const routines = new Map<string, Routine>();
const scheduled = new Map<string, ScheduledTask>();
export async function previewScheduleRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const method = options.method ?? "GET";
  if (path === "/routines?once=true" && method === "GET")
    return structuredClone([...scheduled.values()]) as T;
  if (path === "/routines" && method === "GET")
    return structuredClone([...routines.values()]) as T;
  const match = /^\/routines\/([^/]+)$/.exec(path);
  if (path === "/routines" && method === "POST") {
    const input = JSON.parse(String(options.body)) as
      RoutineInput | ScheduledTaskInput;
    if ("run_at" in input) {
      const task: ScheduledTask = {
        ...input,
        id: crypto.randomUUID(),
        platform: input.platform ?? null,
        active: true,
        next_run_at: input.run_at,
        last_run_at: null,
        last_run_trigger: null,
        last_task_id: null,
        last_run_status: null,
      };
      scheduled.set(task.id, task);
      return structuredClone(task) as T;
    }
    const routine: Routine = {
      ...input,
      id: crypto.randomUUID(),
      next_run_at: null,
      last_run_at: null,
      last_run_trigger: null,
      last_task_id: null,
      last_run_status: null,
    };
    routines.set(routine.id, routine);
    return structuredClone(routine) as T;
  }
  if (match) {
    const current = routines.get(match[1]) ?? scheduled.get(match[1]);
    if (!current) throw new Error("Preview routine not found.");
    if (method === "DELETE") {
      routines.delete(current.id);
      scheduled.delete(current.id);
      return undefined as T;
    }
    if (method === "PATCH") {
      const updated = {
        ...current,
        ...JSON.parse(String(options.body)),
        id: current.id,
      };
      if (scheduled.has(current.id)) scheduled.set(current.id, updated);
      else routines.set(current.id, updated);
      return structuredClone(updated) as T;
    }
  }
  throw new Error("This action is not connected yet.");
}
