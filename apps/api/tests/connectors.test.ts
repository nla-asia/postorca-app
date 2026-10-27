import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { createApp } from "../src/app.js";
import { configFromEnv } from "../src/config.js";
import { migrate } from "../src/migrate.js";
import { connectors } from "../src/connectors/catalog.js";
import {
  beginConnection,
  connectionAccessToken,
  disconnectConnection,
  finishConnection,
} from "../src/connectors/service.js";
import { callConnector } from "../src/connectors/mcp.js";
import { temporaryPostgres } from "./postgres.js";

const secret = "connectors-test-secret-at-least-32-chars";
let fixture: Awaited<ReturnType<typeof temporaryPostgres>>;
let server: Server;
let url: string;
const originalEnv = { ...process.env };

before(async () => {
  fixture = await temporaryPostgres();
  await migrate(fixture.db);
  server = createApp(
    fixture.db,
    configFromEnv({ DATABASE_URL: fixture.url, JWT_SECRET: secret }),
  ).listen(0, "127.0.0.1");
  await once(server, "listening");
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

after(async () => {
  for (const key of Object.keys(process.env)) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
  if (server)
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  await fixture?.close();
});

async function request(
  path: string,
  method = "GET",
  body?: unknown,
  token?: string,
) {
  const response = await fetch(url + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const contentType = response.headers.get("content-type");
  let data: any = null;
  if (contentType?.includes("application/json")) {
    data = await response.json();
  } else {
    data = await response.text();
  }
  return { status: response.status, data };
}

async function register(email: string) {
  const result = await request("/auth/register", "POST", {
    name: "Founder",
    email,
    password: "secure-test-password",
  });
  assert.equal(result.status, 201);
  return { user: result.data.user, token: result.data.token as string };
}

test("Google connectors: OAuth flow, encryption, token refresh, and MCP dispatching", async (context) => {
  Object.assign(process.env, {
    GOOGLE_CLIENT_ID: "postorca-test-client",
    GOOGLE_CLIENT_SECRET: "postorca-test-secret",
    GOOGLE_REDIRECT_URI: `${url}/connectors/google/callback`,
    CONNECTOR_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  });

  const a = await register("owner@example.com");
  const b = await register("other@example.com");
  const originalFetch = globalThis.fetch;
  let refreshes = 0;
  let scopes: string[] = [...connectors.gmail.scopes];

  const jsonResponse = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });

  context.mock.method(
    globalThis,
    "fetch",
    async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const target = String(input);
      if (target === "https://oauth2.googleapis.com/token") {
        const args = new URLSearchParams(String(init?.body));
        assert.equal(args.get("client_id"), "postorca-test-client");
        assert.equal(args.get("client_secret"), "postorca-test-secret");
        if (args.get("grant_type") === "refresh_token") {
          refreshes++;
          assert.equal(args.get("refresh_token"), "test-refresh-token");
          return jsonResponse({
            access_token: "test-refreshed-token",
            expires_in: 3600,
            scope: scopes.join(" "),
          });
        }
        assert.ok(args.get("code_verifier"));
        return jsonResponse({
          access_token: "test-access-token",
          refresh_token: "test-refresh-token",
          expires_in: 3600,
          scope: scopes.join(" "),
        });
      }
      if (target === "https://www.googleapis.com/oauth2/v2/userinfo") {
        return jsonResponse({ email: "owner@gmail.com" });
      }
      return originalFetch(input, init);
    },
  );

  // 1. Unauthenticated request rejected
  assert.equal((await request("/connectors")).status, 401);

  // 2. Invalid connector rejected
  assert.equal(
    (await request("/connectors/not-an-app/connect", "POST", {}, a.token))
      .status,
    400,
  );

  // 3. Begin connection returns valid consent URL
  const started = await request(
    "/connectors/gmail/connect",
    "POST",
    {},
    a.token,
  );
  assert.equal(started.status, 200);
  const oauth = new URL(started.data.url);
  assert.equal(oauth.origin, "https://accounts.google.com");
  assert.equal(oauth.searchParams.get("code_challenge_method"), "S256");
  const state = oauth.searchParams.get("state")!;

  // 4. Verify state hash in DB
  const {
    rows: [storedState],
  } = await fixture.db.query(
    "SELECT * FROM connector_oauth_states WHERE user_id=$1",
    [a.user.id],
  );
  assert.notEqual(storedState.state_hash, state);
  assert.equal(storedState.user_id, a.user.id);

  // 5. Callback via finishConnection
  assert.equal(await finishConnection(fixture.db, state, "test-code"), true);

  // 6. Replay rejected
  await assert.rejects(finishConnection(fixture.db, state, "test-code"), {
    status: 400,
  });
  await assert.rejects(
    finishConnection(fixture.db, "forged-state", "test-code"),
    {
      status: 400,
    },
  );

  // 7. List connections shows gmail connected with email, no tokens
  const list = (await request("/connectors", "GET", undefined, a.token)).data;
  assert.equal(list.length, 2);
  assert.equal(
    list.find((row: any) => row.id === "gmail").email,
    "owner@gmail.com",
  );
  assert.ok(!JSON.stringify(list).includes("test-access-token"));

  // 8. User B has no connected apps
  assert.ok(
    (await request("/connectors", "GET", undefined, b.token)).data.every(
      (row: any) => !row.connected,
    ),
  );

  // 9. Tokens are encrypted in DB
  const {
    rows: [stored],
  } = await fixture.db.query(
    "SELECT * FROM user_connections WHERE user_id=$1 AND connector='gmail'",
    [a.user.id],
  );
  assert.ok(Buffer.isBuffer(stored.tokens));
  assert.ok(!stored.tokens.includes(Buffer.from("test-access-token")));

  // 10. Access token for unconnected user throws
  await assert.rejects(connectionAccessToken(fixture.db, b.user.id, "gmail"), {
    status: 400,
  });

  // 11. Expired token triggers refresh
  await fixture.db.query(
    "UPDATE user_connections SET expires_at=now()-interval '1 minute' WHERE user_id=$1",
    [a.user.id],
  );
  const refreshed = await Promise.all([
    connectionAccessToken(fixture.db, a.user.id, "gmail"),
    connectionAccessToken(fixture.db, a.user.id, "gmail"),
  ]);
  assert.deepEqual(refreshed, [
    "test-refreshed-token",
    "test-refreshed-token",
  ]);
  assert.equal(refreshes, 1);

  // 12. Connect Google Drive
  scopes = [...connectors.google_drive.scopes];
  const driveState = new URL(
    (await beginConnection(fixture.db, a.user.id, "google_drive")).url,
  ).searchParams.get("state")!;
  await finishConnection(fixture.db, driveState, "test-code");

  // 13. Verify MCP callConnector integration
  const mcpApp = express();
  mcpApp.use(express.json());
  const sessions = new Map<string, StreamableHTTPServerTransport>();
  const toolArgs: unknown[] = [];
  mcpApp.use((req, _res, next) => {
    assert.equal(req.headers.authorization, "Bearer test-mcp-key");
    assert.equal(req.headers["x-google-access-token"], "test-refreshed-token");
    next();
  });
  mcpApp.post("/mcp", async (req, res) => {
    let transport = sessions.get(String(req.headers["mcp-session-id"]));
    if (!transport) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomBytes(16).toString("hex"),
        onsessioninitialized: (id) => {
          sessions.set(id, transport!);
        },
      });
      const mcpServerInstance = new McpServer({
        name: "connector-fixture",
        version: "1",
      });
      mcpServerInstance.registerTool(
        "gmail_read_emails",
        { inputSchema: { query: z.string().optional() } },
        async (args) => {
          toolArgs.push(args);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ emails: [{ subject: "Fixture mail" }] }),
              },
            ],
          };
        },
      );
      await mcpServerInstance.connect(transport);
    }
    await transport.handleRequest(req, res, req.body);
  });
  mcpApp.delete("/mcp", async (req, res) => {
    const transport = sessions.get(String(req.headers["mcp-session-id"]));
    if (transport) await transport.handleRequest(req, res);
    else res.sendStatus(404);
  });
  const mcpListener = mcpApp.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => mcpListener.once("listening", resolve));
  process.env.MCP_CONNECTOR_URL = `http://127.0.0.1:${(mcpListener.address() as AddressInfo).port}/mcp`;
  process.env.MCP_CONNECTOR_API_KEY = "test-mcp-key";

  try {
    const result = await callConnector(
      {
        db: fixture.db,
        userId: a.user.id,
        taskId: "task-1",
        turnId: "turn-1",
      },
      "gmail",
      "gmail_read_emails",
      { query: "from:founder@example.com" },
    );
    assert.deepEqual(result, { emails: [{ subject: "Fixture mail" }] });
    assert.deepEqual(toolArgs, [{ query: "from:founder@example.com" }]);

    // Wrong connector tool rejected
    await assert.rejects(
      callConnector(
        {
          db: fixture.db,
          userId: a.user.id,
          taskId: "task-1",
          turnId: "turn-1",
        },
        "gmail",
        "google_drive_read_file",
        {},
      ),
      { status: 400 },
    );
  } finally {
    for (const session of sessions.values()) await session.close();
    await new Promise<void>((resolve) => mcpListener.close(() => resolve()));
  }

  // 14. Disconnect removes Gmail connection
  await request("/connectors/gmail", "DELETE", undefined, a.token);
  const afterList = (
    await request("/connectors", "GET", undefined, a.token)
  ).data;
  assert.equal(
    afterList.find((row: any) => row.id === "gmail").connected,
    false,
  );
  assert.equal(
    afterList.find((row: any) => row.id === "google_drive").connected,
    true,
  );
});

test("Public OAuth callback endpoint returns formatted HTML confirmation", async () => {
  const result = await request("/connectors/google/callback?state=invalidstate");
  assert.equal(result.status, 400);
  assert.ok(typeof result.data === "string");
  assert.ok(result.data.includes("Connect Apps"));
});
