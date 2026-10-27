import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { Button, Modal, Platform } from "../components/ui";
import { api } from "../lib/api";
import type { ScheduledTask, WorkTask } from "../lib/schedules";
import "./Calendar.css";
import "../components/forms.css";

const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
function localDateTime(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
function initialTime(day?: Date) {
  const next = new Date(Date.now() + 5 * 60_000);
  if (day && day.toDateString() !== next.toDateString()) {
    const selectedDay = new Date(day);
    selectedDay.setHours(9, 0, 0, 0);
    return localDateTime(selectedDay);
  }
  return localDateTime(next);
}
const timeLabel = (value: string) =>
  new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
const status = (item: ScheduledTask) =>
  item.active
    ? "Scheduled"
    : item.last_run_status === "completed"
      ? "Completed"
      : item.last_run_status === "failed"
        ? "Failed"
        : "Working";

export default function Calendar({
  tasks,
  onOpenWork,
  onApprovedSelect,
}: {
  tasks: WorkTask[];
  onOpenWork: (id: string) => void;
  onApprovedSelect: (id: string) => void;
}) {
  const [offset, setOffset] = useState(0);
  const [items, setItems] = useState<ScheduledTask[] | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<ScheduledTask | "new" | null>(null);
  const [when, setWhen] = useState("");
  const [showPast, setShowPast] = useState(false);
  const requestController = useRef<AbortController | null>(null);
  const reload = useCallback(async () => {
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    try {
      const schedules = await api<ScheduledTask[]>("/routines?once=true", {
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(15000),
        ]),
      });
      if (controller.signal.aborted) return;
      setItems(schedules);
      setError("");
    } catch (failure) {
      if (controller.signal.aborted) return;
      setError(
        failure instanceof Error
          ? failure.message
          : "Unable to load schedules.",
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
  const busy = items?.some((item) =>
    ["queued", "running"].includes(item.last_run_status ?? ""),
  );
  useEffect(() => {
    const timer = setInterval(
      () => {
        if (!requestController.current) void reload();
      },
      busy ? 2000 : 10000,
    );
    return () => clearInterval(timer);
  }, [reload, busy]);
  const today = new Date();
  const month = new Date(today.getFullYear(), today.getMonth() + offset, 1);
  const firstDay = (month.getDay() + 6) % 7;
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const newTask = (day?: Date) => {
    setWhen(initialTime(day));
    setEditing("new");
  };
  // Once a scheduled task starts, show its schedule entry rather than duplicating
  // it as approved work. The calendar is for planning, so finished runs and
  // approved work only show on request.
  const approved = tasks.filter(
    (task) =>
      showPast &&
      task.approved_at &&
      !task.archived_at &&
      !items?.some((item) => item.last_task_id === task.id),
  );
  const selected =
    editing && editing !== "new"
      ? (items?.find((item) => item.id === editing.id) ?? editing)
      : null;
  return (
    <div className="page-content calendar-page">
      <div className="calendar-toolbar">
        <h2>
          {month.toLocaleDateString(undefined, {
            month: "long",
            year: "numeric",
          })}
        </h2>
        <div>
          <div className="calendar-filter">
            Show past
            <button
              className={`switch ${showPast ? "on" : ""}`}
              role="switch"
              aria-checked={showPast}
              aria-label="Show past tasks"
              onClick={() => setShowPast((value) => !value)}
            >
              <span />
            </button>
          </div>
          <Button variant="primary" onClick={() => newTask()}>
            <Plus size={16} />
            Schedule task
          </Button>
          <Button onClick={() => setOffset(0)}>Today</Button>
          <button
            className="icon-button"
            aria-label="Previous month"
            onClick={() => setOffset((value) => value - 1)}
          >
            <ChevronLeft size={18} />
          </button>
          <button
            className="icon-button"
            aria-label="Next month"
            onClick={() => setOffset((value) => value + 1)}
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>
      <p className="preview-note calendar-note">
        Schedules are saved to your account. Automatic execution is coming soon.
      </p>
      {error && (
        <div className="calendar-load-error">
          <p className="auth-error" role="alert">
            {error}
          </p>
          <Button onClick={() => void reload()}>Try again</Button>
        </div>
      )}
      {items === null && !error && <p role="status">Loading…</p>}
      <div className="calendar">
        <div className="calendar-weekdays">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
            <span key={day}>{day}</span>
          ))}
        </div>
        <div className="calendar-grid">
          {Array.from(
            { length: Math.ceil((firstDay + days) / 7) * 7 },
            (_, index) => {
              const day = index - firstDay + 1;
              const valid = day > 0 && day <= days;
              const date = new Date(month.getFullYear(), month.getMonth(), day);
              const sameDay = (value: string) =>
                new Date(value).toDateString() === date.toDateString();
              const entries = valid
                ? (items ?? [])
                    .filter(
                      (item) =>
                        sameDay(item.run_at) &&
                        (showPast ||
                          !["Completed", "Failed"].includes(status(item))),
                    )
                    .sort((a, b) => a.run_at.localeCompare(b.run_at))
                : [];
              return (
                <div
                  key={index}
                  className={`calendar-cell ${valid ? "" : "outside"} ${valid && date.toDateString() === today.toDateString() ? "today" : ""}`}
                >
                  {valid && (
                    <>
                      <button
                        className="day-number calendar-day"
                        aria-label={`Schedule task on ${date.toLocaleDateString()}`}
                        disabled={
                          new Date(
                            date.getFullYear(),
                            date.getMonth(),
                            date.getDate() + 1,
                          ).getTime() <= Date.now()
                        }
                        onClick={() => newTask(date)}
                      >
                        {day}
                      </button>
                      {entries.map((item) => (
                        <button
                          key={item.id}
                          className={`calendar-event ${status(item).toLowerCase()}`}
                          onClick={() => setEditing(item)}
                          title={`${status(item)} · ${timeLabel(item.run_at)}`}
                        >
                          {item.platform && <Platform name={item.platform} />}
                          <span>
                            <strong>{timeLabel(item.run_at)}</strong>{" "}
                            {item.title}
                            <small className="calendar-event-status">
                              {status(item)}
                            </small>
                          </span>
                        </button>
                      ))}
                      {approved
                        .filter((task) => sameDay(task.approved_at!))
                        .map((task) => (
                          <button
                            key={task.id}
                            className="calendar-event completed"
                            onClick={() => onApprovedSelect(task.id)}
                          >
                            {task.platform && <Platform name={task.platform} />}
                            <span>{task.title}</span>
                          </button>
                        ))}
                    </>
                  )}
                </div>
              );
            },
          )}
        </div>
      </div>
      <Modal
        description="Save a one-time task to your account. Automatic execution is coming soon."
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        title={
          editing === "new"
            ? "Schedule task"
            : selected?.active
              ? "Edit scheduled task"
              : (selected?.title ?? "Scheduled task")
        }
      >
        {editing !== null &&
          (selected && !selected.active ? (
            <div className="form-stack">
              <p>{selected.instructions}</p>
              <p className="muted">
                {new Date(selected.run_at).toLocaleString()} ·{" "}
                {status(selected)}
              </p>
              {selected.last_task_id && (
                <Button
                  variant="primary"
                  onClick={() => {
                    setEditing(null);
                    onOpenWork(selected.last_task_id!);
                  }}
                >
                  Open in Inbox
                </Button>
              )}
            </div>
          ) : (
            <ScheduleEditor
              key={selected?.id ?? "new"}
              item={selected}
              when={when}
              onSaved={() => {
                setEditing(null);
                void reload();
              }}
            />
          ))}
      </Modal>
    </div>
  );
}

function ScheduleEditor({
  item,
  when,
  onSaved,
}: {
  item: ScheduledTask | null;
  when: string;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(item?.title ?? "");
  const [instructions, setInstructions] = useState(item?.instructions ?? "");
  const [at, setAt] = useState(
    item ? localDateTime(new Date(item.run_at)) : when,
  );
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [cancel, setCancel] = useState(false);
  const perform = async (work: () => Promise<unknown>) => {
    setSaving(true);
    setError("");
    try {
      await work();
      onSaved();
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Unable to save schedule.",
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
        const date = new Date(at);
        if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now()) {
          setError("Choose a future date and time.");
          return;
        }
        if (localDateTime(date) !== at) {
          setError("That local time does not exist. Choose another time.");
          return;
        }
        void perform(() =>
          api(item ? `/routines/${item.id}` : "/routines", {
            method: item ? "PATCH" : "POST",
            body: JSON.stringify({
              title,
              instructions,
              run_at: date.toISOString(),
              timezone: localZone,
            }),
          }),
        );
      }}
    >
      <fieldset disabled={saving} className="form-stack">
        <label>
          Name
          <input
            required
            maxLength={120}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label>
          What should Orca do?
          <textarea
            required
            rows={4}
            maxLength={4000}
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
          />
        </label>
        <label>
          Date and time
          <input
            required
            type="datetime-local"
            value={at}
            onChange={(e) => setAt(e.target.value)}
          />
        </label>
        <span className="muted">{localZone}</span>
      </fieldset>
      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}
      <div className="form-footer">
        {item ? (
          <Button
            type="button"
            variant="ghost"
            disabled={saving}
            onClick={() =>
              cancel
                ? void perform(() =>
                    api(`/routines/${item.id}`, { method: "DELETE" }),
                  )
                : setCancel(true)
            }
          >
            {cancel ? "Confirm cancellation" : "Cancel task"}
          </Button>
        ) : (
          <span />
        )}
        <Button variant="primary" type="submit" disabled={saving}>
          {saving ? "Saving…" : item ? "Save changes" : "Schedule task"}
        </Button>
      </div>
    </form>
  );
}
