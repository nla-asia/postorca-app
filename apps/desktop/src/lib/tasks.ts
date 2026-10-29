import type { WorkTask, TurnStatus, PlatformName } from "./schedules";

/** A multiple-choice question Orca asked with request_user_input. */
export type ChatQuestion = {
  question: string;
  /** A plain answer, or a style name with the full sample post it stands for. */
  options: (string | { label: string; preview: string })[];
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

/** A post scheduled for publishing, by the founder or by Orca. */
export type Publication = {
  id: string;
  artifact_id: string;
  task_id: string | null;
  platform: PlatformName | null;
  publisher: "founder" | "agent";
  text: string;
  post_at: string;
  status: "scheduled" | "due" | "posted" | "skipped";
  posted_url: string | null;
  posted_at: string | null;
  /** The content task the post was written in. */
  source_task_id: string;
};

export type TaskArtifact = {
  id: string;
  turn_id: string;
  kind:
    | "document"
    | "idea"
    | "url"
    | "screenshot"
    | "image"
    | "audio"
    | "video"
    | "reply"
    | "post";
  title: string;
  content: string;
  /** Replies: what the founder did with it. */
  state: "done" | "skipped" | null;
  /** Ideas only: content work queued from this idea. */
  content_work: {
    routine_id: string;
    run_at: string;
    task_id: string | null;
    status: TurnStatus | null;
  } | null;
  /** Documents: the latest schedule to publish this post, if any. */
  publication: {
    id: string;
    status: Publication["status"];
    publisher: Publication["publisher"];
    post_at: string;
    task_id: string | null;
    posted_url: string | null;
    platform: PlatformName | null;
  } | null;
};

export type TaskDetail = Omit<WorkTask, "routine_title" | "summary"> & {
  current_turn_id: string | null;
  /** Publish tasks: the post to publish. */
  publication: Publication | null;
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
