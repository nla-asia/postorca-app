import { useState } from "react";
import {
  Archive,
  ArrowLeft,
  ArrowRight,
  CheckCheck,
  History,
} from "lucide-react";
import { api } from "../lib/api";
import { Button, Pill, Platform } from "../components/ui";
import type { WorkTask } from "../lib/schedules";
import { workState, type WorkState } from "../lib/useWorkTasks";
import "./Inbox.css";

export type InboxFilter = "review" | "history";
const stateLabel: Record<WorkState, string> = {
  working: "Orca is working",
  failed: "Needs attention",
  review: "Ready for your review",
  approved: "Approved",
  archived: "Archived",
};
/** Review holds work in flight or waiting on the founder; history holds what they closed. */
function inView(task: WorkTask, view: InboxFilter) {
  const closed = ["approved", "archived"].includes(workState(task));
  return view === "history" ? closed : !closed;
}
function closedAt(task: WorkTask) {
  return new Date(
    task.archived_at ?? task.approved_at ?? task.created_at,
  ).getTime();
}
function timeAgo(value: string) {
  const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export default function Inbox({
  tasks,
  error,
  onRetry,
  reviewCount,
  filter,
  onFilterChange: setFilter,
  onSelect,
  onChanged,
  notify,
}: {
  tasks: WorkTask[] | null;
  error: string;
  onRetry: () => void;
  reviewCount: number;
  filter: InboxFilter;
  onFilterChange: (filter: InboxFilter) => void;
  onSelect: (id: string) => void;
  onChanged: () => void;
  notify: (message: string) => void;
}) {
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [archiving, setArchiving] = useState(false);
  const history = filter === "history";
  const working = (task: WorkTask) => Number(workState(task) === "working");
  const shown =
    tasks
      ?.filter((task) => inView(task, filter))
      .sort((a, b) =>
        history ? closedAt(b) - closedAt(a) : working(b) - working(a),
      ) ?? [];
  const checkable = shown.filter((task) =>
    ["review", "approved", "failed"].includes(workState(task)),
  );
  const selected = checkable.filter((task) => checked.has(task.id));
  const changeFilter = (next: InboxFilter) => {
    setChecked(new Set());
    setFilter(next);
  };
  const archiveSelected = async () => {
    if (archiving || !selected.length) return;
    setArchiving(true);
    let archived = 0;
    let failure = "";
    for (const task of selected) {
      try {
        await api(`/tasks/${task.id}`, {
          method: "PATCH",
          body: JSON.stringify({ action: "archive" }),
        });
        archived++;
        setChecked((current) => {
          const next = new Set(current);
          next.delete(task.id);
          return next;
        });
      } catch (error) {
        failure = error instanceof Error ? error.message : "Unable to archive.";
      }
    }
    onChanged();
    const remaining = selected.length - archived;
    notify(
      `${archived} archived.` +
        (remaining ? ` ${remaining} could not be archived. ${failure}` : ""),
    );
    setArchiving(false);
  };
  return (
    <div className="page-content inbox-page">
      <div className="section-toolbar">
        <h2 className="inbox-heading">
          {history ? "History" : "For review"}
          {!history && <span>{reviewCount}</span>}
        </h2>
        <Button
          variant="ghost"
          disabled={archiving}
          onClick={() => changeFilter(history ? "review" : "history")}
        >
          {history ? (
            <ArrowLeft size={15} aria-hidden="true" />
          ) : (
            <History size={15} aria-hidden="true" />
          )}
          {history ? "Back to review" : "History"}
        </Button>
      </div>
      {error && (
        <div className="inbox-load-error">
          <p className="chat-error" role="alert">
            {error}
          </p>
          <Button onClick={onRetry}>Try again</Button>
        </div>
      )}
      {checkable.length > 0 && (
        <div className="bulk-bar">
          <label className="bulk-check">
            <input
              type="checkbox"
              aria-label="Select all"
              disabled={archiving}
              checked={selected.length === checkable.length}
              ref={(box) => {
                if (box)
                  box.indeterminate =
                    selected.length > 0 && selected.length < checkable.length;
              }}
              onChange={() =>
                setChecked(new Set(
                  selected.length === checkable.length
                    ? []
                    : checkable.map((task) => task.id),
                ))
              }
            />
            {selected.length ? `${selected.length} selected` : "Select all"}
          </label>
          {selected.length > 0 && (
            <Button
              variant="ghost"
              disabled={archiving}
              onClick={() => void archiveSelected()}
            >
              <Archive size={15} aria-hidden="true" />
              {archiving ? "Archiving…" : "Archive"}
            </Button>
          )}
        </div>
      )}
      <div
        className="proposal-list"
        aria-label={history ? "Inbox history" : "Work for review"}
      >
        {tasks === null
          ? !error && (
              <div className="chat-loading" role="status">
                Loading…
              </div>
            )
          : shown.map((task) => {
                const state = workState(task);
                return (
                  <article
                    key={task.id}
                    className={`proposal-card${checked.has(task.id) ? " checked" : ""}`}
                    tabIndex={0}
                    role="button"
                    onClick={() => {
                      if (!archiving) onSelect(task.id);
                    }}
                    onKeyDown={(event) => {
                      if (
                        !archiving &&
                        (event.key === "Enter" || event.key === " ")
                      ) {
                        event.preventDefault();
                        onSelect(task.id);
                      }
                    }}
                  >
                    <div className="proposal-top">
                      <div className="proposal-meta">
                        {checkable.includes(task) && (
                          <input
                            type="checkbox"
                            className="card-check"
                            aria-label={`Select ${task.title}`}
                            checked={checked.has(task.id)}
                            disabled={archiving}
                            onClick={(event) => event.stopPropagation()}
                            onKeyDown={(event) => event.stopPropagation()}
                            onChange={() =>
                              setChecked((current) => {
                                const next = new Set(current);
                                if (!next.delete(task.id)) next.add(task.id);
                                return next;
                              })
                            }
                          />
                        )}
                        {task.platform && (
                          <>
                            <Platform name={task.platform} />
                            <strong>{task.platform}</strong>
                            <span className="meta-dot">·</span>
                          </>
                        )}
                        <span>{task.routine_title ? "Routine" : "Work"}</span>
                      </div>
                      <span className="proposal-time">
                        {timeAgo(task.created_at)}
                      </span>
                    </div>
                    <h3>{task.title}</h3>
                    <p>
                      {task.summary?.replace(/[*#`]/g, "") ||
                        (state === "working"
                          ? "Orca is working on this now."
                          : state === "failed"
                            ? "This run didn’t finish. Open it to see why."
                            : "No summary yet.")}
                    </p>
                    <div className="proposal-bottom">
                      <Pill
                        tone={
                          state === "approved"
                            ? "green"
                            : state === "failed"
                              ? "danger"
                              : ""
                        }
                      >
                        {stateLabel[state]}
                      </Pill>
                      <span className="review-link">
                        Take a look
                        <ArrowRight size={15} />
                      </span>
                    </div>
                  </article>
                );
              })}
        {tasks !== null && shown.length === 0 && (
          <div className="empty-state">
            <CheckCheck size={30} aria-hidden="true" />
            <h3>
              {history ? "Nothing here yet" : "You’re all caught up"}
            </h3>
            <p>
              {history
                ? "Work you approve or archive will appear here."
                : "Work from your routines will show up here."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
