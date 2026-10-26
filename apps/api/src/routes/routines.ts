import { Router } from "express";
import { z } from "zod";
import type { Database } from "../db.js";
import { HttpError } from "../handlers/errors.js";
import {
  assertValidTimezone,
  createRoutine,
  deleteRoutine,
  getRoutine,
  listRoutines,
  updateRoutine,
} from "../repositories/routines.js";
import { platforms } from "../schemas/platforms.js";

const id = z.uuid();
const fields = z.object({
  platform: z.enum(platforms),
  title: z.string().trim().min(1).max(120),
  instructions: z.string().trim().min(1).max(4000),
  time: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a 24-hour HH:MM time."),
  days: z
    .array(z.number().int().min(1).max(7))
    .min(1, "Choose at least one day.")
    .max(7)
    .transform((days) => [...new Set(days)].sort()),
  timezone: z.string().trim().min(1).max(64),
  active: z.boolean(),
});
const runAt = z.iso
  .datetime({ offset: true })
  .refine(
    (value) => new Date(value).getTime() > Date.now(),
    "Choose a future date and time.",
  );
const onceFields = fields
  .pick({ title: true, instructions: true, timezone: true })
  .extend({
    platform: z.enum(platforms).nullable().optional(),
    run_at: runAt,
  })
  .strict();
export function routineRoutes(db: Database) {
  const router = Router();
  router.get("/", async (req, res) => {
    const query = z
      .object({ once: z.enum(["true", "false"]).optional() })
      .parse(req.query);
    res.json(await listRoutines(db, res.locals.userId, query.once === "true"));
  });
  router.post("/", async (req, res) => {
    const data = z
      .union([
        onceFields,
        fields.extend({ active: z.boolean().default(true) }).strict(),
      ])
      .parse(req.body);
    await assertValidTimezone(db, data.timezone);
    const routineId = await createRoutine(db, res.locals.userId, data);
    res.status(201).json(await getRoutine(db, res.locals.userId, routineId));
  });
  router.patch("/:id", async (req, res) => {
    const routineId = id.parse(req.params.id);
    const changes = fields
      .extend({ run_at: runAt, platform: z.enum(platforms).nullable() })
      .partial()
      .strict()
      .parse(req.body);
    if (changes.timezone) await assertValidTimezone(db, changes.timezone);
    await updateRoutine(db, res.locals.userId, routineId, changes);
    res.json(await getRoutine(db, res.locals.userId, routineId));
  });
  router.delete("/:id", async (req, res) => {
    await deleteRoutine(db, res.locals.userId, id.parse(req.params.id));
    res.status(204).end();
  });
  // Execution is unavailable until the model provider and worker are connected.
  router.post("/:id/run", async (req, _res) => {
    id.parse(req.params.id);
    throw new HttpError(503, "Orca’s model provider is not configured.");
  });
  return router;
}
