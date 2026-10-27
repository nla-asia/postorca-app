import express, { Router } from "express";
import { z } from "zod";
import { settleDesktopTool } from "../desktop/calls.js";
import { HttpError } from "../handlers/errors.js";
import {
  authenticate,
  authenticateDevice,
  issueDeviceToken,
} from "../middleware/auth.js";
import {
  DOWNLOAD_LIMIT,
  saveDownload,
  saveFile,
  storedImageTypes,
  type StoredImageType,
} from "../storage.js";
import { fileRoutes } from "./files.js";

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
  // Desktop tools stream files they fetched or the founder chose here, unchanged,
  // with their metadata in a header.
  router.post("/downloads", authenticateDevice(secret), async (req, res) => {
    let header: unknown;
    try {
      header = JSON.parse(
        decodeURIComponent(req.get("X-PostOrca-File") || "%7B%7D"),
      );
    } catch {
      throw new HttpError(400, "Invalid download metadata.");
    }
    const metadata = z
      .object({
        filename: z
          .string()
          .min(1)
          .max(120)
          .transform((value) => value.replace(/[\x00-\x1f<>:"/\\|?*]/g, "_")),
        source_url: z.url({ protocol: /^https?$/ }).max(8192).optional(),
        download_url: z.url({ protocol: /^https?$/ }).max(8192).optional(),
        final_url: z.url({ protocol: /^https?$/ }).max(8192).optional(),
        reported_type: z.string().max(200).optional(),
      })
      .strict()
      .parse(header);
    if (!req.is("application/octet-stream"))
      throw new HttpError(400, "Send a binary file stream.");
    if (Number(req.get("Content-Length")) > DOWNLOAD_LIMIT)
      throw new HttpError(413, "Download exceeds 200 MB.");
    res.status(201).json(await saveDownload(res.locals.userId, req, metadata));
  });
  // A signed-in desktop exchanges the user's token for a token bound to its device.
  router.post("/device-token", authenticate(secret), (req, res) => {
    const { deviceId } = z.object({ deviceId: z.uuid() }).parse(req.body);
    res.json({ token: issueDeviceToken(res.locals.userId, deviceId, secret) });
  });
  // Desktop tools upload screenshots and media they made here before returning their
  // result, which then carries only the returned file key.
  router.post(
    "/files",
    authenticateDevice(secret),
    express.raw({ type: Object.keys(storedImageTypes), limit: "5mb" }),
    express.raw({ type: "video/mp4", limit: "200mb" }),
    express.raw({ type: "audio/mpeg", limit: "50mb" }),
    async (req, res) => {
      // express.raw only parses the listed types, so a Buffer body is one of them.
      if (!Buffer.isBuffer(req.body) || !req.body.length)
        throw new HttpError(
          400,
          "Send a JPEG or PNG image, an MP3, or an MP4 video.",
        );
      for (const type of ["audio/mpeg", "video/mp4"] as const)
        if (req.is(type)) {
          res.status(201).json({
            file: await saveFile(res.locals.userId, "media", req.body, type),
          });
          return;
        }
      const type: StoredImageType = req.is("image/png")
        ? "image/png"
        : "image/jpeg";
      res.status(201).json({
        file: await saveFile(res.locals.userId, "screenshots", req.body, type),
      });
    },
  );
  // Desktop tools read the founder's saved files (e.g. media to edit) by key.
  router.use("/files", authenticateDevice(secret), fileRoutes());
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
