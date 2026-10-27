import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Archive,
  ArrowLeft,
  Check,
  ChevronRight,
  Clock3,
  FileText,
  Lightbulb,
  LoaderCircle,
  Reply,
  X,
} from "lucide-react";
import { Button, Modal, Platform } from "./ui";
import WorkActions from "./WorkActions";
import { turnActions } from "../lib/toolActions";
import Markdown, { type ArtifactLink } from "./Markdown";
import { ArtifactRow, ArtifactViewer, type Viewable } from "./Artifacts";
import { api } from "../lib/api";
import type { TaskArtifact, TaskDetail } from "../lib/tasks";
import "./WorkDetail.css";
import "./forms.css";

/** Where an idea's content work stands, for its row and dialog. */
function ideaStatus(item: TaskArtifact) {
  const work = item.content_work;
  if (!work) return null;
  if (!work.task_id) return "Queued for Orca";
  if (work.status === "queued" || work.status === "running")
    return "Orca is creating content";
  if (work.status === "failed") return "Content run failed";
  return "Content ready";
}

const dateLabel = (value: string) =>
  new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

export default function WorkDetail({
  taskId,
  founder,
  routineTitle,
  onBack,
  onOpenTask,
  onChanged,
  notify,
}: {
  taskId: string;
  founder: string;
  routineTitle?: string | null;
  onBack: () => void;
  onOpenTask: (taskId: string) => void;
  onChanged: () => void;
  notify: (message: string) => void;
}) {
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState<Viewable | null>(null);
  const [ideaId, setIdeaId] = useState<string | null>(null);
  const [ideaNote, setIdeaNote] = useState("");
  const [followUpOpen, setFollowUpOpen] = useState(false);
  const [feedback, setFeedback] = useState("");
  const requestController = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    try {
      const saved = await api<TaskDetail>(`/tasks/${taskId}`, {
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(15000),
        ]),
      });
      if (controller.signal.aborted) return;
      setTask(saved);
      setLoadError("");
    } catch (error) {
      if (controller.signal.aborted) return;
      setLoadError(
        error instanceof Error ? error.message : "Unable to load this work.",
      );
    } finally {
      if (requestController.current === controller)
        requestController.current = null;
    }
  }, [taskId]);
  useEffect(() => {
    void load();
    return () => requestController.current?.abort();
  }, [load]);
  const current = task?.turns.at(-1);
  const working = current?.status === "queued" || current?.status === "running";
  useEffect(() => {
    if (!working) return;
    const timer = setInterval(() => {
      if (!requestController.current) void load();
    }, 1500);
    return () => clearInterval(timer);
  }, [working, load]);
  useEffect(() => {
    // Keep the Inbox list in step once Orca finishes.
    if (task && !working) onChanged();
  }, [working, task?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (work: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await work();
      await load();
      onChanged();
      notify(done);
      return true;
    } catch (error) {
      notify(error instanceof Error ? error.message : "Something went wrong.");
      return false;
    } finally {
      setBusy(false);
    }
  };
  if (!task)
    return (
      <section className="work-page" aria-label="Inbox work detail">
        <header className="work-header">
          <button
            className="icon-button"
            onClick={onBack}
            aria-label="Back to Inbox"
          >
            <ArrowLeft size={19} />
          </button>
        </header>
        {loadError ? (
          <div className="work-load-error">
            <p className="chat-error" role="alert">
              {loadError}
            </p>
            <Button onClick={() => void load()}>Try again</Button>
          </div>
        ) : (
          <div className="chat-loading" role="status">
            Loading…
          </div>
        )}
      </section>
    );
  const archived = !!task.archived_at;
  const approved = !!task.approved_at;
  const artifacts = task.turns.flatMap((turn) => turn.artifacts);
  const idea = ideaId
    ? artifacts.find((item) => item.id === ideaId)
    : undefined;
  const openArtifact = (item: TaskArtifact) => {
    if (item.kind === "idea") {
      setIdeaNote("");
      setIdeaId(item.id);
    } else setViewing({ type: "artifact", id: item.id });
  };
  const artifactLink: ArtifactLink = (id) => {
    const item = artifacts.find((value) => value.id === id);
    if (!item) return null;
    if (item.kind === "url" && /^https?:\/\//i.test(item.content))
      return () => window.open(item.content, "_blank", "noreferrer");
    return () => openArtifact(item);
  };
  return (
    <section className="work-page" aria-label="Inbox work detail">
      <header className="work-header">
        <button
          className="icon-button"
          onClick={onBack}
          aria-label="Back to Inbox"
        >
          <ArrowLeft size={19} />
        </button>
        <div className="work-heading">
          <h1>{task.title}</h1>
        </div>
        {task.platform && (
          <span className="work-platform">
            <Platform name={task.platform} />
            {task.platform}
          </span>
        )}
      </header>
      <div className="work-scroll">
        <div className="work-content">
          {loadError && (
            <div className="work-load-error">
              <p className="chat-error" role="alert">
                {loadError}
              </p>
              <Button onClick={() => void load()}>Try again</Button>
            </div>
          )}
          {task.turns.map((turn, index) => {
            const request = turn.messages.find((m) => m.kind === "user");
            const actions = turnActions(turn.messages);
            const replies = turn.messages.filter(
              (m) => m.kind === "assistant" && m.content.text?.trim(),
            );
            const turnWorking =
              turn.status === "queued" || turn.status === "running";
            const seconds = turn.finished_at
              ? Math.max(
                  1,
                  Math.round(
                    (new Date(turn.finished_at).getTime() -
                      new Date(turn.started_at).getTime()) /
                      1000,
                  ),
                )
              : null;
            const fromRoutine = index === 0 && !!routineTitle;
            return (
              <Fragment key={turn.id}>
                {index > 0 && (
                  <div className="work-time-separator">
                    <time dateTime={turn.started_at}>
                      {dateLabel(turn.started_at)}
                    </time>
                  </div>
                )}
                <article
                  className={`work-entry ${index > 0 ? "follow-up-entry" : ""}`}
                >
                  <div className="work-author">
                    {fromRoutine ? (
                      <span className="brand-mark small">
                        <Clock3 size={14} />
                      </span>
                    ) : (
                      <span className="avatar">
                        {founder.charAt(0).toUpperCase() || "Y"}
                      </span>
                    )}
                    <strong>
                      {fromRoutine ? `Routine · ${routineTitle}` : founder}
                    </strong>
                    {index === 0 && (
                      <span className="muted">
                        {dateLabel(turn.started_at)}
                      </span>
                    )}
                  </div>
                  {request?.content.text && (
                    <div className="work-entry-content">
                      <Markdown text={request.content.text} />
                    </div>
                  )}
                  <section
                    className="work-agent-response"
                    aria-label="Agent work"
                  >
                    <div className="work-author">
                      <span className="brand-mark small">
                        {index === 0 ? (
                          <FileText size={14} />
                        ) : (
                          <Reply size={14} />
                        )}
                      </span>
                      <strong>Orca</strong>
                    </div>
                    <WorkActions
                      actions={actions}
                      seconds={seconds}
                      working={turnWorking}
                      onOpenMedia={(attachment) =>
                        setViewing({ type: "media", attachment })
                      }
                    />
                    <div className="work-entry-content">
                      {replies.map((reply) => (
                        <Markdown
                          key={reply.id}
                          text={reply.content.text!}
                          artifact={artifactLink}
                        />
                      ))}
                      {turnWorking && (
                        <p className="work-explanation work-status">
                          <LoaderCircle className="loading-icon" size={14} />
                          Orca is working on this…
                        </p>
                      )}
                      {turn.status === "failed" && (
                        <p
                          className="work-explanation work-status failed"
                          role="alert"
                        >
                          <AlertCircle size={14} />
                          {turn.error ?? "This run failed."} Use Follow Up to
                          try again.
                        </p>
                      )}
                      {turn.artifacts.length > 0 && (
                        <section
                          className="work-artifacts"
                          aria-label="Artifacts"
                        >
                          <h2>
                            Artifacts <span>{turn.artifacts.length}</span>
                          </h2>
                          {turn.artifacts.map((item) =>
                            item.kind === "idea" ? (
                              <button
                                key={item.id}
                                className="artifact-row idea-row"
                                onClick={() => openArtifact(item)}
                              >
                                <span className="artifact-icon">
                                  <Lightbulb size={18} />
                                </span>
                                <span>
                                  <strong>{item.title}</strong>
                                  <small>Content idea</small>
                                </span>
                                {ideaStatus(item) ? (
                                  <span className="idea-status">
                                    {ideaStatus(item)}
                                  </span>
                                ) : (
                                  !archived && (
                                    <span className="idea-cta">
                                      Create content
                                    </span>
                                  )
                                )}
                                <ChevronRight size={16} />
                              </button>
                            ) : (
                              <ArtifactRow
                                key={item.id}
                                item={item}
                                onOpen={() => openArtifact(item)}
                              />
                            ),
                          )}
                        </section>
                      )}
                    </div>
                  </section>
                </article>
              </Fragment>
            );
          })}
          {followUpOpen && (
            <section
              className="follow-up-panel"
              aria-label="Provide follow-up feedback"
            >
              <div className="follow-up-title">
                <h2>Follow Up</h2>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Close follow-up"
                  onClick={() => setFollowUpOpen(false)}
                >
                  <X size={17} aria-hidden="true" />
                </button>
              </div>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const message = feedback.trim();
                  if (!message) return;
                  void act(
                    () =>
                      api(`/tasks/${task.id}/turns`, {
                        method: "POST",
                        body: JSON.stringify({ message }),
                      }),
                    "Orca is working on your follow-up.",
                  ).then((ok) => {
                    if (ok) {
                      setFeedback("");
                      setFollowUpOpen(false);
                    }
                  });
                }}
              >
                <label htmlFor="work-feedback">
                  What would you like Orca to change or continue?
                </label>
                <textarea
                  id="work-feedback"
                  autoFocus
                  rows={4}
                  value={feedback}
                  onChange={(event) => setFeedback(event.target.value)}
                  placeholder="Share your feedback or the next step…"
                />
                <div className="form-footer">
                  <Button onClick={() => setFollowUpOpen(false)}>Cancel</Button>
                  <Button
                    type="submit"
                    variant="primary"
                    disabled={!feedback.trim() || busy}
                  >
                    <Reply size={15} aria-hidden="true" />
                    Send follow-up
                  </Button>
                </div>
              </form>
            </section>
          )}
          <div className="work-review">
            <Button
              onClick={() => setFollowUpOpen(true)}
              disabled={followUpOpen || working || archived || busy}
            >
              <Reply size={15} />
              Follow Up
            </Button>
            <Button
              variant="primary"
              onClick={() =>
                void act(
                  () =>
                    api(`/tasks/${task.id}`, {
                      method: "PATCH",
                      body: JSON.stringify({ action: "approve" }),
                    }),
                  "Approved.",
                )
              }
              disabled={
                approved || working || busy || current?.status !== "completed"
              }
            >
              <Check size={15} />
              {approved ? "Approved" : "Approve"}
            </Button>
            <Button
              onClick={() =>
                void act(
                  () =>
                    api(`/tasks/${task.id}`, {
                      method: "PATCH",
                      body: JSON.stringify({ action: "archive" }),
                    }),
                  "Work archived.",
                )
              }
              disabled={archived || working || busy}
            >
              <Archive size={15} />
              {archived ? "Archived" : "Archive"}
            </Button>
          </div>
        </div>
      </div>
      <Modal
        open={!!idea}
        onOpenChange={(open) => {
          if (!open) setIdeaId(null);
        }}
        title={idea?.title ?? "Idea"}
        description={`${task.platform ? `${task.platform} · ` : ""}Content idea`}
        className="idea-modal"
      >
        {idea && (
          <div className="idea-detail">
            <div className="idea-body">
              <Markdown text={idea.content} />
            </div>
            {idea.content_work ? (
              <div className="idea-footer idea-footer-status">
                <p>
                  {ideaStatus(idea)}
                  {!idea.content_work.task_id &&
                    ` · starts around ${dateLabel(idea.content_work.run_at)}`}
                </p>
                {idea.content_work.task_id && (
                  <Button
                    variant="primary"
                    onClick={() => onOpenTask(idea.content_work!.task_id!)}
                  >
                    Open content
                    <ChevronRight size={15} />
                  </Button>
                )}
              </div>
            ) : (
              !archived && (
                <form
                  className="idea-footer"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void act(
                      () =>
                        api(`/tasks/${task.id}/artifacts/${idea.id}/content`, {
                          method: "POST",
                          body: JSON.stringify({ note: ideaNote.trim() }),
                        }),
                      "Queued. Orca will start on it in a few minutes.",
                    );
                  }}
                >
                  <label htmlFor="idea-note">
                    Note for Orca <span>Optional</span>
                  </label>
                  <textarea
                    id="idea-note"
                    rows={2}
                    maxLength={2000}
                    value={ideaNote}
                    placeholder="e.g. Use our launch story, or keep the product out of it"
                    onChange={(event) => setIdeaNote(event.target.value)}
                  />
                  <div className="idea-actions">
                    <Button variant="primary" type="submit" disabled={busy}>
                      Create content from this idea
                      <ChevronRight size={15} aria-hidden="true" />
                    </Button>
                  </div>
                </form>
              )
            )}
          </div>
        )}
      </Modal>
      <ArtifactViewer
        taskId={task.id}
        artifacts={artifacts}
        viewing={viewing}
        readOnly={archived}
        context={task.platform ?? undefined}
        onClose={() => setViewing(null)}
        onSaved={async () => {
          await load();
          onChanged();
          notify("Artifact saved.");
        }}
        artifactLink={artifactLink}
      />
    </section>
  );
}
