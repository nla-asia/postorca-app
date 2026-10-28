import type { PlatformName } from "./schedules";
import type { BrandLink } from "./brand";
import type { TaskArtifact } from "./tasks";

/** A `reply` artifact's content (api/src/schemas/social.ts). */
export type Reply = {
  platform: PlatformName;
  kind: "reply" | "quote";
  intent: "conversation" | "connect";
  target: {
    url: string;
    author: string;
    handle?: string;
    text?: string;
    posted_at?: string;
    stats?: Record<string, number | string>;
  };
  text: string;
  why?: string;
};

export function parseReply(item: TaskArtifact): Reply | null {
  try {
    return JSON.parse(item.content) as Reply;
  } catch {
    return null;
  }
}

/** Each platform's limit for a reply or comment, in characters. */
export const REPLY_LIMIT: Record<PlatformName, number> = {
  X: 280,
  Threads: 500,
  Instagram: 2200,
  Facebook: 8000,
  LinkedIn: 1250,
};

const LINK_KIND: Record<PlatformName, BrandLink["kind"]> = {
  X: "x",
  Threads: "threads",
  Instagram: "instagram",
  Facebook: "facebook",
  LinkedIn: "linkedin",
};

/** The founder's own account on a platform, from their brand profile links. */
export function founderAccount(links: BrandLink[], platform: PlatformName) {
  const link = links.find((item) => item.kind === LINK_KIND[platform]);
  if (!link) return null;
  let handle: string | undefined;
  try {
    const path = new URL(link.url).pathname.split("/").filter(Boolean);
    const last = path[path.length - 1];
    if (last) handle = last.replace(/^@/, "");
  } catch {}
  return { name: link.name, handle };
}

const statusId = (url: string) => /\/status(?:es)?\/(\d+)/.exec(url)?.[1];

/** A link that opens the platform's composer with the reply filled in, where one exists. */
export function replyIntent(reply: Reply, text: string) {
  const id = reply.platform === "X" ? statusId(reply.target.url) : undefined;
  if (!id) return null;
  const encoded = encodeURIComponent(text);
  return reply.kind === "quote"
    ? `https://x.com/intent/post?text=${encoded}&url=${encodeURIComponent(reply.target.url)}`
    : `https://x.com/intent/post?in_reply_to=${id}&text=${encoded}`;
}

/** A link that follows the author in one click, where the platform has one. */
export function followIntent(reply: Reply) {
  if (reply.platform !== "X" || !reply.target.handle) return null;
  return `https://x.com/intent/follow?screen_name=${encodeURIComponent(reply.target.handle.replace(/^@/, ""))}`;
}

/** The author's profile, for platforms where following happens there. */
export function profileUrl(reply: Reply) {
  const handle = reply.target.handle?.replace(/^@/, "");
  if (!handle) return null;
  if (reply.platform === "X") return `https://x.com/${handle}`;
  if (reply.platform === "Threads") return `https://www.threads.net/@${handle}`;
  if (reply.platform === "Instagram") return `https://www.instagram.com/${handle}`;
  return null;
}

/** Compact counts as platforms show them: 1.2K, 3.4M. */
export function compact(value: number | string) {
  if (typeof value === "string") return value;
  if (value < 1000) return String(value);
  if (value < 1_000_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0).replace(/\.0$/, "")}K`;
  return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

/** "2h", "Oct 27": a relative time for ISO dates, otherwise as the agent saw it. */
export function postedLabel(value?: string) {
  if (!value) return "";
  const time = Date.parse(value);
  if (Number.isNaN(time) || !/^\d{4}-\d{2}-\d{2}/.test(value)) return value;
  const minutes = Math.round((Date.now() - time) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)}h`;
  return new Date(time).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
