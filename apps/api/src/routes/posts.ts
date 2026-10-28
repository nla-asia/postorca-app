import { Router } from "express";
import { z } from "zod";
import type { Database } from "../db.js";
import { HttpError } from "../handlers/errors.js";
import {
  deletePost,
  listPosts,
  POST_KINDS,
  restorePost,
  socialAccounts,
} from "../repositories/social-posts.js";

/** What each tab of the Posts page shows. Plain reposts only under All. */
const KINDS_BY_VIEW = {
  posts: POST_KINDS.filter((kind) => kind !== "reply" && kind !== "repost"),
  replies: ["reply" as const],
  all: undefined,
};

/** The founder's own published posts: read them, hide one (soft delete), undo it. */
export function postRoutes(db: Database) {
  const router = Router();
  const id = z.uuid();

  router.get("/", async (req, res) => {
    const query = z
      .object({
        account: z.uuid().optional(),
        view: z.enum(["posts", "replies", "all"]).default("posts"),
        q: z.string().trim().max(200).optional(),
        before: z.iso.datetime({ offset: true }).optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50),
      })
      .parse(req.query);
    const userId = res.locals.userId as string;
    const accounts = await socialAccounts(db, userId);
    if (query.account && !accounts.some((a) => a.id === query.account))
      throw new HttpError(404, "Account not found.");
    // One extra row says whether there is another page.
    const rows = await listPosts(db, userId, {
      link_id: query.account,
      kinds: KINDS_BY_VIEW[query.view],
      query: query.q || undefined,
      until: query.before,
      limit: query.limit + 1,
    });
    res.json({
      accounts,
      posts: rows.slice(0, query.limit),
      has_more: rows.length > query.limit,
    });
  });

  router.delete("/:id", async (req, res) => {
    if (
      !(await deletePost(
        db,
        res.locals.userId as string,
        id.parse(req.params.id),
      ))
    )
      throw new HttpError(404, "Post not found.");
    res.status(204).end();
  });

  router.post("/:id/restore", async (req, res) => {
    if (
      !(await restorePost(
        db,
        res.locals.userId as string,
        id.parse(req.params.id),
      ))
    )
      throw new HttpError(404, "Post not found.");
    res.status(204).end();
  });

  return router;
}
