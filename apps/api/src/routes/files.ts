import { Router } from "express";
import { HttpError } from "../handlers/errors.js";
import { describeFile, filePath, isUserFileKey } from "../storage.js";

/** Mounted after normal user authentication; credentials never appear in URLs. */
export function fileRoutes() {
  const router = Router();
  router.get("/", async (req, res) => {
    const key = typeof req.query.key === "string" ? req.query.key : "";
    if (!isUserFileKey(res.locals.userId, key))
      throw new HttpError(404, "File not found.");
    let metadata;
    try {
      metadata = await describeFile(key);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        throw new HttpError(404, "File not found.");
      throw error;
    }
    res.set({
      "Content-Type": metadata.mime_type,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": `${key.endsWith(".bin") ? "attachment" : "inline"}; filename="download"; filename*=UTF-8''${encodeURIComponent(metadata.filename).replace(/['()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16)}`)}`,
    });
    // sendFile streams and supports HTTP Range for audio/video seeking.
    await new Promise<void>((resolve, reject) =>
      res.sendFile(filePath(key), (error) => {
        if (!error || req.aborted || res.destroyed) resolve();
        else if ((error as NodeJS.ErrnoException).code === "ENOENT")
          reject(new HttpError(404, "File not found."));
        else reject(error);
      }),
    );
  });
  return router;
}
