import { Router } from "express";
import { z } from "zod";
import type { Database } from "../db.js";
import { HttpError } from "../handlers/errors.js";
import {
  beginConnection,
  disconnectConnection,
  finishConnection,
  listConnections,
} from "../connectors/service.js";

const connector = z.enum(["gmail", "google_drive"]);

export function connectorRoutes(db: Database) {
  const router = Router();
  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  router.get("/", async (_req, res) => {
    res.json(await listConnections(db, res.locals.userId as string));
  });
  router.post("/:connector/connect", async (req, res) => {
    res.json(
      await beginConnection(
        db,
        res.locals.userId as string,
        connector.parse(req.params.connector),
      ),
    );
  });
  router.delete("/:connector", async (req, res) => {
    await disconnectConnection(
      db,
      res.locals.userId as string,
      connector.parse(req.params.connector),
    );
    res.status(204).end();
  });
  return router;
}

/** Public OAuth return endpoint; the one-use state binds it to the signed-in PostOrca user. */
export function connectorCallback(db: Database) {
  const router = Router();
  router.get("/", async (req, res) => {
    res.set({
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'",
    });
    let message: string;
    try {
      const query = z
        .object({
          state: z.string().min(20).max(200),
          code: z.string().max(4096).optional(),
          error: z.string().max(200).optional(),
        })
        .parse(req.query);
      message = (await finishConnection(
        db,
        query.state,
        query.code,
        !!query.error,
      ))
        ? "Connected. You can close this tab and return to PostOrca."
        : "Connection cancelled. Return to PostOrca to try again.";
    } catch (error) {
      res.status(400);
      message =
        error instanceof HttpError
          ? error.message
          : "Unable to connect. Return to PostOrca and try again.";
    }
    res
      .type("html")
      .send(
        `<!doctype html><html><head><meta name="viewport" content="width=device-width"><title>Connect Apps · PostOrca</title><style>body{font:18px system-ui;padding:64px;line-height:1.6;color-scheme:light dark}</style></head><body><h1>Connect Apps</h1><p>${message.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`)}</p></body></html>`,
      );
  });
  return router;
}
