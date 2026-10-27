import { drive } from "@googleapis/drive";
import { gmail, type gmail_v1 } from "@googleapis/gmail";
import { OAuth2Client } from "google-auth-library";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { composeEmail } from "./email.js";
import { getGoogleAccessToken } from "./request_context.js";

function googleAuth(): OAuth2Client {
  const client = new OAuth2Client();
  client.setCredentials({ access_token: getGoogleAccessToken() });
  return client;
}

function toolResult(result: Record<string, unknown>) {
  return {
    structuredContent: result,
    content: [{ type: "text" as const, text: JSON.stringify(result) }],
  };
}

const header = z
  .string()
  .min(1)
  .max(2000)
  .refine(
    (value) => !/[\r\n]/.test(value),
    "Email headers cannot contain newlines.",
  );

function extractEmailBody(payload?: gmail_v1.Schema$MessagePart): string {
  if (!payload) return "";
  if (payload.body?.data) {
    return Buffer.from(payload.body.data, "base64url").toString("utf8");
  }
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === "text/plain" && part.body?.data) {
        return Buffer.from(part.body.data, "base64url").toString("utf8");
      }
      const nested = extractEmailBody(part);
      if (nested) return nested;
    }
  }
  return "";
}

export function registerGoogleTools(server: McpServer): void {
  server.registerTool(
    "gmail_send_email",
    {
      title: "Send Gmail email",
      description: "Send an email from the Gmail account connected in PostOrca.",
      inputSchema: {
        to: header.describe("Recipient email address"),
        subject: header.describe("Email subject"),
        body: z.string().min(1).max(100_000).describe("Email body"),
        cc: header.optional().describe("Comma-separated CC recipients"),
        bcc: header.optional().describe("Comma-separated BCC recipients"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    async ({ to, subject, body, cc, bcc }) => {
      const raw = composeEmail({ to, subject, body, cc, bcc });
      const response = await gmail({
        version: "v1",
        auth: googleAuth(),
      }).users.messages.send({
        userId: "me",
        requestBody: { raw },
      });
      return toolResult({
        messageId: response.data.id,
        threadId: response.data.threadId,
      });
    },
  );

  server.registerTool(
    "gmail_read_emails",
    {
      title: "Read Gmail emails",
      description:
        "Read recent emails from the Gmail account connected in PostOrca.",
      inputSchema: {
        query: z.string().optional().describe("Gmail search query"),
        maxResults: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe("Maximum emails to return"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    async ({ query, maxResults }) => {
      const client = gmail({ version: "v1", auth: googleAuth() });
      const listed = await client.users.messages.list({
        userId: "me",
        q: query || "",
        maxResults: maxResults || 10,
      });
      const messages = listed.data.messages || [];
      const emails = await Promise.all(
        messages.map(async (item) => {
          const response = await client.users.messages.get({
            userId: "me",
            id: item.id!,
            format: "full",
          });
          const message = response.data;
          const headers = message.payload?.headers || [];
          const body = extractEmailBody(message.payload);
          const findHeader = (name: string) =>
            headers.find((headerItem) => headerItem.name?.toLowerCase() === name.toLowerCase())?.value || "";

          return {
            id: message.id,
            threadId: message.threadId,
            subject: findHeader("Subject"),
            from: findHeader("From"),
            to: findHeader("To"),
            date: findHeader("Date"),
            snippet: message.snippet,
            body,
          };
        }),
      );
      return toolResult({ emails, total: emails.length });
    },
  );

  server.registerTool(
    "google_drive_list_drive_files",
    {
      title: "List Google Drive files",
      description: "List files from the Google Drive connected in PostOrca.",
      inputSchema: {
        folderId: z.string().optional(),
        query: z.string().optional(),
        maxResults: z.number().int().min(1).max(100).optional(),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    async ({ folderId, query, maxResults }) => {
      let q = query || "";
      if (folderId) {
        q = `'${folderId}' in parents${query ? ` and ${query}` : ""}`;
      }
      const response = await drive({
        version: "v3",
        auth: googleAuth(),
      }).files.list({
        q,
        pageSize: maxResults || 10,
        fields: "files(id, name, mimeType, webViewLink, modifiedTime, size)",
      });
      const files = response.data.files || [];
      return toolResult({ files, total: files.length });
    },
  );

  server.registerTool(
    "google_drive_read_file",
    {
      title: "Read Google Drive file",
      description:
        "Read or export a file from the Google Drive connected in PostOrca.",
      inputSchema: {
        fileId: z.string(),
        exportMimeType: z
          .enum(["text/plain", "text/csv", "text/html", "application/json"])
          .optional(),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    async ({ fileId, exportMimeType }) => {
      const client = drive({ version: "v3", auth: googleAuth() });
      const metadata = await client.files.get({
        fileId,
        fields: "id, name, mimeType, size",
      });
      const fileMetadata = metadata.data as {
        mimeType?: string | null;
        name?: string | null;
        size?: string | null;
      };
      const mimeType = fileMetadata.mimeType || "";
      const fileName = fileMetadata.name || "unknown";
      const exportDefaults: Record<string, string> = {
        "application/vnd.google-apps.document": "text/plain",
        "application/vnd.google-apps.spreadsheet": "text/csv",
        "application/vnd.google-apps.presentation": "text/plain",
      };
      if (
        !mimeType.startsWith("application/vnd.google-apps.") &&
        !mimeType.startsWith("text/") &&
        mimeType !== "application/json"
      ) {
        throw new Error("This tool reads text files only.");
      }

      let content: string;
      if (mimeType.startsWith("application/vnd.google-apps.")) {
        const response = await client.files.export(
          {
            fileId,
            mimeType:
              exportMimeType || exportDefaults[mimeType] || "text/plain",
          },
          { responseType: "text" },
        );
        content =
          typeof response.data === "string"
            ? response.data
            : JSON.stringify(response.data);
      } else {
        const size = Number.parseInt(fileMetadata.size || "0", 10);
        if (size > 10 * 1024 * 1024) {
          throw new Error(
            `File is too large to read (${(size / 1024 / 1024).toFixed(1)}MB). Maximum supported size is 10MB.`,
          );
        }
        const response = await client.files.get(
          { fileId, alt: "media" },
          { responseType: "text" },
        );
        content =
          typeof response.data === "string"
            ? response.data
            : JSON.stringify(response.data);
      }

      const truncated = content.length > 100_000;
      if (truncated) content = content.slice(0, 100_000);

      return toolResult({
        fileId,
        fileName,
        mimeType,
        content,
        truncated,
        characterCount: content.length,
      });
    },
  );

  server.registerTool(
    "google_drive_write_file",
    {
      title: "Write Google Drive file",
      description:
        "Create or update a file in the Google Drive connected in PostOrca.",
      inputSchema: {
        name: z.string(),
        content: z.string().max(100_000),
        mimeType: z
          .enum([
            "text/plain",
            "text/csv",
            "text/html",
            "application/json",
            "text/markdown",
          ])
          .optional(),
        folderId: z.string().optional(),
        fileId: z.string().optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    async ({ name, content, mimeType, folderId, fileId }) => {
      const client = drive({ version: "v3", auth: googleAuth() });
      const media = { mimeType: mimeType || "text/plain", body: content };
      const fields = "id, name, mimeType, webViewLink, modifiedTime";
      const response = fileId
        ? await client.files.update({
            fileId,
            requestBody: { name },
            media,
            fields,
          })
        : await client.files.create({
            requestBody: {
              name,
              mimeType: mimeType || "text/plain",
              ...(folderId ? { parents: [folderId] } : {}),
            },
            media,
            fields,
          });
      return toolResult({
        fileId: response.data.id,
        fileName: response.data.name,
        mimeType: response.data.mimeType,
        webViewLink: response.data.webViewLink,
        modifiedTime: response.data.modifiedTime,
        action: fileId ? "updated" : "created",
      });
    },
  );
}
