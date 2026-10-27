import { config } from "dotenv";
import { createConnectorApp } from "./app.js";

config({ quiet: true });

const host = process.env.MCP_HOST || "127.0.0.1";
const port = Number(process.env.MCP_PORT || 3100);
const app = createConnectorApp(process.env.MCP_SERVER_API_KEY || "", host);

const server = app.listen(port, host, () => {
  console.log(`PostOrca MCP connectors listening on http://${host}:${port}/mcp`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close();
  });
}
