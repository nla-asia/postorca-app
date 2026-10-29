import { stat } from "node:fs/promises";
import { z } from "zod";
import { HttpError } from "../handlers/errors.js";
import {
  createArtifact,
  deleteArtifact,
  listArtifacts,
  recentIdeas,
  taskArtifact,
  updateDocumentArtifact,
} from "../repositories/artifacts.js";
import {
  taskPublication,
  recordPostResult,
} from "../repositories/publications.js";
import { platforms } from "../schemas/platforms.js";
import { MAX_REPLY, replySchema } from "../schemas/social.js";
import {
  describeFile,
  filePath,
  fileRef,
  resolveUserFile,
} from "../storage.js";
import {
  applyEdits,
  editsParameter,
  editsSchema,
  object,
  type Tool,
} from "./shared.js";

const MAX_CONTENT = 100_000;
/** Text deliverables, and media delivered from files saved by file, browser or media tools. */
const ARTIFACT_KINDS = [
  "document",
  "idea",
  "url",
  "image",
  "audio",
  "video",
] as const;
const MEDIA_KINDS = new Set(["image", "audio", "video"]);

export const artifactTools: Tool[] = [
  {
    definition: {
      name: "list_content_ideas",
      description:
        "Read the founder's recent content ideas from their Inbox (the ideas routines delivered), newest first: title, idea text, platform, date, and whether content is already queued for it. Read-only.",
      parameters: object(
        {
          days: {
            type: "integer",
            minimum: 1,
            maximum: 60,
            description: "How far back to look. Default 7.",
          },
          platform: { type: "string", enum: [...platforms] },
          limit: { type: "integer", minimum: 1, maximum: 20 },
        },
        [],
      ),
    },
    run: async ({ db, userId }, args) => {
      const { days, platform, limit } = z
        .object({
          days: z.number().int().min(1).max(60).default(7),
          platform: z.enum(platforms).optional(),
          limit: z.number().int().min(1).max(20).default(10),
        })
        .strict()
        .parse(args);
      const ideas = await recentIdeas(db, userId, { days, limit, platform });
      return ideas.length
        ? { ideas }
        : { ideas, message: `No content ideas in the last ${days} days.` };
    },
  },
  {
    definition: {
      name: "create_artifact",
      description:
        "Deliver a document, content idea (one per idea), reference URL, image, audio or video in the task's Artifacts section for founder review. For image/audio/video, content must be the saved file ref or file key a file, browser or media tool returned; the server validates ownership and file type and supplies an authenticated preview/download. Already saved files need no re-upload. For documents/ideas, content is the deliverable text; for url, an HTTP(S) link. Create each deliverable once. To revise a document, use edit_document instead of creating another.",
      parameters: object(
        {
          kind: { type: "string", enum: [...ARTIFACT_KINDS] },
          title: { type: "string" },
          content: {
            type: "string",
            description:
              "For image/audio/video: saved file ref or key. Otherwise: document/idea text or reference URL.",
          },
        },
        ["kind", "title", "content"],
      ),
    },
    run: async ({ db, userId, taskId, turnId }, args) => {
      const artifact = z
        .object({
          kind: z.enum(ARTIFACT_KINDS),
          title: z.string().min(1).max(200),
          content: z.string().min(1).max(MAX_CONTENT),
        })
        .strict()
        .parse(args);
      if (artifact.kind === "url")
        z.url({ protocol: /^https?$/ }).parse(artifact.content);
      if (MEDIA_KINDS.has(artifact.kind)) {
        const key = await resolveUserFile(userId, artifact.content);
        if (!key)
          throw new HttpError(
            404,
            "Saved file not found. Use a file ref returned by a file or media tool.",
          );
        let metadata;
        try {
          await stat(filePath(key));
          metadata = await describeFile(key);
        } catch {
          throw new HttpError(404, "Saved file not found.");
        }
        if (!metadata.mime_type.startsWith(`${artifact.kind}/`))
          throw new HttpError(400, `Choose a saved ${artifact.kind} file.`);
        // The artifact stores validated metadata, never a model-written URL.
        const media = {
          file: key,
          ref: fileRef(key),
          mime_type: metadata.mime_type,
          filename: metadata.filename,
          ...("bytes" in metadata ? { bytes: metadata.bytes } : {}),
          ...("source_url" in metadata
            ? { source_url: metadata.source_url }
            : {}),
          url: `/api/files?key=${encodeURIComponent(key)}`,
        };
        return createArtifact(db, taskId, turnId, {
          ...artifact,
          content: JSON.stringify(media),
        });
      }
      return createArtifact(db, taskId, turnId, artifact);
    },
  },
  {
    definition: {
      name: "create_reply",
      description:
        "Deliver one draft reply to someone else's post as a card in the founder's Inbox: their post on top, the founder's reply under it, with buttons to open the post, reply, copy, follow (for connect) and mark it done. Create one per post, as soon as it is ready. intent connect means the founder will follow the author; conversation means joining the discussion. Put only the reply itself in text: no notes, alternatives or caveats (say those in your final message).",
      parameters: object(
        {
          platform: { type: "string", enum: [...platforms] },
          kind: {
            type: "string",
            enum: ["reply", "quote"],
            description: "reply (default) or quote post.",
          },
          intent: { type: "string", enum: ["conversation", "connect"] },
          target: object(
            {
              url: {
                type: "string",
                description:
                  "Exact link of the post (or the reply in a thread) being answered.",
              },
              author: { type: "string", description: "Display name." },
              handle: {
                type: "string",
                description: "Username without @, if the platform has one.",
              },
              text: {
                type: "string",
                description:
                  "The post's text as shown, or its first lines (at most 1000 characters).",
              },
              posted_at: {
                type: "string",
                description:
                  "When it was posted: ISO time if known, otherwise as shown (e.g. 2h).",
              },
              stats: {
                type: "object",
                description:
                  "Numbers you saw on it, e.g. {replies: 12, likes: 40, views: 900, author_followers: 830}.",
              },
            },
            ["url", "author"],
          ),
          text: {
            type: "string",
            description: `The reply, ready to paste once any [placeholder] for a detail only the founder knows is filled (at most ${MAX_REPLY} characters; keep to the platform's limit).`,
          },
          why: {
            type: "string",
            description:
              "One short line on why this one is worth it, shown in grey under their post.",
          },
        },
        ["platform", "intent", "target", "text"],
      ),
    },
    run: async ({ db, taskId, turnId }, args) => {
      const reply = replySchema.parse(args);
      const who = reply.target.handle
        ? `@${reply.target.handle.replace(/^@/, "")}`
        : reply.target.author;
      return createArtifact(db, taskId, turnId, {
        kind: "reply",
        title: `${reply.intent === "connect" ? "Connect with" : "Reply to"} ${who}`,
        content: JSON.stringify(reply),
      });
    },
  },
  {
    definition: {
      name: "read_artifact",
      description:
        "Read an artifact's current saved content by id, including any edits the founder made by hand. Without an id, lists this task's artifacts (id, kind, title). Read a document before editing it.",
      parameters: object({ id: { type: "string" } }, []),
    },
    run: async ({ db, taskId }, args) => {
      const { id } = z.object({ id: z.uuid().optional() }).strict().parse(args);
      if (!id) return { artifacts: await listArtifacts(db, taskId) };
      const artifact = await taskArtifact(db, taskId, id);
      if (!artifact)
        throw new HttpError(404, "No artifact with that id in this task.");
      return artifact;
    },
  },
  {
    definition: {
      name: "edit_document",
      description:
        "Revise a document artifact of this task in place, so the founder keeps one current version. Pass edits: each find is an exact passage of the current text (read_artifact first) that appears exactly once; include enough surrounding text to make it unique. Edits apply in order and only the found passages change. Pass content instead only to replace the whole text. Returns the updated document.",
      parameters: object(
        {
          id: { type: "string" },
          edits: editsParameter,
          content: { type: "string" },
        },
        ["id"],
      ),
    },
    run: async ({ db, taskId }, args) => {
      const request = z
        .object({
          id: z.uuid(),
          edits: editsSchema.optional(),
          content: z.string().min(1).max(MAX_CONTENT).optional(),
        })
        .strict()
        .refine((value) => !value.edits !== !value.content, {
          message: "Pass either edits or content.",
        })
        .parse(args);
      const document = await taskArtifact(db, taskId, request.id);
      if (!document || document.kind !== "document")
        throw new HttpError(404, "No document with that id in this task.");
      const content =
        request.content ??
        applyEdits(
          document.content,
          request.edits!,
          "document; read_artifact",
        );
      if (!content.trim() || content.length > MAX_CONTENT)
        throw new HttpError(
          400,
          `The edited document must be non-empty and at most ${MAX_CONTENT} characters. No edits were saved.`,
        );
      const updated = await updateDocumentArtifact(
        db,
        taskId,
        document.id,
        content,
      );
      // Deleted between the read and the write.
      if (!updated)
        throw new HttpError(404, "No document with that id in this task.");
      return { id: updated.id, title: updated.title, content };
    },
  },
  {
    definition: {
      name: "delete_artifact",
      description:
        "Delete an artifact created earlier in this task, by its id, when it should no longer be delivered. To revise a document, use edit_document.",
      parameters: object({ id: { type: "string" } }, ["id"]),
    },
    run: async ({ db, taskId }, args) => {
      const { id } = z.object({ id: z.uuid() }).strict().parse(args);
      const artifact = await deleteArtifact(db, taskId, id);
      if (!artifact)
        throw new HttpError(404, "No artifact with that id in this task.");
      return { ...artifact, deleted: true };
    },
  },
  {
    definition: {
      name: "record_post_result",
      description:
        "In a publish task: record how the scheduled post ended. status posted with url (the live post's exact link, opened and checked) once it is up, or skipped when it was not posted and won't be. The founder sees it on the task and the post's draft.",
      parameters: object(
        {
          status: { type: "string", enum: ["posted", "skipped"] },
          url: { type: "string", description: "posted: the live post's link." },
        },
        ["status"],
      ),
    },
    run: async ({ db, userId, taskId }, args) => {
      const result = z
        .discriminatedUnion("status", [
          z
            .object({
              status: z.literal("posted"),
              url: z.url({ protocol: /^https?$/ }).max(2048),
            })
            .strict(),
          z.object({ status: z.literal("skipped") }).strict(),
        ])
        .parse(args);
      const publication = await taskPublication(db, taskId);
      if (!publication)
        throw new HttpError(400, "This task has no scheduled post to record.");
      return recordPostResult(db, userId, publication.id, result);
    },
  },
];
