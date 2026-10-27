export const PLATFORMS = [
  "X",
  "Threads",
  "Instagram",
  "Facebook",
  "LinkedIn",
] as const;
export type PlatformName = (typeof PLATFORMS)[number];
export type TurnStatus = "queued" | "running" | "completed" | "failed";
export type WorkType =
  | "general"
  | "ideas"
  | "content"
  | "publish"
  | "conversations"
  | "strategy";

export const WORK_TYPE_LABELS: Record<WorkType, string> = {
  general: "Work",
  ideas: "Content ideas",
  content: "Post draft",
  publish: "To publish",
  conversations: "Conversations",
  strategy: "Strategy",
};
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
export type WorkTask = {
  id: string;
  kind: "work";
  title: string;
  platform: PlatformName | null;
  work_type: WorkType;
  routine_title: string | null;
  summary: string | null;
  status: TurnStatus | null;
  approved_at: string | null;
  archived_at: string | null;
  created_at: string;
  finished_at: string | null;
};
