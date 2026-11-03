import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { WorkTask } from "./schedules";

export type WorkState =
  "working" | "failed" | "review" | "approved" | "archived";
export function workState(task: WorkTask): WorkState {
  if (task.archived_at) return "archived";
  if (task.status === "queued" || task.status === "running") return "working";
  if (task.status === "failed") return "failed";
  if (task.approved_at) return "approved";
  return "review";
}

/** Inbox work items. Polls so routine runs started by the server appear on their own. */
export function useWorkTasks(userId: string | undefined) {
  const [tasks, setTasks] = useState<WorkTask[] | null>(null);
  const [error, setError] = useState("");
  const requestController = useRef<AbortController | null>(null);
  const reload = useCallback(async () => {
    if (!userId) return;
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    try {
      const saved = await api<WorkTask[]>("/tasks?kind=work", {
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(15000),
        ]),
      });
      if (controller.signal.aborted) return;
      setTasks(saved);
      setError("");
    } catch (failure) {
      if (controller.signal.aborted) return;
      setError(
        failure instanceof Error
          ? failure.message
          : "Unable to load your Inbox.",
      );
    } finally {
      if (requestController.current === controller)
        requestController.current = null;
    }
  }, [userId]);
  useEffect(() => {
    setTasks(null);
    void reload();
    return () => requestController.current?.abort();
  }, [reload]);
  const working = !!tasks?.some((task) => workState(task) === "working");
  useEffect(() => {
    if (!userId) return;
    const timer = setInterval(
      () => {
        if (!requestController.current) void reload();
      },
      working ? 3000 : 20000,
    );
    return () => clearInterval(timer);
  }, [userId, working, reload]);
  const attention =
    tasks?.filter((task) => ["review", "failed"].includes(workState(task)))
      .length ?? 0;
  return { tasks, error, reload, attention };
}
