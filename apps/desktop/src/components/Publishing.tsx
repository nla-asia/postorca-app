import { useEffect, useState, type FormEvent } from "react";
import { CalendarClock, Check, Copy, ExternalLink } from "lucide-react";
import { Button, Modal } from "./ui";
import { api } from "../lib/api";
import type { Brand } from "../lib/brand";
import type { PlatformName } from "../lib/schedules";
import type { Publication, TaskArtifact } from "../lib/tasks";

const PLATFORM_OF_KIND: Partial<Record<string, PlatformName>> = {
  x: "X",
  threads: "Threads",
  instagram: "Instagram",
  facebook: "Facebook",
  linkedin: "LinkedIn",
};

/**
 * The post itself from a post document: everything before the "Other openings" or
 * "Placeholders" notes the create-content skill adds below it. The founder confirms
 * (and can edit) this text before it's scheduled.
 */
export function postText(content: string) {
  const notes = content.search(/^\s*(\*\*)?(Other openings|Placeholders)\b/im);
  return (notes >= 0 ? content.slice(0, notes) : content).trim();
}

/** A numbered thread ("1/ … 2/ …") as its posts; anything else is one post. */
export function threadParts(text: string) {
  return /^\s*1\//.test(text)
    ? text
        .split(/\n\s*(?=\d+\/)/)
        .map((part) => part.trim())
        .filter(Boolean)
    : [text];
}

/** The platform's compose page with the text filled in, where it has one. */
function composeUrl(platform: PlatformName | null, text: string) {
  const encoded = encodeURIComponent(text);
  if (platform === "X") return `https://x.com/intent/post?text=${encoded}`;
  if (platform === "Threads")
    return `https://www.threads.net/intent/post?text=${encoded}`;
  if (platform === "LinkedIn")
    return `https://www.linkedin.com/feed/?shareActive=true&text=${encoded}`;
  return null;
}

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

/** Tomorrow 09:00 local, as a datetime-local value. */
function tomorrowMorning() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(9, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T09:00`;
}

/** Under a post document: schedule it, or see and manage its schedule. */
export function PostSchedule({
  taskId,
  platform,
  item,
  readOnly,
  onChanged,
  onOpenTask,
  notify,
}: {
  taskId: string;
  /** The task's platform: where a post goes unless the founder picks another. */
  platform: PlatformName | null;
  item: TaskArtifact;
  readOnly: boolean;
  onChanged: () => void;
  onOpenTask: (taskId: string) => void;
  notify: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const scheduled = item.publication;
  const cancel = async () => {
    if (!scheduled) return;
    setBusy(true);
    try {
      await api(`/publications/${scheduled.id}`, { method: "DELETE" });
      notify("Schedule cancelled.");
      onChanged();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to cancel.");
    } finally {
      setBusy(false);
    }
  };
  const who = `${scheduled?.platform ? `on ${scheduled.platform} · ` : ""}${scheduled?.publisher === "agent" ? "Orca posts it" : "You post it"}`;
  return (
    <div className="post-schedule">
      {scheduled?.status === "scheduled" ? (
        <>
          <CalendarClock size={14} />
          <span>
            Scheduled for {when(scheduled.post_at)} · {who}
          </span>
          {!readOnly && (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => void cancel()}
            >
              Cancel
            </Button>
          )}
        </>
      ) : scheduled?.status === "due" ? (
        <>
          <CalendarClock size={14} />
          <span>Due now · {who}</span>
          {scheduled.task_id && (
            <Button
              variant="ghost"
              onClick={() => onOpenTask(scheduled.task_id!)}
            >
              Open
            </Button>
          )}
        </>
      ) : scheduled?.status === "posted" ? (
        <>
          <Check size={14} />
          <span>Posted</span>
          {scheduled.posted_url && (
            <a href={scheduled.posted_url} target="_blank" rel="noreferrer">
              View post <ExternalLink size={12} />
            </a>
          )}
        </>
      ) : (
        !readOnly && (
          <Button onClick={() => setOpen(true)}>
            <CalendarClock size={15} />
            {scheduled?.status === "skipped"
              ? "Schedule again"
              : "Schedule post"}
          </Button>
        )
      )}
      {open && (
        <ScheduleDialog
          taskId={taskId}
          platform={platform}
          item={item}
          onClose={() => setOpen(false)}
          onScheduled={(message) => {
            setOpen(false);
            notify(message);
            onChanged();
          }}
        />
      )}
    </div>
  );
}

function ScheduleDialog({
  taskId,
  platform,
  item,
  onClose,
  onScheduled,
}: {
  taskId: string;
  platform: PlatformName | null;
  item: TaskArtifact;
  onClose: () => void;
  onScheduled: (message: string) => void;
}) {
  const [text, setText] = useState(() => postText(item.content));
  const [at, setAt] = useState(tomorrowMorning);
  const [publisher, setPublisher] =
    useState<Publication["publisher"]>("founder");
  // Where it goes: one of the founder's accounts, the task's platform first.
  const [target, setTarget] = useState<PlatformName | null>(platform);
  const [accounts, setAccounts] = useState<PlatformName[]>(
    platform ? [platform] : [],
  );
  useEffect(() => {
    void api<Brand>("/brand-profile")
      .then((brand) => {
        const found = brand.links.flatMap(
          (link) => PLATFORM_OF_KIND[link.kind] ?? [],
        );
        setAccounts([...new Set([...(platform ? [platform] : []), ...found])]);
        setTarget((current) => current ?? found[0] ?? null);
      })
      .catch(() => {});
  }, [platform]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const saved = await api<Publication>(
        `/tasks/${taskId}/artifacts/${item.id}/publication`,
        {
          method: "POST",
          body: JSON.stringify({
            text,
            post_at: new Date(at).toISOString(),
            publisher,
            ...(target ? { platform: target } : {}),
          }),
        },
      );
      onScheduled(
        `Scheduled for ${when(saved.post_at)}. ${publisher === "agent" ? "Orca will post it." : "You'll get a reminder."}`,
      );
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Unable to schedule.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onOpenChange={(next) => !next && onClose()}
      title="Schedule post"
      description={item.title}
    >
      <form className="schedule-form" onSubmit={submit}>
        <label>
          Post
          <textarea
            value={text}
            rows={8}
            required
            maxLength={25000}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        <label>
          Post on
          <select
            value={target ?? ""}
            required
            onChange={(e) => setTarget(e.target.value as PlatformName)}
          >
            {!target && <option value="">Choose an account</option>}
            {accounts.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label>
          When
          <input
            type="datetime-local"
            value={at}
            required
            onChange={(e) => setAt(e.target.value)}
          />
        </label>
        <fieldset>
          <legend>Who posts it</legend>
          <label className="schedule-choice">
            <input
              type="radio"
              checked={publisher === "founder"}
              onChange={() => setPublisher("founder")}
            />
            <span>
              <strong>Me</strong>
              <small>You get a reminder with the text ready to copy.</small>
            </span>
          </label>
          <label className="schedule-choice">
            <input
              type="radio"
              checked={publisher === "agent"}
              onChange={() => setPublisher("agent")}
            />
            <span>
              <strong>Orca</strong>
              <small>Orca posts it from your account in your browser.</small>
            </span>
          </label>
        </fieldset>
        {/\[[^\]\n]{2,}\](?!\()/.test(text) && (
          <p className="form-error">
            This post still has a placeholder in brackets. Fill it in before it
            goes out.
          </p>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="schedule-actions">
          <Button variant="ghost" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={busy}>
            Schedule
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** A publish task: the post, ready to copy and post, and how it ended. */
export function PublishPanel({
  publication,
  readOnly,
  onChanged,
  onOpenTask,
  notify,
}: {
  publication: Publication;
  readOnly: boolean;
  onChanged: () => void;
  onOpenTask: (taskId: string) => void;
  notify: (message: string) => void;
}) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const parts = threadParts(publication.text);
  const compose = composeUrl(publication.platform, parts[0]);
  const open =
    publication.status === "scheduled" || publication.status === "due";
  const founder = publication.publisher === "founder";
  const record = async (body: object, done: string) => {
    setBusy(true);
    try {
      await api(`/publications/${publication.id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      notify(done);
      onChanged();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to save.");
    } finally {
      setBusy(false);
    }
  };
  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    notify("Copied.");
  };
  return (
    <section className="publish-panel" aria-label="Post to publish">
      <header>
        <h2>
          {publication.status === "posted"
            ? "Posted"
            : publication.status === "skipped"
              ? "Skipped"
              : founder
                ? `Time to post${publication.platform ? ` on ${publication.platform}` : ""}`
                : `Orca is posting this${publication.platform ? ` on ${publication.platform}` : ""}`}
        </h2>
        <span className="muted">Scheduled for {when(publication.post_at)}</span>
      </header>
      {parts.map((part, index) => (
        <div className="publish-part" key={index}>
          {parts.length > 1 && (
            <span className="muted">
              Post {index + 1} of {parts.length}
            </span>
          )}
          <p>{part}</p>
          <Button variant="ghost" onClick={() => void copy(part)}>
            <Copy size={14} />
            Copy
          </Button>
        </div>
      ))}
      <div className="publish-actions">
        {compose && open && founder && (
          <a
            className="button primary"
            href={compose}
            target="_blank"
            rel="noreferrer"
          >
            Open {publication.platform} with this text
            <ExternalLink size={14} />
          </a>
        )}
        <Button
          variant="ghost"
          onClick={() => onOpenTask(publication.source_task_id)}
        >
          Images and clips in the draft
        </Button>
      </div>
      {open && !readOnly ? (
        <form
          className="publish-done"
          onSubmit={(event) => {
            event.preventDefault();
            void record(
              { status: "posted", url: url.trim() },
              "Marked as posted.",
            );
          }}
        >
          <input
            type="url"
            required
            placeholder="Link to the live post"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <Button variant="primary" type="submit" disabled={busy}>
            Mark as posted
          </Button>
          <Button
            variant="ghost"
            type="button"
            disabled={busy}
            onClick={() => void record({ status: "skipped" }, "Skipped.")}
          >
            Skip
          </Button>
        </form>
      ) : (
        publication.posted_url && (
          <a href={publication.posted_url} target="_blank" rel="noreferrer">
            View the live post <ExternalLink size={12} />
          </a>
        )
      )}
    </section>
  );
}
