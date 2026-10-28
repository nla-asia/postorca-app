import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  Check,
  ChevronRight,
  Clock3,
  Layers,
  LoaderCircle,
  Play,
  Plus,
  Trash2,
} from "lucide-react";
import { Button, Modal, Pill, Platform } from "../components/ui";
import { api } from "../lib/api";
import {
  PLATFORMS,
  type PlatformName,
  type Routine,
  type RoutineInput,
} from "../lib/schedules";

import "./Routines.css";
import "../components/forms.css";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const zones: string[] = (() => {
  try {
    const all = (
      Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
    ).supportedValuesOf?.("timeZone");
    if (all?.length) return all.includes(localZone) ? all : [localZone, ...all];
  } catch {
    // Older runtimes: fall back to the device zone only.
  }
  return [localZone];
})();
const blank = (): RoutineInput => ({
  platform: "Threads",
  title: "",
  instructions: "",
  time: "09:00",
  days: [1, 2, 3, 4, 5],
  timezone: localZone,
  active: true,
});
export function describeDays(days: number[]) {
  const key = [...days].sort().join(",");
  if (key === "1,2,3,4,5,6,7") return "Every day";
  if (key === "1,2,3,4,5") return "Every weekday";
  if (key === "6,7") return "Weekends";
  return days.map((day) => WEEKDAYS[day - 1]).join(", ");
}
function formatWhen(value: string, timeZone: string) {
  return new Date(value).toLocaleString(undefined, {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
function useRoutines() {
  const [routines, setRoutines] = useState<Routine[] | null>(null);
  const [error, setError] = useState("");
  const requestController = useRef<AbortController | null>(null);
  const reload = useCallback(async () => {
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    try {
      const saved = await api<Routine[]>("/routines", {
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(15000),
        ]),
      });
      if (controller.signal.aborted) return;
      setRoutines(saved);
      setError("");
    } catch (failure) {
      if (controller.signal.aborted) return;
      setError(
        failure instanceof Error ? failure.message : "Unable to load routines.",
      );
    } finally {
      if (requestController.current === controller)
        requestController.current = null;
    }
  }, []);
  useEffect(() => {
    void reload();
    return () => requestController.current?.abort();
  }, [reload]);
  const busy = !!routines?.some((routine) =>
    ["queued", "running"].includes(routine.last_run_status ?? ""),
  );
  useEffect(() => {
    const timer = setInterval(
      () => {
        if (!requestController.current) void reload();
      },
      busy ? 2000 : 30000,
    );
    return () => clearInterval(timer);
  }, [busy, reload]);
  const replace = (routine: Routine) => {
    requestController.current?.abort();
    setRoutines((items) =>
      items?.some((item) => item.id === routine.id)
        ? items.map((item) => (item.id === routine.id ? routine : item))
        : [...(items ?? []), routine],
    );
  };
  const remove = (id: string) => {
    requestController.current?.abort();
    setRoutines((items) => items?.filter((item) => item.id !== id) ?? null);
  };
  return { routines, error, reload, replace, remove };
}

export default function Routines({
  notify,
  onOpenWork,
}: {
  notify: (message: string) => void;
  onOpenWork: (taskId: string) => void;
}) {
  const { routines, error, reload, replace, remove } = useRoutines();
  const [editing, setEditing] = useState<Routine | "new" | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const act = async (id: string, work: () => Promise<void>) => {
    setPending(id);
    try {
      await work();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Something went wrong.");
    } finally {
      setPending(null);
    }
  };
  const toggle = (routine: Routine) =>
    act(routine.id, async () => {
      replace(
        await api<Routine>(`/routines/${routine.id}`, {
          method: "PATCH",
          body: JSON.stringify({ active: !routine.active }),
        }),
      );
    });
  const runNow = (routine: Routine) =>
    act(routine.id, async () => {
      const result = await api<{ taskId: string; routine: Routine }>(
        `/routines/${routine.id}/run`,
        { method: "POST", body: "{}" },
      );
      replace(result.routine);
      notify(
        "Orca started this routine. The result will appear in your Inbox.",
      );
    });
  return (
    <div className="page-content schedules-page">
      <div className="schedule-toolbar">
        <div>
          <strong>
            {(() => {
              const count = routines?.filter((s) => s.active).length;
              return count === undefined
                ? "Routines"
                : `${count} active ${count === 1 ? "routine" : "routines"}`;
            })()}
          </strong>
          <span>
            Orca runs these on the server, even when this app is closed.
          </span>
        </div>
        <Button variant="primary" onClick={() => setEditing("new")}>
          <Plus size={16} />
          New routine
        </Button>
      </div>
      {error && (
        <div className="routine-load-error">
          <p className="auth-error" role="alert">
            {error}
          </p>
          <Button onClick={() => void reload()}>Try again</Button>
        </div>
      )}
      {routines === null ? (
        !error && (
          <div className="chat-loading" role="status">
            Loading…
          </div>
        )
      ) : routines.length === 0 ? (
        <div className="empty-state">
          <Clock3 size={30} />
          <h3>No routines yet</h3>
          <p>
            Give Orca recurring work, like finding fresh ideas every weekday
            morning.
          </p>
          <Button variant="primary" onClick={() => setEditing("new")}>
            <Plus size={16} />
            Create a routine
          </Button>
        </div>
      ) : (
        <div className="schedule-list">
          {routines.map((routine) => {
            const status = routine.last_run_status;
            const running = status === "queued" || status === "running";
            return (
              <article className="schedule-card" key={routine.id}>
                <div className="schedule-card-top">
                  {routine.platform ? (
                    <Platform name={routine.platform} />
                  ) : (
                    <span className="platform" aria-hidden>
                      <Layers size={13} />
                    </span>
                  )}
                  <span>{routine.platform ?? "All accounts"}</span>
                  <button
                    className={`switch ${routine.active ? "on" : ""}`}
                    role="switch"
                    aria-checked={routine.active}
                    aria-label={`${routine.active ? "Pause" : "Activate"} ${routine.title}`}
                    disabled={pending === routine.id}
                    onClick={() => void toggle(routine)}
                  >
                    <span />
                  </button>
                </div>
                <h3>{routine.title}</h3>
                <p>{routine.instructions}</p>
                {routine.last_run_at && (
                  <div className="routine-last-run">
                    {running ? (
                      <Pill>
                        <LoaderCircle className="loading-icon" size={12} />
                        Orca is working
                      </Pill>
                    ) : status === "failed" ? (
                      <Pill tone="danger">
                        <AlertCircle size={12} />
                        Last run failed
                      </Pill>
                    ) : (
                      <Pill tone="green">
                        <Check size={12} />
                        Last run completed
                      </Pill>
                    )}
                    <span className="muted">
                      {routine.last_run_trigger === "manual"
                        ? "Ran manually"
                        : "Ran"}{" "}
                      {formatWhen(routine.last_run_at, routine.timezone)}
                    </span>
                    {routine.last_task_id && (
                      <button
                        className="routine-link"
                        onClick={() => onOpenWork(routine.last_task_id!)}
                      >
                        View in Inbox
                        <ArrowRight size={13} />
                      </button>
                    )}
                  </div>
                )}
                <div className="schedule-card-bottom">
                  <div>
                    <Clock3 size={14} />
                    <span>
                      {routine.time}{" "}
                      <span className="muted">
                        · {describeDays(routine.days)}
                        {routine.timezone !== localZone &&
                          ` · ${routine.timezone}`}
                      </span>
                    </span>
                    <span className="muted">
                      ·{" "}
                      {routine.active && routine.next_run_at
                        ? `Next ${formatWhen(routine.next_run_at, routine.timezone)}`
                        : "Paused"}
                    </span>
                  </div>
                  <div className="routine-actions">
                    <Button
                      variant="ghost"
                      disabled={pending === routine.id || running}
                      onClick={() => void runNow(routine)}
                    >
                      <Play size={13} />
                      Run now
                    </Button>
                    <Button variant="ghost" onClick={() => setEditing(routine)}>
                      Edit
                      <ChevronRight size={14} />
                    </Button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
      <Modal
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        title={editing === "new" ? "New routine" : "Edit routine"}
        description="Orca starts this work at the set time and puts the result in your Inbox."
      >
        {editing !== null && (
          <RoutineEditor
            routine={editing === "new" ? null : editing}
            onSaved={(routine) => {
              replace(routine);
              setEditing(null);
              notify("Routine saved.");
            }}
            onDeleted={(id) => {
              remove(id);
              setEditing(null);
              notify("Routine deleted.");
            }}
          />
        )}
      </Modal>
    </div>
  );
}

function RoutineEditor({
  routine,
  onSaved,
  onDeleted,
}: {
  routine: Routine | null;
  onSaved: (routine: Routine) => void;
  onDeleted: (id: string) => void;
}) {
  const [draft, setDraft] = useState<RoutineInput>(() =>
    routine
      ? {
          platform: routine.platform,
          title: routine.title,
          instructions: routine.instructions,
          time: routine.time,
          days: routine.days,
          timezone: routine.timezone,
          active: routine.active,
        }
      : blank(),
  );
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState("");
  const set = <K extends keyof RoutineInput>(key: K, value: RoutineInput[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const run = async (work: () => Promise<void>) => {
    setSaving(true);
    setError("");
    try {
      await work();
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Unable to save routine.",
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <form
      className="form-stack"
      onSubmit={(event) => {
        event.preventDefault();
        if (!draft.days.length) {
          setError("Choose at least one day.");
          return;
        }
        void run(async () =>
          onSaved(
            await api<Routine>(
              routine ? `/routines/${routine.id}` : "/routines",
              {
                method: routine ? "PATCH" : "POST",
                body: JSON.stringify(draft),
              },
            ),
          ),
        );
      }}
    >
      <fieldset disabled={saving} className="form-stack">
        <label>
          Platform
          <select
            value={draft.platform ?? ""}
            onChange={(e) =>
              set("platform", (e.target.value || null) as PlatformName | null)
            }
          >
            <option value="">All accounts</option>
            {PLATFORMS.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
        <label>
          Name
          <input
            required
            maxLength={120}
            value={draft.title}
            placeholder="Find fresh ideas"
            onChange={(e) => set("title", e.target.value)}
          />
        </label>
        <label>
          What should Orca do?
          <textarea
            required
            rows={4}
            maxLength={4000}
            value={draft.instructions}
            placeholder="Propose three post ideas for this week based on my brand profile."
            onChange={(e) => set("instructions", e.target.value)}
          />
        </label>
        <div className="routine-time-row">
          <label>
            Time
            <input
              required
              type="time"
              value={draft.time}
              onChange={(e) => set("time", e.target.value)}
            />
          </label>
          <label>
            Time zone
            <select
              value={draft.timezone}
              onChange={(e) => set("timezone", e.target.value)}
            >
              {zones.map((zone) => (
                <option key={zone}>{zone}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="routine-days" role="group" aria-label="Repeat on">
          <span>Repeat on</span>
          <div>
            {WEEKDAYS.map((label, index) => {
              const day = index + 1;
              const chosen = draft.days.includes(day);
              return (
                <button
                  type="button"
                  key={label}
                  aria-pressed={chosen}
                  className={chosen ? "chosen" : ""}
                  onClick={() =>
                    set(
                      "days",
                      chosen
                        ? draft.days.filter((d) => d !== day)
                        : [...draft.days, day].sort(),
                    )
                  }
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
        {error && (
          <p className="auth-error" role="alert">
            {error}
          </p>
        )}
      </fieldset>
      <div className="form-footer">
        {routine ? (
          confirmDelete ? (
            <span className="routine-confirm">
              Delete this routine?
              <Button
                type="button"
                disabled={saving}
                onClick={() =>
                  void run(async () => {
                    await api(`/routines/${routine.id}`, { method: "DELETE" });
                    onDeleted(routine.id);
                  })
                }
              >
                Delete
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setConfirmDelete(false)}
              >
                Keep
              </Button>
            </span>
          ) : (
            <Button
              type="button"
              variant="ghost"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 size={14} />
              Delete
            </Button>
          )
        ) : (
          <span className="muted">
            {describeDays(draft.days) || "No days chosen"}
          </span>
        )}
        <Button variant="primary" type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save routine"}
          <Check size={15} />
        </Button>
      </div>
    </form>
  );
}
