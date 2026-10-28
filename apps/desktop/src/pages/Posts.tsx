import { useCallback, useEffect, useState } from "react";
import {
  ArrowUpRight,
  CircleCheck,
  CircleDashed,
  Clock3,
  EyeOff,
  Image,
  Newspaper,
  Search,
  Sparkles,
} from "lucide-react";
import { Button, Pill, Platform } from "../components/ui";
import { api } from "../lib/api";
import "./Posts.css";
import "../components/forms.css";
import "../components/tabs.css";

type Account = {
  id: string;
  name: string;
  url: string;
  platform: string;
  posts_synced_at: string | null;
};
type Post = {
  id: string;
  account: string | null;
  platform: string;
  kind: string;
  url: string | null;
  text: string | null;
  text_truncated: boolean;
  text_length: number | null;
  title: string | null;
  media_type: "none" | "image" | "video" | "carousel" | "link";
  media_description: string | null;
  reply_to_url: string | null;
  posted_at: string | null;
  stats: Record<string, number>;
  stats_checked_at: string | null;
  source: "sync" | "founder" | "agent";
  artifact_id: string | null;
};
type Result = { accounts: Account[]; posts: Post[]; has_more: boolean };

const views = [
  { key: "posts", label: "Posts" },
  { key: "replies", label: "Replies" },
  { key: "all", label: "All" },
] as const;
type View = (typeof views)[number]["key"];

const kindLabel: Record<string, string> = {
  reply: "Reply",
  quote: "Quote",
  repost: "Repost",
  article: "Article",
  reel: "Reel",
  story: "Story",
  carousel: "Carousel",
};
const mediaLabel = {
  image: "Image",
  video: "Video",
  carousel: "Carousel",
  link: "Link preview",
};

function ago(value: string) {
  const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  return days < 30 ? `${days} d ago` : postedOn(value);
}
const postedOn = (value: string) =>
  new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year:
      new Date(value).getFullYear() === new Date().getFullYear()
        ? undefined
        : "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
/** How fresh an account's saved posts are: read in the last day, earlier, or never. */
function syncState(account: Account) {
  if (!account.posts_synced_at)
    return { tone: "never", Icon: CircleDashed, label: "Not read yet" };
  const label = `Last read ${ago(account.posts_synced_at)}`;
  return Date.now() - new Date(account.posts_synced_at).getTime() < 86_400_000
    ? { tone: "fresh", Icon: CircleCheck, label }
    : { tone: "stale", Icon: Clock3, label };
}
const statLabel = (key: string, value: number) =>
  `${value.toLocaleString()} ${value !== 1 ? key : key.endsWith("ies") ? `${key.slice(0, -3)}y` : key.replace(/s$/, "")}`;
/** "@handle" for an X or Threads post link, else the link without its scheme. */
function replyTarget(url: string) {
  const handle = url.match(
    /^https?:\/\/(?:www\.)?(?:x\.com|twitter\.com|threads\.(?:net|com))\/@?([\w.]+)\/(?:status|post)\//,
  )?.[1];
  return handle ? `@${handle}` : url.replace(/^https?:\/\/(www\.)?/, "");
}

/** The founder's own published posts, as Orca reads them. */
export default function Posts({
  notify,
}: {
  notify: (message: string) => void;
}) {
  const [view, setView] = useState<View>("posts");
  const [account, setAccount] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  // Search as the founder types, after a short pause.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const path = useCallback(
    (before?: string) => {
      const params = new URLSearchParams({ view });
      if (account) params.set("account", account);
      if (query) params.set("q", query);
      if (before) params.set("before", before);
      return `/posts?${params}`;
    },
    [view, account, query],
  );

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const next = await api<Result>(path(), { signal });
        setResult(next);
        setHidden(new Set());
        setError("");
      } catch (caught) {
        if (signal?.aborted) return;
        setError(
          caught instanceof Error
            ? caught.message
            : "Unable to load your posts.",
        );
      }
    },
    [path],
  );
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const loadMore = async () => {
    const last = result?.posts.at(-1)?.posted_at;
    if (!result || !last) return;
    setLoadingMore(true);
    try {
      const next = await api<Result>(path(last));
      setResult({ ...next, posts: [...result.posts, ...next.posts] });
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : "Unable to load more.");
    } finally {
      setLoadingMore(false);
    }
  };

  const setPostHidden = async (post: Post, hide: boolean) => {
    try {
      await api(hide ? `/posts/${post.id}` : `/posts/${post.id}/restore`, {
        method: hide ? "DELETE" : "POST",
      });
      setHidden((previous) => {
        const next = new Set(previous);
        if (hide) next.add(post.id);
        else next.delete(post.id);
        return next;
      });
    } catch (caught) {
      notify(
        caught instanceof Error
          ? caught.message
          : "Unable to change this post.",
      );
    }
  };

  const accounts = result?.accounts ?? [];
  return (
    <div className="page-content posts-page">
      <div className="section-toolbar posts-toolbar">
        <div className="tabs" role="tablist" aria-label="Post kinds">
          {views.map((item) => (
            <button
              type="button"
              key={item.key}
              role="tab"
              aria-selected={view === item.key}
              aria-controls="posts-results"
              className={view === item.key ? "selected" : ""}
              onClick={() => setView(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <label className="posts-search">
          <Search size={14} aria-hidden="true" />
          <input
            type="search"
            placeholder="Search your posts"
            aria-label="Search your posts"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
      </div>

      {accounts.length > 0 && (
        <div className="posts-accounts" role="group" aria-label="Accounts">
          <button
            type="button"
            className={`account-chip ${account ? "" : "selected"}`}
            aria-pressed={!account}
            onClick={() => setAccount(null)}
          >
            All accounts
          </button>
          {accounts.map((item) => {
            const sync = syncState(item);
            return (
              <button
                type="button"
                key={item.id}
                className={`account-chip ${account === item.id ? "selected" : ""}`}
                aria-pressed={account === item.id}
                aria-label={`${item.name}, ${item.platform}. ${sync.label}`}
                title={sync.label}
                onClick={() => setAccount(item.id)}
              >
                <Platform name={item.platform} />
                <span>{item.name}</span>
                <sync.Icon
                  size={13}
                  className={`account-sync ${sync.tone}`}
                  aria-hidden="true"
                />
              </button>
            );
          })}
        </div>
      )}

      {error && (
        <div className="inbox-load-error">
          <p className="chat-error" role="alert">
            {error}
          </p>
          <Button onClick={() => void load()}>Try again</Button>
        </div>
      )}

      <div className="posts-list" id="posts-results" role="tabpanel">
        {result === null
          ? !error && (
              <div className="chat-loading" role="status">
                Loading…
              </div>
            )
          : result.posts.map((post) =>
              hidden.has(post.id) ? (
                <div key={post.id} className="post-hidden" role="status">
                  <span>Hidden. Orca will treat this post as not posted.</span>
                  <Button
                    variant="ghost"
                    onClick={() => void setPostHidden(post, false)}
                  >
                    Undo
                  </Button>
                </div>
              ) : (
                <PostCard
                  key={post.id}
                  post={post}
                  onHide={() => void setPostHidden(post, true)}
                />
              ),
            )}
        {result && result.posts.length === 0 && (
          <div className="empty-state">
            <Newspaper size={30} aria-hidden="true" />
            <h3>{query ? "No posts match" : "No posts saved yet"}</h3>
            <p>
              {query
                ? "Try another word."
                : "Posts you publish from PostOrca, and the ones Orca reads on your profiles, show up here."}
            </p>
          </div>
        )}
        {result?.has_more && (
          <Button
            className="posts-more"
            disabled={loadingMore}
            onClick={() => void loadMore()}
          >
            {loadingMore ? "Loading…" : "Load more"}
          </Button>
        )}
      </div>
    </div>
  );
}

function PostCard({ post, onHide }: { post: Post; onHide: () => void }) {
  // Counts still at zero say nothing; the stats line shows the rest.
  const stats = Object.entries(post.stats).filter(([, value]) => value > 0);
  const checked = post.stats_checked_at !== null;
  const fromPostOrca = post.source !== "sync";
  const mediaOnly = post.media_type !== "none" && !post.media_description;
  return (
    <article className="post-card">
      <div className="proposal-top">
        <div className="proposal-meta">
          <Platform name={post.platform} />
          <strong>{post.account ?? post.platform}</strong>
          {kindLabel[post.kind] && (
            <>
              <span className="meta-dot">·</span>
              <span>{kindLabel[post.kind]}</span>
            </>
          )}
          {post.posted_at && (
            <>
              <span className="meta-dot">·</span>
              <time dateTime={post.posted_at}>{postedOn(post.posted_at)}</time>
            </>
          )}
        </div>
        <div className="post-actions">
          {post.url && (
            <a
              className="icon-button"
              href={post.url}
              target="_blank"
              rel="noreferrer"
              aria-label={`Open on ${post.platform}`}
              title={`Open on ${post.platform}`}
            >
              <ArrowUpRight size={15} />
            </a>
          )}
          <button
            type="button"
            className="icon-button"
            aria-label="Hide this post"
            title="Hide: it's no longer on your profile"
            onClick={onHide}
          >
            <EyeOff size={15} />
          </button>
        </div>
      </div>

      {post.reply_to_url && (
        <p className="post-context">
          Replying to{" "}
          <a href={post.reply_to_url} target="_blank" rel="noreferrer">
            {replyTarget(post.reply_to_url)}
          </a>
        </p>
      )}
      {post.title && <h3>{post.title}</h3>}
      {post.kind === "repost" ? (
        <p className="post-context">Reposted without a comment.</p>
      ) : post.text ? (
        <p className="post-text">
          {post.text}
          {post.text_truncated && (
            <span className="post-truncated">
              {" "}
              … the first {post.text.length.toLocaleString()} of{" "}
              {post.text_length?.toLocaleString()} characters
            </span>
          )}
        </p>
      ) : (
        post.media_type === "none" && <p className="post-context">No text.</p>
      )}

      {post.media_type !== "none" && post.media_description && (
        <div className="post-media">
          <Image size={14} aria-hidden="true" />
          <div>
            <span className="post-media-label">
              {mediaLabel[post.media_type]} · described by PostOrca
            </span>
            <p>{post.media_description}</p>
          </div>
        </div>
      )}

      {(checked || fromPostOrca || mediaOnly) && (
        <div className="post-bottom">
          <span className="post-stats">
            {mediaOnly && (
              <Pill>
                <Image size={11} aria-hidden="true" />
                {mediaLabel[post.media_type as keyof typeof mediaLabel]}
              </Pill>
            )}
            {checked && (
              <span>
                {stats.length
                  ? stats
                      .map(([key, value]) => statLabel(key, value))
                      .join(" · ")
                  : "No likes or replies yet"}
                <span className="post-checked">
                  {" "}
                  · checked {ago(post.stats_checked_at!)}
                </span>
              </span>
            )}
          </span>
          {fromPostOrca && (
            <Pill tone="green">
              <Sparkles size={11} aria-hidden="true" />
              {post.source === "agent"
                ? "Posted by Orca"
                : "From a PostOrca draft"}
            </Pill>
          )}
        </div>
      )}
    </article>
  );
}
