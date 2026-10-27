import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerGoogleTools } from "./google_tools.js";

export function createPostOrcaMcpServer(): McpServer {
  const server = new McpServer({
    name: "postorca-mcp-connectors",
    version: "0.1.0",
  });
  registerGoogleTools(server);
  return server;
}
