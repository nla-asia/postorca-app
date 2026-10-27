import { ArrowRight, CheckCheck } from "lucide-react";
import { Button, Pill, Platform } from "../components/ui";
import type { WorkTask } from "../lib/schedules";
import { workState, type WorkState } from "../lib/useWorkTasks";
import "./Inbox.css";
import "../components/tabs.css";

const tabs = ["For review", "Approved", "All activity"] as const;
export type InboxFilter = (typeof tabs)[number];
const stateLabel: Record<WorkState, string> = {
  working: "Orca is working",
  failed: "Needs attention",
  review: "Ready for your review",
  approved: "Approved",
  archived: "Archived",
};
function inTab(task: WorkTask, tab: InboxFilter) {
  const state = workState(task);
  if (tab === "Approved") return state === "approved";
  if (tab === "For review")
    return ["working", "review", "failed"].includes(state);
  return true;
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
}: {
  tasks: WorkTask[] | null;
  error: string;
  onRetry: () => void;
  reviewCount: number;
  filter: InboxFilter;
  onFilterChange: (filter: InboxFilter) => void;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="page-content inbox-page">
      <div className="section-toolbar">
        <div className="tabs" role="tablist" aria-label="Inbox filters">
          {tabs.map((tab, index) => (
            <button
              type="button"
              key={tab}
              id={`inbox-tab-${index}`}
              role="tab"
              aria-selected={filter === tab}
              aria-controls="inbox-results"
              tabIndex={filter === tab ? 0 : -1}
              className={filter === tab ? "selected" : ""}
              onClick={() => setFilter(tab)}
              onKeyDown={(event) => {
                if (
                  !["ArrowRight", "ArrowLeft", "Home", "End"].includes(
                    event.key,
                  )
                )
                  return;
                event.preventDefault();
                const next =
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? tabs.length - 1
                      : (index +
                          (event.key === "ArrowRight" ? 1 : -1) +
                          tabs.length) %
                        tabs.length;
                setFilter(tabs[next]);
                document.getElementById(`inbox-tab-${next}`)?.focus();
              }}
            >
              {tab}
              {tab === "For review" && <span>{reviewCount}</span>}
            </button>
          ))}
        </div>
      </div>
      {error && (
        <div className="inbox-load-error">
          <p className="chat-error" role="alert">
            {error}
          </p>
          <Button onClick={onRetry}>Try again</Button>
        </div>
      )}
      <div
        className="proposal-list"
        id="inbox-results"
        role="tabpanel"
        aria-labelledby={`inbox-tab-${tabs.indexOf(filter)}`}
      >
        {tasks === null
          ? !error && (
              <div className="chat-loading" role="status">
                Loading…
              </div>
            )
          : tasks
              .filter((task) => inTab(task, filter))
              .map((task) => {
                const state = workState(task);
                return (
                  <article
                    key={task.id}
                    className="proposal-card"
                    tabIndex={0}
                    role="button"
                    onClick={() => onSelect(task.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onSelect(task.id);
                      }
                    }}
                  >
                    <div className="proposal-top">
                      <div className="proposal-meta">
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
        {tasks?.filter((task) => inTab(task, filter)).length === 0 && (
          <div className="empty-state">
            <CheckCheck size={30} aria-hidden="true" />
            <h3>
              {filter === "Approved"
                ? "Good ideas start here"
                : "You’re all caught up"}
            </h3>
            <p>
              {filter === "Approved"
                ? "Work you approve will appear here."
                : "Work from your routines will show up here."}
            </p>
          </div>
        )}
      </div>
      <p className="preview-note">
        Saved work appears here. Automatic execution is coming soon.
      </p>
    </div>
  );
}
