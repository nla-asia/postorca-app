import { Router } from "express";
import { z } from "zod";
import type { Database } from "../db.js";
import { getProfile, saveProfile } from "../repositories/brand.js";
import {
  addProject,
  deleteProject,
  updateProject,
} from "../repositories/projects.js";
import { profileSchema, projectSchema } from "../schemas/brand.js";
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
  // Project folders: where the founder builds, read by Orca's desktop file tools.
  router.post("/projects", async (req, res) =>
    res
      .status(201)
      .json(
        await addProject(db, res.locals.userId, projectSchema.parse(req.body)),
      ),
  );
  router.patch("/projects/:id", async (req, res) =>
    res.json(
      await updateProject(
        db,
        res.locals.userId,
        z.uuid().parse(req.params.id),
        projectSchema.omit({ path: true }).parse(req.body),
      ),
    ),
  );
  router.delete("/projects/:id", async (req, res) => {
    await deleteProject(db, res.locals.userId, z.uuid().parse(req.params.id));
    res.status(204).end();
  });
  return router;
}
