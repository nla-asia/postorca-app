import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  Check,
  ChevronRight,
  Clock3,
  LoaderCircle,
  Play,
  Plus,
  Trash2,
} from "lucide-react";
import { Button, Modal, Pill, Platform } from "../components/ui";
import {
  previewScheduleRequest as api,
  PLATFORMS,
  type PlatformName,
  type Routine,
  type RoutineInput,
} from "../lib/previewSchedules";

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
function useRoutines(onError: (message: string) => void) {
  const [routines, setRoutines] = useState<Routine[] | null>(null);
  const reload = useCallback(async () => {
    try {
      setRoutines(await api<Routine[]>("/routines"));
    } catch (error) {
      onError(
        error instanceof Error ? error.message : "Unable to load routines.",
      );
    }
  }, [onError]);
  useEffect(() => {
    void reload();
  }, [reload]);
  const replace = (routine: Routine) =>
    setRoutines((items) =>
      items?.some((item) => item.id === routine.id)
        ? items.map((item) => (item.id === routine.id ? routine : item))
        : [...(items ?? []), routine],
    );
  return { routines, reload, replace, setRoutines };
}

export default function Routines({
  notify,
  onOpenWork,
}: {
  notify: (message: string) => void;
  onOpenWork: (taskId: string) => void;
}) {
  const { routines, replace, setRoutines } = useRoutines(notify);
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
            Preview · Changes last until the app restarts. Routines do not run
            yet.
          </span>
        </div>
        <Button variant="primary" onClick={() => setEditing("new")}>
          <Plus size={16} />
          New routine
        </Button>
      </div>
      {routines === null ? (
        <div className="chat-loading" role="status">
          Loading…
        </div>
      ) : routines.length === 0 ? (
        <div className="empty-state">
          <Clock3 size={30} />
          <h3>No routines yet</h3>
          <p>
            Give Asia recurring work, like finding fresh ideas every weekday
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
                  <Platform name={routine.platform} />
                  <span>{routine.platform}</span>
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
                        Asia is working
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
                      · {routine.active ? "Not scheduled in preview" : "Paused"}
                    </span>
                  </div>
                  <div className="routine-actions">
                    <Button
                      variant="ghost"
                      disabled
                      title="Running routines is coming soon"
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
        description="Preview this routine’s settings. Nothing will run until scheduling is connected."
      >
        {editing !== null && (
          <RoutineEditor
            routine={editing === "new" ? null : editing}
            onSaved={(routine) => {
              replace(routine);
              setEditing(null);
              notify("Preview routine saved for this session.");
            }}
            onDeleted={(id) => {
              setRoutines(
                (items) => items?.filter((item) => item.id !== id) ?? null,
              );
              setEditing(null);
              notify("Preview routine deleted.");
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
            value={draft.platform}
            onChange={(e) => set("platform", e.target.value as PlatformName)}
          >
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
          What should Asia do?
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
