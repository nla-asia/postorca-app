import express from "express";
import cors from "cors";
import type { Config } from "./config.js";
import { handleErrors } from "./handlers/errors.js";
import { ping, type Database } from "./db.js";

export function createApp(db: Database, config: Config) {
  const app = express();
  app.disable("x-powered-by");
  app.use(
    cors({
      origin(origin, callback) {
        // Packaged Electron windows use a file origin, serialized as "null".
        callback(
          null,
          !origin || origin === "null" || config.origins.includes(origin),
        );
      },
    }),
  );
  app.use(express.json({ limit: "256kb" }));

  app.get("/api/health", async (_req, res) => {
    await ping(db);
    res.json({ ok: true });
  });
  app.use((_req, res) => {
    res.status(404).json({ error: "Endpoint not found." });
  });
  app.use(handleErrors);
  return app;
}
