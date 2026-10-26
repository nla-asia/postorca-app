import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { z } from "zod";
import { createApp } from "../src/app.js";
import { configFromEnv } from "../src/config.js";
import { handleErrors, HttpError } from "../src/handlers/errors.js";
import { createDatabase } from "../src/db.js";
import { temporaryPostgres } from "./postgres.js";
const secret = "test-only-secret-at-least-32-characters";

let server: Server;
let baseUrl: string;
let fixture: Awaited<ReturnType<typeof temporaryPostgres>>;
before(async () => {
  fixture = await temporaryPostgres();
  server = createApp(
    fixture.db,
    configFromEnv({ DATABASE_URL: fixture.url, JWT_SECRET: secret }),
  ).listen(0, "127.0.0.1");
  await once(server, "listening");
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(async () => {
  if (server)
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  await fixture?.close();
});

test("health checks PostgreSQL without exposing Express", async () => {
  const response = await fetch(`${baseUrl}/api/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(response.headers.get("x-powered-by"), null);
});

test("health does not report success when the database cannot be queried", async (context) => {
  const db = createDatabase(fixture.url);
  await db.end();
  const offlineServer = createApp(
    db,
    configFromEnv({ DATABASE_URL: fixture.url, JWT_SECRET: secret }),
  ).listen(0, "127.0.0.1");
  await once(offlineServer, "listening");
  context.after(
    () =>
      new Promise<void>((resolve, reject) =>
        offlineServer.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  context.mock.method(console, "error", () => {});
  const response = await fetch(
    `http://127.0.0.1:${(offlineServer.address() as AddressInfo).port}/api/health`,
  );
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    error: "The server could not complete your request.",
  });
});

test("unknown endpoints return a JSON 404", async () => {
  const response = await fetch(`${baseUrl}/api/missing`);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "Endpoint not found." });
});

test("malformed and oversized JSON have distinct client errors", async () => {
  const malformed = await fetch(`${baseUrl}/api/missing`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{",
  });
  assert.equal(malformed.status, 400);
  assert.deepEqual(await malformed.json(), {
    error: "Invalid JSON request body.",
  });
  const oversized = await fetch(`${baseUrl}/api/missing`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: "a".repeat(256 * 1024) }),
  });
  assert.equal(oversized.status, 413);
  assert.deepEqual(await oversized.json(), {
    error: "Request body is too large.",
  });
});

test("CORS permits configured and Electron origins and omits unlisted origins", async () => {
  for (const origin of [
    "http://127.0.0.1:5173",
    "http://localhost:5173",
    "null",
  ]) {
    const response = await fetch(`${baseUrl}/api/health`, {
      headers: { Origin: origin },
    });
    assert.equal(response.headers.get("access-control-allow-origin"), origin);
    await response.arrayBuffer();
  }
  const blocked = await fetch(`${baseUrl}/api/health`, {
    headers: { Origin: "https://unlisted.example" },
  });
  assert.equal(blocked.headers.get("access-control-allow-origin"), null);
  await blocked.arrayBuffer();
  const preflight = await fetch(`${baseUrl}/api/health`, {
    method: "OPTIONS",
    headers: {
      Origin: "http://localhost:5173",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "Content-Type",
    },
  });
  assert.equal(preflight.status, 204);
  assert.equal(
    preflight.headers.get("access-control-allow-origin"),
    "http://localhost:5173",
  );
});

test("shared errors preserve safe messages and hide unexpected internals", async (context) => {
  const app = express();
  app.get("/known", () => {
    throw new HttpError(409, "This action conflicts with current work.");
  });
  app.get("/invalid", () => {
    z.object({ name: z.string() }).parse({});
  });
  app.get("/unexpected", () => {
    throw new Error("private implementation details");
  });
  app.use(handleErrors);
  const errorServer = app.listen(0, "127.0.0.1");
  await once(errorServer, "listening");
  context.after(
    () =>
      new Promise<void>((resolve, reject) =>
        errorServer.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  context.mock.method(console, "error", () => {});
  const url = `http://127.0.0.1:${(errorServer.address() as AddressInfo).port}`;
  const known = await fetch(`${url}/known`);
  assert.equal(known.status, 409);
  assert.deepEqual(await known.json(), {
    error: "This action conflicts with current work.",
  });
  const invalid = await fetch(`${url}/invalid`);
  assert.equal(invalid.status, 400);
  const invalidBody = await invalid.json();
  assert.ok(
    invalidBody && typeof invalidBody === "object" && "error" in invalidBody,
  );
  assert.equal(typeof invalidBody.error, "string");
  const unexpected = await fetch(`${url}/unexpected`);
  assert.equal(unexpected.status, 500);
  assert.deepEqual(await unexpected.json(), {
    error: "The server could not complete your request.",
  });
});
