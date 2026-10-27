import express, { Router } from "express";
import { z } from "zod";
import { settleDesktopTool } from "../desktop/calls.js";
import { HttpError } from "../handlers/errors.js";
import {
  authenticate,
  authenticateDevice,
  issueDeviceToken,
} from "../middleware/auth.js";
import { saveFile, storedImageTypes } from "../storage.js";

const result = z.discriminatedUnion("ok", [
  z.object({ executionId: z.uuid(), ok: z.literal(true), result: z.unknown() }),
  z.object({
    executionId: z.uuid(),
    ok: z.literal(false),
    error: z.string().max(2000),
  }),
]);

/** HTTP side of the desktop connection. The WebSocket itself is desktop/connections.ts. */
export function desktopRoutes(secret: string) {
  const router = Router();
  // A signed-in desktop exchanges the user's token for a token bound to its device.
  router.post("/device-token", authenticate(secret), (req, res) => {
    const { deviceId } = z.object({ deviceId: z.uuid() }).parse(req.body);
    res.json({ token: issueDeviceToken(res.locals.userId, deviceId, secret) });
  });
  // Desktop tools upload screenshots here before returning their result, which then
  // carries only the returned file key.
  router.post(
    "/files",
    authenticateDevice(secret),
    express.raw({ type: Object.keys(storedImageTypes), limit: "5mb" }),
    async (req, res) => {
      // express.raw only parses the listed types, so a Buffer body is one of them.
      if (!Buffer.isBuffer(req.body) || !req.body.length)
        throw new HttpError(400, "Send a JPEG or PNG image.");
      res.status(201).json({
        file: await saveFile(
          res.locals.userId,
          "screenshots",
          req.body,
          req.is("image/png") ? "image/png" : "image/jpeg",
        ),
      });
    },
  );
  // The desktop posts each tool result here. Delivery may be retried; the tool never is.
  router.post("/tool-result", authenticateDevice(secret), (req, res) => {
    const { executionId, ...outcome } = result.parse(req.body);
    if (
      !settleDesktopTool(
        { userId: res.locals.userId, deviceId: res.locals.deviceId },
        executionId,
        outcome.ok
          ? { ok: true, result: outcome.result ?? null }
          : { ok: false, error: outcome.error },
      )
    )
      throw new HttpError(404, "Tool execution not found or timed out.");
    res.status(204).end();
  });
  return router;
}
