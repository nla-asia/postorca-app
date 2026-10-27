import type { WorkTask, TurnStatus } from "./schedules";

/** A multiple-choice question Orca asked with request_user_input. */
export type ChatQuestion = {
  question: string;
  options: string[];
  multiple?: boolean;
};

export type TaskMessage = {
  id: string;
  kind: "user" | "assistant" | "tool_call" | "tool_result";
  content: {
    text?: string;
    callId?: string;
    name?: string;
    arguments?: string;
    result?: unknown;
  };
  created_at: string;
};
export type TaskArtifact = {
  id: string;
  turn_id: string;
  kind:
    "document" | "idea" | "url" | "screenshot" | "image" | "audio" | "video";
  title: string;
  content: string;
  /** Ideas only: content work queued from this idea. */
  content_work: {
    routine_id: string;
    run_at: string;
    task_id: string | null;
    status: TurnStatus | null;
  } | null;
};
export type TaskDetail = Omit<WorkTask, "routine_title" | "summary"> & {
  current_turn_id: string | null;
  turns: {
    id: string;
    status: TurnStatus;
    started_at: string;
    finished_at: string | null;
    error: string | null;
    messages: TaskMessage[];
    artifacts: TaskArtifact[];
  }[];
};
