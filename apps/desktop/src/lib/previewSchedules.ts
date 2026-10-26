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

// Temporary session-only adapter. Replace with the authenticated schedule API.
const routines = new Map<string, Routine>();
export async function previewScheduleRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const method = options.method ?? "GET";
  if (path === "/routines" && method === "GET")
    return structuredClone([...routines.values()]) as T;
  const match = /^\/routines\/([^/]+)$/.exec(path);
  if (path === "/routines" && method === "POST") {
    const input = JSON.parse(String(options.body)) as RoutineInput;
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
    const current = routines.get(match[1]);
    if (!current) throw new Error("Preview routine not found.");
    if (method === "DELETE") {
      routines.delete(current.id);
      return undefined as T;
    }
    if (method === "PATCH") {
      const updated = {
        ...current,
        ...JSON.parse(String(options.body)),
        id: current.id,
      };
      routines.set(current.id, updated);
      return structuredClone(updated) as T;
    }
  }
  throw new Error("This action is not connected yet.");
}
