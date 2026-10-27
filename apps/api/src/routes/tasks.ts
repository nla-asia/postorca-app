import { Router } from "express";
import { z } from "zod";
import type { Database } from "../db.js";
import {
  ownedTask,
  createTask,
  listTasks,
  reviewTask,
  taskDetail,
  startOnboarding,
  createTurn,
  TASK_KINDS,
} from "../repositories/tasks.js";
import { updateDocumentArtifact } from "../repositories/artifacts.js";
import { queueIdeaContent } from "../repositories/routines.js";
import { HttpError } from "../handlers/errors.js";
import type { AgentRouter } from "../agent/router.js";
const id = z.uuid();
export function taskRoutes(db: Database, agent: AgentRouter | null) {
  const router = Router();
  router.post("/", async (req, res) => {
    const data = z
      .object({
        kind: z.enum(TASK_KINDS),
        title: z.string().trim().min(1).max(200),
      })
      .parse(req.body);
    const task = await createTask(db, res.locals.userId, data.kind, data.title);
    if (data.kind === "onboarding")
      await startOnboarding(db, res.locals.userId, task.id);
    res.status(201).json(task);
  });
  router.get("/", async (req, res) => {
    const kind = z.enum(TASK_KINDS).optional().parse(req.query.kind);
    res.json(await listTasks(db, res.locals.userId, kind));
  });
  router.get("/:id", async (req, res) => {
    const taskId = id.parse(req.params.id);
    res.json(await taskDetail(db, res.locals.userId, taskId));
  });
  router.post("/:id/turns", async (req, res) => {
    const taskId = id.parse(req.params.id);
    const { message } = z
      .object({ message: z.string().trim().min(1).max(30000) })
      .parse(req.body);
    await ownedTask(db, res.locals.userId, taskId);
    if (!agent)
      throw new HttpError(503, "Orca’s model provider is not configured.");
    const turn = await createTurn(db, res.locals.userId, taskId, message);
    agent.dispatch(taskId, turn.id, res.locals.userId);
    res.status(202).json(turn);
  });
  router.patch("/:id", async (req, res) => {
    const taskId = id.parse(req.params.id);
    const data = z
      .object({ action: z.enum(["approve", "archive"]) })
      .parse(req.body);
    const task = await reviewTask(db, res.locals.userId, taskId, data.action);
    res.json(task);
  });
  router.patch("/:id/artifacts/:artifactId", async (req, res) => {
    const taskId = id.parse(req.params.id);
    await ownedTask(db, res.locals.userId, taskId);
    const { content } = z
      .object({ content: z.string().trim().min(1).max(100000) })
      .parse(req.body);
    const artifact = await updateDocumentArtifact(
      db,
      taskId,
      id.parse(req.params.artifactId),
      content,
    );
    if (!artifact) throw new HttpError(404, "Editable artifact not found.");
    res.json(artifact);
  });
  // Turn an idea into content work: queued as a one-time schedule the scheduler runs.
  router.post("/:id/artifacts/:artifactId/content", async (req, res) => {
    const { note } = z
      .object({ note: z.string().trim().max(2000).optional() })
      .parse(req.body ?? {});
    res
      .status(201)
      .json(
        await queueIdeaContent(
          db,
          res.locals.userId,
          id.parse(req.params.id),
          id.parse(req.params.artifactId),
          note || undefined,
        ),
      );
  });
  return router;
}
