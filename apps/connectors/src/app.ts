import { timingSafeEqual } from "node:crypto";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createPostOrcaMcpServer } from "./mcp_server.js";
import { providerRequestContext } from "./request_context.js";

export function createConnectorApp(apiKey: string, host = "127.0.0.1") {
  if (!apiKey) {
    throw new Error("MCP_SERVER_API_KEY is required");
  }

  const expected = Buffer.from(apiKey);
  const app = createMcpExpressApp({ host });

  app.get("/health", (_request, response) => {
    response.json({ status: "ok" });
  });

  app.use("/mcp", (request, response, next) => {
    const auth = request.header("authorization");
    const candidate = Buffer.from(
      auth?.startsWith("Bearer ") ? auth.slice(7) : "",
    );

    if (
      candidate.length !== expected.length ||
      !timingSafeEqual(candidate, expected)
    ) {
      response.status(401).json({ error: "Unauthorized" });
      return;
    }

    response.setHeader("Cache-Control", "no-store");
    next();
  });

  // Stateless transport: each request gets a fresh server and token context,
  // preventing credential leakage across requests.
  app.post("/mcp", async (request, response) => {
    const googleAccessToken = request.header("x-google-access-token");
    if (!googleAccessToken) {
      response.status(400).json({ error: "Google access token is required" });
      return;
    }

    const server = createPostOrcaMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    response.on("close", () => {
      void transport.close().catch(() => {});
      void server.close().catch(() => {});
    });

    try {
      await server.connect(transport);
      await providerRequestContext.run({ googleAccessToken }, () =>
        transport.handleRequest(request, response, request.body),
      );
    } catch {
      // Do not log provider errors to avoid leaking credential-bearing requests.
      if (!response.headersSent) {
        response.status(500).json({ error: "Connector request failed" });
      }
    }
  });

  app.all("/mcp", (_request, response) => {
    response.status(405).end();
  });

  return app;
}
