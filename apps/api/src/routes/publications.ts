import { Router } from "express";
import { z } from "zod";
import type { Database } from "../db.js";
import {
  cancelPost,
  getPublication,
  recordPostResult,
} from "../repositories/publications.js";

/** Scheduled posts: see one, cancel one before it is due, record how it ended. */
export function publicationRoutes(db: Database) {
  const router = Router();
  const id = z.uuid();

  router.get("/:id", async (req, res) =>
    res.json(
      await getPublication(
        db,
        res.locals.userId as string,
        id.parse(req.params.id),
      ),
    ),
  );

  router.patch("/:id", async (req, res) =>
    res.json(
      await recordPostResult(
        db,
        res.locals.userId as string,
        id.parse(req.params.id),
        z
          .discriminatedUnion("status", [
            z
              .object({
                status: z.literal("posted"),
                url: z.url({ protocol: /^https?$/ }).max(2048),
              })
              .strict(),
            z.object({ status: z.literal("skipped") }).strict(),
          ])
          .parse(req.body),
      ),
    ),
  );

  router.delete("/:id", async (req, res) => {
    await cancelPost(
      db,
      res.locals.userId as string,
      id.parse(req.params.id),
    );
    res.status(204).end();
  });

  return router;
}
