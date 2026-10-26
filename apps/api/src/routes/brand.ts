import { Router } from "express";
import type { Database } from "../db.js";
import { getProfile, saveProfile } from "../repositories/brand.js";
import { profileSchema } from "../schemas/brand.js";
export function brandRoutes(db: Database) {
  const router = Router();
  router.get("/", async (_req, res) =>
    res.json(await getProfile(db, res.locals.userId)),
  );
  router.put("/", async (req, res) =>
    res.json(
      (
        await saveProfile(
          db,
          res.locals.userId,
          profileSchema.parse({
            ...(await getProfile(db, res.locals.userId)),
            ...profileSchema.partial().strict().parse(req.body),
          }),
        )
      ).profile,
    ),
  );
  return router;
}
