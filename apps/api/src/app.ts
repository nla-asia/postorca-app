import express from "express";
import cors from "cors";
import type { AgentRouter } from "./agent/router.js";
import type { Config } from "./config.js";
import { handleErrors } from "./handlers/errors.js";
import { ping, type Database } from "./db.js";
import { authRoutes } from "./routes/auth.js";
import { authenticate } from "./middleware/auth.js";
import { brandRoutes } from "./routes/brand.js";
import { routineRoutes } from "./routes/routines.js";
import { taskRoutes } from "./routes/tasks.js";

/** agent is null when no model provider is configured; turns then return 503. */
export function createApp(
  db: Database,
  config: Config,
  agent: AgentRouter | null = null,
) {
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
  app.use("/api/auth", authRoutes(db, config.jwtSecret));
  app.use(
    "/api/brand-profile",
    authenticate(config.jwtSecret),
    brandRoutes(db),
  );
  app.use("/api/routines", authenticate(config.jwtSecret), routineRoutes(db));
  app.use("/api/tasks", authenticate(config.jwtSecret), taskRoutes(db, agent));
  app.use((_req, res) => {
    res.status(404).json({ error: "Endpoint not found." });
  });
  app.use(handleErrors);
  return app;
}
