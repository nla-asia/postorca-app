import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const handleErrors: ErrorRequestHandler = (error, _req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }
  if (error instanceof ZodError) {
    res
      .status(400)
      .json({ error: error.issues[0]?.message ?? "Invalid request." });
    return;
  }
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  if (error?.type === "entity.parse.failed") {
    res.status(400).json({ error: "Invalid JSON request body." });
    return;
  }
  if (error?.type === "entity.too.large") {
    res.status(413).json({ error: "Request body is too large." });
    return;
  }
  console.error(
    "Request failed:",
    error instanceof Error ? error.name : "UnknownError",
  );
  res
    .status(500)
    .json({ error: "The server could not complete your request." });
};
