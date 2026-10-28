import { useEffect, useRef, useState } from "react";
import {
  BarChart2,
  Check,
  Copy,
  ExternalLink,
  Heart,
  MessageCircle,
  Repeat2,
  Send,
  Undo2,
  UserPlus,
  X,
} from "lucide-react";
import { Button, Platform } from "./ui";
import { api } from "../lib/api";
import type { TaskArtifact } from "../lib/tasks";
import {
  REPLY_LIMIT,
  compact,
  followIntent,
  parseReply,
  postedLabel,
  profileUrl,
  replyIntent,
} from "../lib/social";
import "./ReplyCard.css";

type Account = { name: string; handle?: string } | null;

const initial = (name: string) => name.trim().charAt(0).toUpperCase() || "?";
const open = (url: string) => window.open(url, "_blank", "noreferrer");

function Stats({ stats }: { stats?: Record<string, number | string> }) {
  if (!stats) return null;
  const items = [
    ["replies", MessageCircle],
    ["reposts", Repeat2],
    ["likes", Heart],
    ["views", BarChart2],
  ] as const;
  const shown = items.filter(([key]) => stats[key] !== undefined);
  if (!shown.length) return null;
  return (
    <div className="reply-target-stats">
      {shown.map(([key, Icon]) => (
        <span key={key} title={key}>
          <Icon size={13} />
          {compact(stats[key])}
        </span>
      ))}
      {stats.author_followers !== undefined && (
        <span className="followers">
          {compact(stats.author_followers)} followers
        </span>
      )}
    </div>
  );
}

/**
 * A draft reply to someone else's post: their post, the founder's reply under it
 * (editable), and the actions to post it: reply (prefilled where the platform
 * allows), copy, open, follow for connect replies, then Done or Skip.
 */
export default function ReplyCard({
  taskId,
  item,
  account,
  readOnly,
  onChanged,
  notify,
}: {
  taskId: string;
  item: TaskArtifact;
  account: Account;
  readOnly: boolean;
  onChanged: () => void;
  notify: (message: string) => void;
}) {
  const reply = parseReply(item);
  const [text, setText] = useState(reply?.text ?? "");
  const [followed, setFollowed] = useState(false);
  const saved = useRef(reply?.text ?? "");
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const value = parseReply(item)?.text ?? "";
    saved.current = value;
    setText(value);
  }, [item.content]);
  // Grow the reply box with its text, like a composer.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);
  if (!reply) return null;

  const done = item.state === "done";
  const skipped = item.state === "skipped";
  const limit = REPLY_LIMIT[reply.platform];
  const over = text.length > limit;
  const handle = reply.target.handle?.replace(/^@/, "");
  const intent = replyIntent(reply, text);
  const follow = followIntent(reply) ?? profileUrl(reply);

  const patch = async (body: Record<string, unknown>) => {
    await api(`/tasks/${taskId}/artifacts/${item.id}/reply`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    onChanged();
  };
  const saveText = async () => {
    const value = text.trim();
    if (!value || value === saved.current) return;
    try {
      await patch({ text: value });
      saved.current = value;
    } catch {
      notify("Couldn't save the reply. Try again.");
    }
  };
  const copy = async () => {
    await navigator.clipboard.writeText(text.trim());
    notify("Reply copied.");
  };
  const replyNow = async () => {
    await saveText();
    if (intent) open(intent);
    else {
      await copy();
      open(reply.target.url);
    }
  };
  const setState = (state: "done" | "skipped" | null) =>
    patch({ state }).catch(() => notify("Couldn't update. Try again."));

  return (
    <article
      id={`artifact-${item.id}`}
      className={`reply-card ${done ? "done" : ""} ${skipped ? "skipped" : ""}`}
      aria-label={item.title}
    >
      <div className="reply-target">
        <span className="reply-avatar">{initial(reply.target.author)}</span>
        <div className="reply-target-body">
          <div className="reply-byline">
            <strong>{reply.target.author}</strong>
            {handle && <span>@{handle}</span>}
            {reply.target.posted_at && (
              <span>· {postedLabel(reply.target.posted_at)}</span>
            )}
            <span className="reply-platform">
              <Platform name={reply.platform} />
            </span>
          </div>
          {reply.target.text && (
            <p className="reply-target-text">{reply.target.text}</p>
          )}
          <Stats stats={reply.target.stats} />
          {reply.why && <p className="reply-why">{reply.why}</p>}
        </div>
      </div>

      <div className="reply-mine">
        <span className="reply-avatar mine">
          {initial(account?.name ?? "You")}
        </span>
        <div className="reply-mine-body">
          <div className="reply-byline">
            <strong>{account?.name ?? "You"}</strong>
            {account?.handle && <span>@{account.handle}</span>}
            {handle && <span className="replying">Replying to @{handle}</span>}
          </div>
          <textarea
            ref={box}
            value={text}
            rows={1}
            readOnly={readOnly || done || skipped}
            onChange={(event) => setText(event.target.value)}
            onBlur={() => void saveText()}
            aria-label="Your reply"
          />
          <span className={`reply-count ${over ? "over" : ""}`}>
            {text.length}/{limit}
          </span>
        </div>
      </div>

      <footer className="reply-actions">
        {done || skipped ? (
          <>
            <span className={`reply-state ${done ? "done" : ""}`}>
              {done ? <Check size={14} /> : <X size={14} />}
              {done ? "Done" : "Skipped"}
            </span>
            {!readOnly && (
              <Button variant="ghost" onClick={() => void setState(null)}>
                <Undo2 size={14} />
                Undo
              </Button>
            )}
          </>
        ) : (
          <>
            {reply.intent === "connect" && follow && (
              <Button
                onClick={() => {
                  open(follow);
                  setFollowed(true);
                }}
              >
                <UserPlus size={14} />
                {followed ? "Opened" : "Follow"}
              </Button>
            )}
            <Button
              variant="primary"
              disabled={over || !text.trim()}
              onClick={() => void replyNow()}
            >
              <Send size={14} />
              {intent ? `Reply on ${reply.platform}` : "Copy & open post"}
            </Button>
            <Button variant="ghost" onClick={() => void copy()} aria-label="Copy reply">
              <Copy size={14} />
            </Button>
            <Button
              variant="ghost"
              onClick={() => open(reply.target.url)}
              aria-label="Open post"
            >
              <ExternalLink size={14} />
            </Button>
            {!readOnly && (
              <span className="reply-done">
                <Button variant="ghost" onClick={() => void setState("skipped")}>
                  Skip
                </Button>
                <Button onClick={() => void setState("done")}>
                  <Check size={14} />
                  Done
                </Button>
              </span>
            )}
          </>
        )}
      </footer>
    </article>
  );
}
