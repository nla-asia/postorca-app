import type { Queryable } from "../db.js";
import { HttpError } from "../handlers/errors.js";
import type { platforms } from "../schemas/platforms.js";
import { PLATFORM_BY_KIND, type LinkKind } from "../seeds/default-routines.js";

export type Platform = (typeof platforms)[number];
export const POST_KINDS = [
  "post",
  "reply",
  "quote",
  "repost",
  "article",
  "reel",
  "story",
  "carousel",
] as const;
export type PostKind = (typeof POST_KINDS)[number];
export const MEDIA_TYPES = [
  "none",
  "image",
  "video",
  "carousel",
  "link",
] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];

/** The kinds each platform has; the table's CHECK allows the same pairs. */
export const KINDS_BY_PLATFORM: Record<Platform, readonly PostKind[]> = {
  X: ["post", "reply", "quote", "repost", "article"],
  Threads: ["post", "reply", "quote", "repost"],
  Instagram: ["post", "reel", "story", "carousel"],
  Facebook: ["post", "reel", "story"],
  LinkedIn: ["post", "reply", "article"],
};

/** Stored text is capped; text_length keeps the full length. */
export const POST_TEXT_LIMIT = 1024;

export type PostInput = {
  kind: PostKind;
  post_id?: string | null;
  url?: string | null;
  text?: string | null;
  title?: string | null;
  media_type?: MediaType;
  media_description?: string | null;
  reply_to_url?: string | null;
  posted_at?: string | null;
  stats?: Record<string, number>;
  artifact_id?: string | null;
};

export type Account = {
  id: string;
  name: string;
  url: string;
  platform: Platform;
  posts_synced_at: string | null;
};

const iso = (column: string) =>
  `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

/**
 * The platform's own ID in a post's link, or null when the link has none we know.
 * X and LinkedIn use numeric IDs; Threads and Instagram use shortcodes.
 */
export function postIdFromUrl(platform: string, url: string) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const path = decodeURIComponent(parsed.pathname);
  const match = (pattern: RegExp) => path.match(pattern)?.[1] ?? null;
  switch (platform) {
    case "X":
      return match(/\/status(?:es)?\/(\d+)/);
    case "Threads":
      return match(/\/post\/([\w-]+)/);
    case "Instagram":
      return (
        match(/\/(?:p|reels?|tv)\/([\w-]+)/) ?? match(/\/stories\/[^/]+\/(\d+)/)
      );
    case "LinkedIn":
      // A comment's link names its post too; the comment's own ID comes first.
      return (
        decodeURIComponent(parsed.search).match(
          /urn:li:comment:\([^,]+,(\d+)\)/,
        )?.[1] ??
        match(/urn:li:comment:\([^,]+,(\d+)\)/) ??
        match(/urn:li:(?:activity|share|ugcPost):(\d+)/) ??
        match(/-activity-(\d+)/)
      );
    case "Facebook":
      return (
        parsed.searchParams.get("story_fbid") ??
        parsed.searchParams.get("fbid") ??
        match(/\/(?:posts|videos|reel|stories\/\d+)\/([\w.-]+)/)
      );
    default:
      return null;
  }
}

/**
 * When a post was published, read from its ID where the platform encodes it: X and
 * LinkedIn IDs carry the creation time in milliseconds in bits 22 and up (X counts
 * from its own epoch, LinkedIn from 1970). Null elsewhere.
 */
const ID_EPOCH: Record<string, bigint> = { X: 1288834974657n, LinkedIn: 0n };
export function postedAtFromId(platform: string, postId: string | null) {
  const epoch = ID_EPOCH[platform];
  if (epoch === undefined || !postId || !/^\d{15,20}$/.test(postId))
    return null;
  return new Date(Number((BigInt(postId) >> 22n) + epoch)).toISOString();
}

/** The text as stored: capped, with whether it was cut and its full length. */
export function capText(text: string | null | undefined) {
  if (text == null)
    return { text: null, text_truncated: false, text_length: null };
  const length = [...text].length;
  return {
    text:
      length > POST_TEXT_LIMIT
        ? [...text].slice(0, POST_TEXT_LIMIT).join("")
        : text,
    text_truncated: length > POST_TEXT_LIMIT,
    text_length: length,
  };
}

function checkKind(platform: Platform, kind: PostKind) {
  if (!KINDS_BY_PLATFORM[platform].includes(kind))
    throw new HttpError(
      400,
      `${platform} has no ${kind} posts; use one of ${KINDS_BY_PLATFORM[platform].join(", ")}.`,
    );
}

/** The founder's social accounts (links of a social kind), with when each was last synced. */
export async function socialAccounts(db: Queryable, userId: string) {
  const { rows } = await db.query<
    Omit<Account, "platform"> & { kind: LinkKind }
  >(
    `SELECT id, name, url, kind, ${iso("posts_synced_at")} AS posts_synced_at
     FROM brand_profile_links WHERE user_id = $1 AND kind = ANY($2) ORDER BY name, id`,
    [userId, Object.keys(PLATFORM_BY_KIND)],
  );
  return rows.map(({ kind, ...link }) => ({
    ...link,
    platform: PLATFORM_BY_KIND[kind] as Platform,
  }));
}

const normalizeUrl = (url: string) =>
  url
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(www\.)?/, "")
    .replace(/\/+$/, "");

/**
 * The account a reference names: its link id, profile URL or name (case-insensitive).
 * Throws when none or several match.
 */
export function findAccount(accounts: Account[], reference: string) {
  const wanted = reference.trim().toLowerCase();
  const matches = accounts.filter(
    (account) =>
      account.id === reference ||
      normalizeUrl(account.url) === normalizeUrl(reference) ||
      account.name.toLowerCase() === wanted,
  );
  if (matches.length === 1) return matches[0];
  const known = accounts
    .map((a) => `${a.name} (${a.platform}, ${a.url})`)
    .join("; ");
  throw new HttpError(
    400,
    matches.length
      ? `More than one account matches "${reference}"; pass its URL: ${known}.`
      : `No social account matches "${reference}". The founder's accounts: ${known || "none"}.`,
  );
}

/** The account a work task runs for: the link of the routine that started it, if any. */
export async function taskAccountId(db: Queryable, taskId: string) {
  const {
    rows: [row],
  } = await db.query<{ link_id: string }>(
    `SELECT r.link_id FROM routine_runs rr JOIN routines r ON r.id = rr.routine_id
     WHERE rr.task_id = $1 AND r.link_id IS NOT NULL LIMIT 1`,
    [taskId],
  );
  return row?.link_id ?? null;
}

/**
 * Inserts or refreshes one of the account's posts, keyed by (founder, platform, post
 * ID): a refresh overwrites text, kind and stats, keeps a media description already
 * written (posts are described once), and clears deleted_at. A post without an ID
 * (its link has none) is inserted as it is. Returns its id and whether it is new.
 */
export async function savePost(
  db: Queryable,
  userId: string,
  target: { platform: Platform; link_id: string | null },
  post: PostInput,
  source: "sync" | "founder" | "agent",
) {
  checkKind(target.platform, post.kind);
  const postId =
    post.post_id?.trim() ||
    (post.url ? postIdFromUrl(target.platform, post.url) : null);
  // A plain repost's link is the original post, whose time isn't the repost's.
  const exactTime =
    post.kind === "repost" ? null : postedAtFromId(target.platform, postId);
  const text = capText(post.text);
  const stats =
    post.stats && Object.keys(post.stats).length ? post.stats : null;
  const {
    rows: [saved],
  } = await db.query<{ id: string; created: boolean }>(
    `INSERT INTO social_posts(user_id, link_id, platform, kind, post_id, url, text,
       text_truncated, text_length, title, media_type, media_description, reply_to_url,
       posted_at, stats, stats_checked_at, source, artifact_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
       coalesce($15::jsonb, '{}'::jsonb), CASE WHEN $15::jsonb IS NOT NULL THEN now() END, $16, $17)
     ON CONFLICT (user_id, platform, post_id) WHERE post_id IS NOT NULL DO UPDATE SET
       link_id = coalesce(EXCLUDED.link_id, social_posts.link_id),
       kind = EXCLUDED.kind,
       url = coalesce(EXCLUDED.url, social_posts.url),
       text = coalesce(EXCLUDED.text, social_posts.text),
       text_truncated = CASE WHEN EXCLUDED.text IS NULL THEN social_posts.text_truncated ELSE EXCLUDED.text_truncated END,
       text_length = coalesce(EXCLUDED.text_length, social_posts.text_length),
       title = coalesce(EXCLUDED.title, social_posts.title),
       media_type = CASE WHEN EXCLUDED.media_type = 'none' THEN social_posts.media_type ELSE EXCLUDED.media_type END,
       media_description = coalesce(social_posts.media_description, EXCLUDED.media_description),
       reply_to_url = coalesce(EXCLUDED.reply_to_url, social_posts.reply_to_url),
       posted_at = CASE WHEN $18::boolean THEN EXCLUDED.posted_at
         ELSE coalesce(social_posts.posted_at, EXCLUDED.posted_at) END,
       stats = CASE WHEN $15::jsonb IS NOT NULL THEN EXCLUDED.stats ELSE social_posts.stats END,
       stats_checked_at = CASE WHEN $15::jsonb IS NOT NULL THEN now() ELSE social_posts.stats_checked_at END,
       -- Who published it outranks the sync that later saw it.
       source = CASE WHEN social_posts.source = 'sync' THEN EXCLUDED.source ELSE social_posts.source END,
       artifact_id = coalesce(social_posts.artifact_id, EXCLUDED.artifact_id),
       deleted_at = NULL,
       updated_at = now()
     RETURNING id, (xmax = 0) AS created`,
    [
      userId,
      target.link_id,
      target.platform,
      post.kind,
      postId,
      post.url ?? null,
      text.text,
      text.text_truncated,
      text.text_length,
      post.title ?? null,
      post.media_type ?? "none",
      post.media_description ?? null,
      post.reply_to_url ?? null,
      exactTime ?? post.posted_at ?? null,
      stats ? JSON.stringify(stats) : null,
      source,
      post.artifact_id ?? null,
      exactTime !== null,
    ],
  );
  return saved;
}

/**
 * Updates one saved post by its id: only the fields given change (a new text is
 * capped again; stats given are merged into the saved ones and stamped). Returns null when the founder has no such post.
 */
export async function updatePost(
  db: Queryable,
  userId: string,
  id: string,
  changes: Partial<PostInput>,
) {
  const {
    rows: [existing],
  } = await db.query<{ platform: Platform }>(
    "SELECT platform FROM social_posts WHERE id = $1 AND user_id = $2",
    [id, userId],
  );
  if (!existing) return null;
  if (changes.kind) checkKind(existing.platform, changes.kind);
  const postId =
    changes.post_id?.trim() ||
    (changes.url ? postIdFromUrl(existing.platform, changes.url) : null);
  const text = changes.text === undefined ? null : capText(changes.text);
  const stats =
    changes.stats && Object.keys(changes.stats).length ? changes.stats : null;
  const {
    rows: [updated],
  } = await db.query<{ id: string }>(
    `UPDATE social_posts SET
       kind = coalesce($3, kind),
       post_id = coalesce($4, post_id),
       url = coalesce($5, url),
       text = CASE WHEN $6::boolean THEN $7 ELSE text END,
       text_truncated = CASE WHEN $6::boolean THEN $8 ELSE text_truncated END,
       text_length = CASE WHEN $6::boolean THEN $9 ELSE text_length END,
       title = coalesce($10, title),
       media_type = coalesce($11, media_type),
       media_description = coalesce($12, media_description),
       reply_to_url = coalesce($13, reply_to_url),
       posted_at = coalesce($14, posted_at),
       -- The counts given replace those keys; the others stay.
       stats = stats || coalesce($15::jsonb, '{}'::jsonb),
       stats_checked_at = CASE WHEN $15::jsonb IS NOT NULL THEN now() ELSE stats_checked_at END,
       updated_at = now()
     WHERE id = $1 AND user_id = $2 RETURNING id`,
    [
      id,
      userId,
      changes.kind ?? null,
      postId,
      changes.url ?? null,
      text !== null,
      text?.text ?? null,
      text?.text_truncated ?? false,
      text?.text_length ?? null,
      changes.title ?? null,
      changes.media_type ?? null,
      changes.media_description ?? null,
      changes.reply_to_url ?? null,
      changes.posted_at ?? null,
      stats ? JSON.stringify(stats) : null,
    ],
  );
  return updated ?? null;
}

/**
 * Marks a post no longer found on the account as deleted (never a hard delete), so
 * routines treat it as not posted. Returns null when the founder has no such post.
 */
export async function deletePost(db: Queryable, userId: string, id: string) {
  const {
    rows: [deleted],
  } = await db.query<{ id: string; url: string | null }>(
    `UPDATE social_posts SET deleted_at = coalesce(deleted_at, now()), updated_at = now()
     WHERE id = $1 AND user_id = $2 RETURNING id, url`,
    [id, userId],
  );
  return deleted ?? null;
}

/** Undoes deletePost. Returns null when the founder has no such post. */
export async function restorePost(db: Queryable, userId: string, id: string) {
  const {
    rows: [restored],
  } = await db.query<{ id: string }>(
    `UPDATE social_posts SET deleted_at = NULL, updated_at = now()
     WHERE id = $1 AND user_id = $2 RETURNING id`,
    [id, userId],
  );
  return restored ?? null;
}

/** Records that the account's posts were just read from its profile. */
export async function markAccountRead(
  db: Queryable,
  userId: string,
  linkId: string,
) {
  await db.query(
    "UPDATE brand_profile_links SET posts_synced_at = now() WHERE id = $1 AND user_id = $2",
    [linkId, userId],
  );
}

export type PostFilter = {
  link_id?: string;
  platform?: Platform;
  kinds?: PostKind[];
  since?: string;
  until?: string;
  include_deleted?: boolean;
  /** Matched case-insensitively against text and title. */
  query?: string;
  limit: number;
};

/** The founder's posts, newest first; deleted ones only when asked. */
export async function listPosts(
  db: Queryable,
  userId: string,
  filter: PostFilter,
) {
  const conditions = ["p.user_id = $1"];
  const values: unknown[] = [userId];
  const add = (condition: string, value: unknown) => {
    values.push(value);
    conditions.push(condition.replaceAll("?", `$${values.length}`));
  };
  if (filter.link_id) add("p.link_id = ?", filter.link_id);
  if (filter.platform) add("p.platform = ?", filter.platform);
  if (filter.kinds?.length) add("p.kind = ANY(?)", filter.kinds);
  if (filter.since) add("p.posted_at >= ?", filter.since);
  if (filter.until) add("p.posted_at < ?", filter.until);
  if (!filter.include_deleted) conditions.push("p.deleted_at IS NULL");
  if (filter.query)
    add(
      "(p.text ILIKE ? ESCAPE '\\' OR p.title ILIKE ? ESCAPE '\\')",
      `%${filter.query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`,
    );
  values.push(filter.limit);
  const { rows } = await db.query(
    `SELECT p.id, p.link_id, l.name AS account, p.platform, p.kind, p.post_id, p.url,
       p.text, p.text_truncated, p.text_length, p.title, p.media_type, p.media_description,
       p.reply_to_url, ${iso("p.posted_at")} AS posted_at, p.stats,
       ${iso("p.stats_checked_at")} AS stats_checked_at, p.source, p.artifact_id,
       ${iso("p.deleted_at")} AS deleted_at
     FROM social_posts p LEFT JOIN brand_profile_links l ON l.id = p.link_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY p.posted_at DESC NULLS LAST, p.created_at DESC, p.id
     LIMIT $${values.length}`,
    values,
  );
  return rows;
}

/**
 * Saves a post the founder or Orca just published from a PostOrca draft (inside
 * recordPostResult's transaction). The account is the one the draft's routine ran
 * for, else the founder's only account on that platform, else the one whose
 * profile the post's link is under. An image or video made with the draft is noted
 * as media, described by PostOrca.
 */
export async function savePublishedPost(
  db: Queryable,
  userId: string,
  publication: {
    artifact_id: string;
    platform: string | null;
    publisher: "founder" | "agent";
    text: string;
    posted_url: string;
    source_task_id: string;
  },
) {
  const platform = publication.platform as Platform | null;
  if (!platform || !(platform in KINDS_BY_PLATFORM)) return;
  const accounts = (await socialAccounts(db, userId)).filter(
    (account) => account.platform === platform,
  );
  const routineLink = await taskAccountId(db, publication.source_task_id);
  const postPath = normalizeUrl(publication.posted_url);
  const link =
    accounts.find((account) => account.id === routineLink) ??
    (accounts.length === 1
      ? accounts[0]
      : accounts.find((account) =>
          postPath.startsWith(`${normalizeUrl(account.url)}/`),
        ));
  const { rows: media } = await db.query<{
    kind: "image" | "video";
    title: string;
  }>(
    `SELECT kind, title FROM artifacts WHERE task_id = $1 AND kind IN ('image', 'video')
     ORDER BY created_at, id`,
    [publication.source_task_id],
  );
  const mediaType: MediaType =
    media.length > 1 ? "carousel" : (media[0]?.kind ?? "none");
  await savePost(
    db,
    userId,
    { platform, link_id: link?.id ?? null },
    {
      kind:
        mediaType === "carousel" && platform === "Instagram"
          ? "carousel"
          : "post",
      url: publication.posted_url,
      text: publication.text,
      media_type: mediaType,
      media_description: media.length
        ? `Made in PostOrca with this post: ${media.map((m) => `${m.kind} "${m.title}"`).join(", ")}.`
        : null,
      posted_at: new Date().toISOString(),
      artifact_id: publication.artifact_id,
    },
    publication.publisher,
  );
}
