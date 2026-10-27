import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import type { ChatQuestion, TaskArtifact, TaskDetail, TaskMessage } from "./tasks";
import { artifactMedia, messageMedia, type MediaAttachment } from "./media";
import { turnActions, type WorkAction } from "./toolActions";

type ChatItem =
  | { id: string; role: "user" | "agent"; text: string }
  | { id: string; role: "media"; attachments: MediaAttachment[] }
  | { id: string; role: "artifacts"; artifacts: TaskArtifact[] }
  | {
      id: string;
      role: "actions";
      actions: WorkAction[];
      working: boolean;
      seconds: number | null;
    }
  | {
      id: string;
      role: "question";
      questions: ChatQuestion[];
      active: boolean;
    };
type ChatTask = Pick<TaskDetail, "id" | "turns">;

const isActive = (status: string) => ["queued", "running"].includes(status);
const isQuestion = (message: TaskMessage) =>
  message.kind === "tool_result" &&
  (message.content.result as { status?: string } | undefined)?.status ===
    "awaiting_user_input";

/** Agent chat, or the separate onboarding conversation that sets up the brand. */
export function useAgentChat(
  userId: string | undefined,
  kind: "chat" | "onboarding",
) {
  const [task, setTask] = useState<ChatTask | null>(null);
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    setTask(null);
    setError("");
    if (!userId) return;
    setLoading(true);
    // One conversation of each kind per founder: this opens or reuses it.
    void api<{ id: string }>("/tasks", {
      method: "POST",
      body: JSON.stringify({ kind, title: "Orca" }),
    })
      .then((chat) => api<ChatTask>(`/tasks/${chat.id}`))
      .then((detail) => {
        if (!cancelled) setTask(detail);
      })
      .catch((error) => {
        if (!cancelled) setError(error.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId, kind]);
  const running = !!task?.turns.some((turn) => isActive(turn.status));
  // Poll while Orca works, so its steps appear as they happen.
  useEffect(() => {
    if (!task || !running || !userId) return;
    let cancelled = false;
    const timer = setInterval(() => {
      void api<ChatTask>(`/tasks/${task.id}`)
        .then((detail) => {
          if (!cancelled) {
            setTask(detail);
            setError("");
          }
        })
        .catch((error) => {
          if (!cancelled) setError(error.message);
        });
    }, 1000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [task?.id, running, userId]); // eslint-disable-line react-hooks/exhaustive-deps
  const reload = useCallback(async () => {
    if (task) setTask(await api<ChatTask>(`/tasks/${task.id}`));
  }, [task?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const send = useCallback(
    async (text: string) => {
      if (!task || sending || running || !text.trim()) return false;
      setSending(true);
      setError("");
      try {
        await api(`/tasks/${task.id}/turns`, {
          method: "POST",
          body: JSON.stringify({ message: text.trim() }),
        });
        setTask(await api<ChatTask>(`/tasks/${task.id}`));
        return true;
      } catch (error) {
        setError(
          error instanceof Error ? error.message : "Unable to send message.",
        );
        return false;
      } finally {
        setSending(false);
      }
    },
    [task?.id, sending, running], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const stored = task?.turns.flatMap((turn) => turn.messages) ?? [];
  const lastUser = stored.reduce(
    (last, message, index) => (message.kind === "user" ? index : last),
    -1,
  );
  // Only the latest unanswered question can still be answered from its card.
  const lastQuestion = stored.reduce(
    (last, message, index) => (isQuestion(message) ? index : last),
    -1,
  );
  const artifacts = task?.turns.flatMap((turn) => turn.artifacts) ?? [];
  // Files already delivered as artifacts are shown once, as artifacts.
  const delivered = new Set(
    artifacts.flatMap((item) => artifactMedia(item)?.file ?? []),
  );
  // Each turn: the founder's message, then Orca's tool steps (live while it works),
  // then its replies, question cards and artifacts.
  const messages: ChatItem[] = [];
  let index = 0;
  for (const turn of task?.turns ?? []) {
    const working = isActive(turn.status);
    const actions = turnActions(turn.messages);
    let actionsShown = false;
    const showActions = () => {
      if (actionsShown || (!actions.length && !working)) return;
      actionsShown = true;
      messages.push({
        id: `${turn.id}-actions`,
        role: "actions",
        actions,
        working,
        seconds: turn.finished_at
          ? Math.max(
              1,
              Math.round(
                (new Date(turn.finished_at).getTime() -
                  new Date(turn.started_at).getTime()) /
                  1000,
              ),
            )
          : null,
      });
    };
    for (const message of turn.messages) {
      const position = index++;
      const attachments = messageMedia(message).filter(
        (attachment) => !delivered.has(attachment.file),
      );
      if (attachments.length) {
        showActions();
        messages.push({ id: message.id, role: "media", attachments });
      }
      if (message.kind === "user") {
        if (message.content.text)
          messages.push({
            id: message.id,
            role: "user",
            text: message.content.text,
          });
        continue;
      }
      if (isQuestion(message)) {
        showActions();
        messages.push({
          id: message.id,
          role: "question",
          questions: (message.content.result as { questions: ChatQuestion[] })
            .questions,
          active:
            position === lastQuestion &&
            position > lastUser &&
            !running &&
            !sending,
        });
      } else if (message.kind === "assistant" && message.content.text) {
        showActions();
        messages.push({
          id: message.id,
          role: "agent",
          text: message.content.text,
        });
      }
    }
    showActions();
    // Ideas belong to Inbox work, where they can become content.
    const shown = turn.artifacts.filter((item) => item.kind !== "idea");
    if (shown.length)
      messages.push({
        id: `${turn.id}-artifacts`,
        role: "artifacts",
        artifacts: shown,
      });
  }
  const latest = task?.turns.at(-1);
  return {
    taskId: task?.id,
    artifacts,
    reload,
    messages,
    working: sending || running,
    loading,
    ready: !!task,
    error,
    /** Why the latest turn failed, shown where the conversation ended. */
    failure:
      latest?.status === "failed"
        ? (latest.error ?? "Orca could not complete this turn.")
        : "",
    send,
  };
}
