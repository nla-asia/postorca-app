import type { Routine, RoutineInput } from "./schedules";

// Temporary session-only routines. Calendar uses the authenticated schedule API.
const routines = new Map<string, Routine>();
export function clearSchedulePreview() {
  routines.clear();
}
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
