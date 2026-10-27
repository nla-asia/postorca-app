import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { PluginContext } from "../plugins/types.js";
import { HttpError } from "../handlers/errors.js";
import { connectionAccessToken } from "./service.js";
import type { Connector } from "./catalog.js";

const allowed: Record<Connector, string[]> = {
  gmail: ["gmail_read_emails", "gmail_send_email"],
  google_drive: [
    "google_drive_list_drive_files",
    "google_drive_read_file",
    "google_drive_write_file",
  ],
};

export async function callConnector(
  context: PluginContext,
  connector: Connector,
  name: string,
  args: Record<string, unknown>,
) {
  if (!allowed[connector].includes(name))
    throw new HttpError(400, "Tool is not available for this connector.");
  const apiKey = process.env.MCP_CONNECTOR_API_KEY;
  const endpoint = process.env.MCP_CONNECTOR_URL;
  if (!apiKey || !endpoint)
    throw new HttpError(
      503,
      "The connector service is not configured on the server yet.",
    );
  const url = new URL(endpoint);
  if (
    url.protocol !== "https:" &&
    !(
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    )
  )
    throw new HttpError(
      503,
      "The connector service requires HTTPS outside localhost.",
    );
  const token = await connectionAccessToken(
    context.db,
    context.userId,
    connector,
  );
  const client = new Client({ name: "postorca", version: "0.1.0" });
  // A fresh session per call prevents OAuth credentials leaking between users.
  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "X-Google-Access-Token": token,
      },
      signal: context.signal,
    },
  });
  try {
    await client.connect(transport, {
      timeout: 15_000,
      signal: context.signal,
    });
    const result = await client.callTool({ name, arguments: args }, undefined, {
      timeout: 60_000,
      signal: context.signal,
    });
    if (result.isError)
      throw new HttpError(
        400,
        `${connector === "gmail" ? "Gmail" : "Google Drive"} could not complete the request. Check the connection and supplied details.`,
      );
    if (result.structuredContent) return result.structuredContent;
    const text = (result.content as { type: string; text?: string }[])
      .filter((item) => item.type === "text")
      .map((item) => item.text)
      .join("\n");
    try {
      return JSON.parse(text);
    } catch {
      return { text };
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(
      502,
      "The connector service could not complete the request. Try again or reconnect the app.",
    );
  } finally {
    await transport.terminateSession().catch(() => {});
    await client.close().catch(() => {});
  }
}
