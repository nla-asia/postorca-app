import { z } from "zod";
import { HttpError } from "../handlers/errors.js";
import { platforms } from "../schemas/platforms.js";
import {
  deletePost,
  findAccount,
  listPosts,
  markAccountRead,
  MEDIA_TYPES,
  POST_KINDS,
  savePost,
  socialAccounts,
  taskAccountId,
  updatePost,
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
  "text is the founder's own words (their voice); postorca_media_description is PostOrca's description of an image or video, never their voice. posts_synced_at is when posts were last saved from each account's profile: if it is old or null, the latest posts may be missing, so check the profile in the browser before concluding they haven't posted.";

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
  const account = args.account
    ? findAccount(accounts, args.account)
    : undefined;
  const filter: PostFilter = {
    link_id: account?.id,
    platform: account?.platform ?? args.platform,
    kinds:
      args.kinds ??
      (args.include_reposts
        ? undefined
        : POST_KINDS.filter((k) => k !== "repost")),
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

const postFields = {
  kind: z.enum(POST_KINDS),
  post_id: z.string().min(1).max(200),
  url: z.url({ protocol: /^https?$/ }).max(2048),
  text: z.string().max(100_000),
  title: z.string().max(500),
  media_type: z.enum(MEDIA_TYPES),
  media_description: z.string().min(1).max(2000),
  reply_to_url: z.url({ protocol: /^https?$/ }).max(2048),
  posted_at: z.iso.datetime({
    offset: true,
    error:
      "posted_at must be an ISO 8601 date-time with its time zone, e.g. 2026-10-28T07:59:00+07:00. Convert the time the page shows; on X leave it out, it is read from the post's ID.",
  }),
  stats: z.record(z.string(), z.number().nonnegative()),
};

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
      parameters: object({ query: { type: "string" }, ...listProperties }, [
        "query",
      ]),
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
      name: "save_my_post",
      description:
        "Save one post you read on the founder's own profile, so routines can read it without the browser; call it once per post. Give kind, url (the post's own link; its ID is taken from it), text exactly as the founder wrote it (only their words; an Instagram caption or the article's opening), title for articles, posted_at (ISO 8601 with time zone, e.g. 2026-10-28T07:59:00+07:00, converted from the time the page shows; leave it out on X, where it is read exactly from the post's ID), reply_to_url for replies and quotes, media_type, and stats as numbers (likes, replies, reposts, views…). For a plain repost, only kind and url. media_description is your one- or two-line description of an image or video; give it only for a new post with no caption or alt text, since a saved description is kept. Saving a post already saved (same link) refreshes its text and stats. To change a saved post, pass its id (from list_my_posts) with only the fields that change; stats given there update those counts and keep the others.",
      parameters: object(
        {
          id: {
            type: "string",
            description:
              "A saved post's id, to update it instead of saving a new one.",
          },
          account: {
            ...accountParameter,
            description: `${accountParameter.description} Defaults to the account this routine runs for. Not used with id.`,
          },
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
        [],
      ),
    },
    run: async ({ db, userId, taskId }, args) => {
      const fields = z.object(postFields).partial();
      const request = z
        .object({
          id: z.uuid().optional(),
          account: z.string().min(1).max(2048).optional(),
          ...fields.shape,
        })
        .strict()
        .parse(args);
      const { id, account: reference, ...post } = request;
      if (id) {
        if (reference)
          throw new HttpError(
            400,
            "A saved post keeps its account; leave out account.",
          );
        const updated = await updatePost(db, userId, id, post);
        if (!updated) throw new HttpError(404, "No saved post with that id.");
        return { id, updated: true };
      }
      if (!post.kind)
        throw new HttpError(
          400,
          "Give the post's kind, or an id to update a saved post.",
        );
      if (!post.url && !post.post_id)
        throw new HttpError(400, "Give the post's url (or post_id).");
      const accounts = await socialAccounts(db, userId);
      const routineLink = await taskAccountId(db, taskId);
      const account = reference
        ? findAccount(accounts, reference)
        : accounts.find((a) => a.id === routineLink);
      if (!account)
        throw new HttpError(
          400,
          "Pass account: the profile URL of the account this post is from.",
        );
      const saved = await savePost(
        db,
        userId,
        { platform: account.platform, link_id: account.id },
        { ...post, kind: post.kind },
        "sync",
      );
      await markAccountRead(db, userId, account.id);
      return {
        id: saved.id,
        created: saved.created,
        account: account.name,
        platform: account.platform,
      };
    },
  },
  {
    definition: {
      name: "delete_my_post",
      description:
        "Mark one saved post as deleted, by its id (from list_my_posts), when it is no longer on the founder's profile. Routines then treat it as not posted; saving it again restores it.",
      parameters: object({ id: { type: "string" } }, ["id"]),
    },
    run: async ({ db, userId }, args) => {
      const { id } = z.object({ id: z.uuid() }).strict().parse(args);
      const deleted = await deletePost(db, userId, id);
      if (!deleted) throw new HttpError(404, "No saved post with that id.");
      return { ...deleted, deleted: true };
    },
  },
];
