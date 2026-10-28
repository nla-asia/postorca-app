import { z } from "zod";
import { HttpError } from "../handlers/errors.js";
import { platforms } from "../schemas/platforms.js";
import {
  findAccount,
  listPosts,
  markAccountSynced,
  markPostsDeleted,
  MEDIA_TYPES,
  POST_KINDS,
  socialAccounts,
  taskAccountId,
  upsertPosts,
  type Account,
  type PostFilter,
} from "../repositories/social-posts.js";
import { object, type Tool, type ToolContext } from "./shared.js";

const accountParameter = {
  type: "string",
  description:
    "The account: its profile URL as given in the routine (e.g. https://x.com/handle), its name, or its link id.",
};
const NOTE =
  "text is the founder's own words (their voice); postorca_media_description is PostOrca's description of an image or video, never their voice. posts_synced_at is when each account's posts were last read in full: if it is old or null, the latest posts may be missing, so check the profile in the browser before concluding they haven't posted.";

const listSchema = z
  .object({
    account: z.string().min(1).max(2048).optional(),
    platform: z.enum(platforms).optional(),
    kinds: z.array(z.enum(POST_KINDS)).min(1).optional(),
    include_reposts: z.boolean().default(false),
    include_deleted: z.boolean().default(false),
    since: z.iso.datetime({ offset: true }).optional(),
    until: z.iso.datetime({ offset: true }).optional(),
    limit: z.number().int().min(1).max(200).default(20),
  })
  .strict();

/** Runs a post query and labels it with the freshness of the accounts it covers. */
async function readPosts(
  { db, userId }: ToolContext,
  args: z.infer<typeof listSchema>,
  query?: string,
) {
  const accounts = await socialAccounts(db, userId);
  const account = args.account ? findAccount(accounts, args.account) : undefined;
  const filter: PostFilter = {
    link_id: account?.id,
    platform: account?.platform ?? args.platform,
    kinds:
      args.kinds ??
      (args.include_reposts ? undefined : POST_KINDS.filter((k) => k !== "repost")),
    since: args.since,
    until: args.until,
    include_deleted: args.include_deleted,
    query,
    limit: args.limit,
  };
  const rows = await listPosts(db, userId, filter);
  const covered = accounts.filter(
    (a: Account) =>
      (!account || a.id === account.id) &&
      (!filter.platform || a.platform === filter.platform),
  );
  const posts = rows.map(({ media_description, link_id: _link, ...post }) => ({
    ...post,
    postorca_media_description: media_description,
  }));
  return {
    accounts: covered.map(({ id: _id, ...a }) => a),
    posts,
    note: NOTE,
    ...(posts.length ? {} : { message: "No saved posts match." }),
  };
}

const postSchema = z
  .object({
    kind: z.enum(POST_KINDS),
    post_id: z.string().min(1).max(200).optional(),
    url: z.url({ protocol: /^https?$/ }).max(2048).optional(),
    text: z.string().max(100_000).optional(),
    title: z.string().max(500).optional(),
    media_type: z.enum(MEDIA_TYPES).optional(),
    media_description: z.string().max(2000).optional(),
    reply_to_url: z.url({ protocol: /^https?$/ }).max(2048).optional(),
    posted_at: z.iso.datetime({ offset: true }).optional(),
    stats: z.record(z.string(), z.number().nonnegative()).optional(),
  })
  .strict()
  .refine((post) => post.post_id || post.url, {
    message: "Each post needs its url (or post_id).",
  });

const listProperties = {
  account: accountParameter,
  platform: { type: "string", enum: [...platforms] },
  kinds: {
    type: "array",
    items: { type: "string", enum: [...POST_KINDS] },
    description: "Only these kinds. Default: every kind except plain reposts.",
  },
  include_reposts: { type: "boolean" },
  include_deleted: { type: "boolean" },
  since: { type: "string", description: "ISO date-time; posted at or after." },
  until: { type: "string", description: "ISO date-time; posted before." },
  limit: { type: "integer", minimum: 1, maximum: 200 },
};

export const socialPostTools: Tool[] = [
  {
    definition: {
      name: "list_my_posts",
      description:
        "Read the founder's own published posts saved in PostOrca (posts, replies, quotes, articles…), newest first, without opening their profile: text, PostOrca's media description (clearly labeled, never their voice), url, posted_at, kind, stats and when stats were checked, plus each account's last full sync. Filter by account or platform, kinds and dates. Use it to check whether they posted today or this week, and to read their recent posts and voice. Read-only.",
      parameters: object(listProperties, []),
    },
    run: (context, args) => readPosts(context, listSchema.parse(args)),
  },
  {
    definition: {
      name: "search_my_posts",
      description:
        "Search the founder's own saved posts for a word or phrase (case-insensitive, in text and article titles), e.g. to avoid repeating an idea they already posted. Same filters and result as list_my_posts. Read-only.",
      parameters: object({ query: { type: "string" }, ...listProperties }, ["query"]),
    },
    run: (context, args) => {
      const { query, ...rest } = z
        .object({ query: z.string().trim().min(1).max(200) })
        .passthrough()
        .parse(args);
      return readPosts(context, listSchema.parse(rest), query);
    },
  },
  {
    definition: {
      name: "save_my_posts",
      description:
        "Save posts you read on the founder's own profile (one account per call), so routines can read them without the browser. Pass every post you saw: kind, url (the post's own link; its ID is taken from it), text exactly as the founder wrote it (only their words; an Instagram caption or the article's opening), title for articles, posted_at, reply_to_url for replies and quotes, media_type, stats as numbers (likes, replies, reposts, views…). For a plain repost, only kind and url. media_description is your one- or two-line description of an image or video; give it only for a new post with no caption or alt text, since saved descriptions are kept. Saving again refreshes text and stats. When you read the account's posts back to its last sync, pass synced true; pass deleted_post_ids for saved posts you looked for and are gone.",
      parameters: object(
        {
          account: {
            ...accountParameter,
            description: `${accountParameter.description} Defaults to the account this routine runs for.`,
          },
          posts: {
            type: "array",
            maxItems: 100,
            items: object(
              {
                kind: { type: "string", enum: [...POST_KINDS] },
                post_id: { type: "string" },
                url: { type: "string" },
                text: { type: "string" },
                title: { type: "string" },
                media_type: { type: "string", enum: [...MEDIA_TYPES] },
                media_description: { type: "string" },
                reply_to_url: { type: "string" },
                posted_at: { type: "string" },
                stats: { type: "object", additionalProperties: { type: "number" } },
              },
              ["kind"],
            ),
          },
          synced: { type: "boolean" },
          deleted_post_ids: { type: "array", items: { type: "string" } },
        },
        ["posts"],
      ),
    },
    run: async ({ db, userId, taskId }, args) => {
      const request = z
        .object({
          account: z.string().min(1).max(2048).optional(),
          posts: z.array(postSchema).max(100),
          synced: z.boolean().default(false),
          deleted_post_ids: z.array(z.string().min(1).max(200)).max(200).default([]),
        })
        .strict()
        .parse(args);
      const accounts = await socialAccounts(db, userId);
      const routineLink = await taskAccountId(db, taskId);
      const account = request.account
        ? findAccount(accounts, request.account)
        : accounts.find((a) => a.id === routineLink);
      if (!account)
        throw new HttpError(
          400,
          "Pass account: the profile URL of the account these posts are from.",
        );
      const saved = await upsertPosts(
        db,
        userId,
        { platform: account.platform, link_id: account.id },
        request.posts,
        "sync",
      );
      const deleted = await markPostsDeleted(
        db,
        userId,
        account.platform,
        request.deleted_post_ids,
      );
      if (request.synced) await markAccountSynced(db, userId, account.id);
      return {
        account: account.name,
        platform: account.platform,
        saved,
        deleted,
        ...(request.synced ? { posts_synced_at: new Date().toISOString() } : {}),
      };
    },
  },
];
