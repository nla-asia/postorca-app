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
import { platforms } from "../schemas/platforms.js";
import {
  applyEdits,
  editsParameter,
  editsSchema,
  object,
  type Tool,
} from "./shared.js";

const MAX_CONTENT = 100_000;
/** Text deliverables. Image, audio and video artifacts need saved files from file tools. */
const ARTIFACT_KINDS = ["document", "idea", "url"] as const;

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
        "Deliver a document, content idea (one per idea) or reference URL in the task's Artifacts section for founder review. For documents and ideas, content is the deliverable text; for url, an HTTP(S) link. Create each deliverable once. To revise a document, use edit_document instead of creating another.",
      parameters: object(
        {
          kind: { type: "string", enum: [...ARTIFACT_KINDS] },
          title: { type: "string" },
          content: {
            type: "string",
            description: "Document or idea text, or the reference URL.",
          },
        },
        ["kind", "title", "content"],
      ),
    },
    run: ({ db, taskId, turnId }, args) => {
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
      return createArtifact(db, taskId, turnId, artifact);
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
];
