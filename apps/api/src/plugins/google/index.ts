import { z } from "zod";
import type { PluginDefinition, PluginToolDefinition } from "../types.js";
import { callConnector } from "../../connectors/mcp.js";
import type { Connector } from "../../connectors/catalog.js";
import { loadSkill } from "../../skills/load.js";

function tool(
  connector: Connector,
  name: string,
  description: string,
  args: z.ZodObject<any>,
): PluginToolDefinition {
  const { $schema, ...parameters } = z.toJSONSchema(args) as Record<
    string,
    unknown
  >;
  return {
    name,
    description,
    args,
    parameters,
    runsOn: "server",
    run: (context, input) => callConnector(context, connector, name, input),
  };
}

const text = z.string().min(1).max(1000);
const recipient = z
  .string()
  .min(1)
  .max(2000)
  .refine(
    (value) => !/[\r\n]/.test(value),
    "Email headers cannot contain newlines.",
  );

export const gmailPlugin: PluginDefinition = {
  code: "gmail",
  name: "Gmail",
  description:
    "Read and send email through the founder's connected Gmail account.",
  skills: [loadSkill(new URL("./skills/gmail-use/", import.meta.url))],
  tools: [
    tool(
      "gmail",
      "gmail_read_emails",
      "Search and read email from the connected Gmail account. Returns message IDs, headers, snippets, and bodies.",
      z
        .object({
          query: z.string().max(1000).optional(),
          maxResults: z.number().int().min(1).max(50).optional(),
        })
        .strict(),
    ),
    tool(
      "gmail",
      "gmail_send_email",
      "Send email from the connected Gmail account when authorized by the founder. Recipients and subject must not contain newlines.",
      z
        .object({
          to: recipient,
          subject: recipient,
          body: z.string().min(1).max(100_000),
          cc: recipient.optional(),
          bcc: recipient.optional(),
        })
        .strict(),
    ),
  ],
};

export const drivePlugin: PluginDefinition = {
  code: "google_drive",
  name: "Google Drive",
  description:
    "Find and read files in the founder's connected Google Drive, and create or update app-accessible files.",
  skills: [loadSkill(new URL("./skills/google-drive-use/", import.meta.url))],
  tools: [
    tool(
      "google_drive",
      "google_drive_list_drive_files",
      "List/search files in connected Drive using a Drive query. Supports folderId and maxResults.",
      z
        .object({
          folderId: text.optional(),
          query: z.string().max(2000).optional(),
          maxResults: z.number().int().min(1).max(100).optional(),
        })
        .strict(),
    ),
    tool(
      "google_drive",
      "google_drive_read_file",
      "Read or export a Drive file as text. Choose a textual export MIME type for Google Workspace documents.",
      z
        .object({
          fileId: text,
          exportMimeType: z
            .enum(["text/plain", "text/csv", "text/html", "application/json"])
            .optional(),
        })
        .strict(),
    ),
    tool(
      "google_drive",
      "google_drive_write_file",
      "Create a text file in Drive, or update an app-accessible file using fileId. Does not change sharing permissions.",
      z
        .object({
          name: text,
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
          folderId: text.optional(),
          fileId: text.optional(),
        })
        .strict(),
    ),
  ],
};
