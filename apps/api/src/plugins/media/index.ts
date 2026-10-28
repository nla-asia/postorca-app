import { CreditError } from "../../billing/credits.js";
import { createHash } from "node:crypto";
import OpenAI from "openai";
import { z } from "zod";
import { HttpError } from "../../handlers/errors.js";
import { keyFor } from "../../config.js";
import { createImageProviderFromEnv } from "../../providers/meta-image.js";
import { imageOptionsSchema } from "../../providers/openai-image.js";
import {
  createElevenLabsProviderFromEnv,
  ElevenLabsError,
} from "../../providers/elevenlabs.js";
import { loadSkill } from "../../skills/load.js";
import {
  describeFile,
  fileRef,
  loadFile,
  resolveUserFile,
  saveFile,
  type StoredFileType,
} from "../../storage.js";
import type {
  PluginContext,
  PluginDefinition,
  PluginToolDefinition,
} from "../types.js";

const text = z.string().trim().min(1);
const title = text.max(200);
function imageProvider() {
  let provider;
  try {
    provider = createImageProviderFromEnv();
  } catch (error) {
    throw new HttpError(
      503,
      `Image generation is misconfigured on the server. ${(error as Error).message}`,
    );
  }
  if (!provider)
    throw new HttpError(
      503,
      `Image generation is off. Set ${keyFor("images")} on the server.`,
    );
  return provider;
}
function audioProvider() {
  const provider = createElevenLabsProviderFromEnv();
  if (!provider)
    throw new HttpError(
      503,
      "Audio is unavailable. Set ELEVENLABS_API_KEY on the server.",
    );
  return provider;
}
const requestOptions = (context: PluginContext) => ({
  signal: context.signal,
  safetyIdentifier: createHash("sha256").update(context.userId).digest("hex"),
});

async function attachment(
  context: PluginContext,
  title: string,
  result: { data: Buffer; mimeType: StoredFileType },
) {
  const file = await saveFile(
    context.userId,
    "media",
    result.data,
    result.mimeType,
  );
  return {
    ref: fileRef(file),
    attachments: [{ file, mime_type: result.mimeType, title }],
    message:
      "The attachment appears in this conversation. Use its ref in other tools; do not put internal file keys in Markdown URLs.",
  };
}

export async function ownedFile(
  context: PluginContext,
  ref: string,
  kind: "image" | "audio",
) {
  const key = await resolveUserFile(context.userId, ref);
  if (!key)
    throw new HttpError(
      404,
      `File not found: ${ref.slice(0, 120)}. Use the ref from the file's tool result.`,
    );
  const info = await describeFile(key).catch(() => {
    throw new HttpError(404, "File not found.");
  });
  if (!info.mime_type.startsWith(`${kind}/`))
    throw new HttpError(400, `Choose a saved ${kind} file.`);
  return key;
}
export async function ownedBlob(
  context: PluginContext,
  ref: string,
  kind: "image" | "audio",
) {
  const key = await ownedFile(context, ref, kind);
  const { mime_type } = await describeFile(key);
  const data = await loadFile(key).catch(() => {
    throw new HttpError(404, "File not found.");
  });
  return new Blob([new Uint8Array(data)], { type: mime_type });
}

function mediaTool<T extends z.ZodObject>(
  name: string,
  description: string,
  args: T,
  run: (context: PluginContext, input: z.infer<T>) => Promise<unknown>,
): PluginToolDefinition {
  const { $schema, ...parameters } = z.toJSONSchema(args);
  return {
    name,
    description,
    args,
    parameters,
    runsOn: "server",
    async run(context, input) {
      try {
        return await run(context, input);
      } catch (error) {
        if (error instanceof HttpError) throw error;
        if (
          error instanceof OpenAI.APIError &&
          error.status === 402 &&
          [
            "insufficient_credits",
            "credit_configuration",
            "credit_account",
          ].includes(error.code ?? "")
        )
          throw new CreditError(
            error.code as
              | "insufficient_credits"
              | "credit_configuration"
              | "credit_account",
          );
        if (error instanceof ElevenLabsError && error.code === "quota_exceeded")
          throw new HttpError(
            502,
            "The ElevenLabs account is out of credits (quota_exceeded). Tell the founder; do not retry until it is topped up or the quota resets.",
          );
        if (
          error instanceof ElevenLabsError ||
          error instanceof OpenAI.APIError
        )
          throw new HttpError(
            502,
            `Media provider request failed (HTTP ${error.status ?? "unknown"}${error instanceof ElevenLabsError && error.code ? `, ${error.code}` : ""}). Check account access, quota or the request. Do not automatically repeat this paid request.`,
          );
        throw new HttpError(
          context.signal?.aborted ? 408 : 502,
          "Media generation did not finish. It may already have been billed; do not automatically retry. Report the failure to the founder.",
        );
      }
    },
  };
}

const imageArgs = imageOptionsSchema.extend({ title }).strict();
export const mediaPlugin: PluginDefinition = {
  code: "media",
  name: "Media creation",
  description:
    "Generate and edit images; make speech, music and sound effects; transcribe audio. Saved results can be played and downloaded in chat or Inbox.",
  skills: [loadSkill(new URL("./skills/media-create/", import.meta.url))],
  tools: [
    mediaTool(
      "media_generate_image",
      "Generate one saved image. Defaults to square, medium quality; returns an attachment and a reusable file ref.",
      imageArgs,
      async (context, { title, ...args }) => {
        const result = await imageProvider().generateImage(
          args,
          requestOptions(context),
        );
        return {
          ...(await attachment(context, title, result)),
          usage: result.usage,
        };
      },
    ),
    mediaTool(
      "media_edit_image",
      "Edit a saved image using its ref; optionally supply a saved PNG mask. Saves a new image and preserves the original.",
      imageArgs.extend({ file: text, mask_file: text.optional() }).strict(),
      async (context, { title, file, mask_file, ...args }) => {
        const provider = imageProvider();
        if (mask_file && !provider.supportsMask)
          throw new HttpError(
            400,
            "This image model edits from the prompt alone. Describe the area to change in the prompt and leave out mask_file.",
          );
        const image = await ownedBlob(context, file, "image");
        const mask = mask_file
          ? await ownedBlob(context, mask_file, "image")
          : undefined;
        return attachment(
          context,
          title,
          await provider.editImage(
            { ...args, image, mask },
            requestOptions(context),
          ),
        );
      },
    ),
    mediaTool(
      "media_list_voices",
      "Search available ElevenLabs voices before making speech. Use a returned voice_id. Supports paginated results.",
      z
        .object({
          search: text.max(200).optional(),
          pageSize: z.number().int().min(1).max(100).optional(),
          nextPageToken: text.optional(),
        })
        .strict(),
      async (context, args) => {
        const page = await audioProvider().listVoices(args, {
          signal: context.signal,
        });
        return {
          voices: page.voices.map((voice) => ({
            voice_id: voice.voice_id,
            name: voice.name,
            labels: voice.labels,
            description: voice.description?.slice(0, 160),
          })),
          has_more: page.has_more,
          next_page_token: page.next_page_token,
        };
      },
    ),
    mediaTool(
      "media_generate_speech",
      "Speak the supplied script with an available voice_id. Returns an MP3; does not clone voices.",
      z
        .object({
          title,
          text: text.max(5000),
          voice_id: text,
          speed: z.number().min(0.7).max(1.2).optional(),
        })
        .strict(),
      async (context, args) =>
        attachment(
          context,
          args.title,
          await audioProvider().generateSpeech(
            {
              text: args.text,
              voiceId: args.voice_id,
              modelId: "eleven_multilingual_v2",
              voiceSettings:
                args.speed === undefined ? undefined : { speed: args.speed },
            },
            { signal: context.signal },
          ),
        ),
    ),
    mediaTool(
      "media_generate_music",
      "Create a 3–60 second music track. Defaults to instrumental. Returns a saved MP3.",
      z
        .object({
          title,
          prompt: text.max(4100),
          duration_seconds: z.number().min(3).max(60),
          instrumental: z.boolean().optional(),
        })
        .strict(),
      async (context, args) =>
        attachment(
          context,
          args.title,
          await audioProvider().generateMusic(
            {
              prompt: args.prompt,
              modelId: "music_v1",
              durationMs: Math.round(args.duration_seconds * 1000),
              instrumental: args.instrumental ?? true,
            },
            { signal: context.signal },
          ),
        ),
    ),
    mediaTool(
      "media_generate_sound_effect",
      "Create a 0.5–30 second sound effect and save it as an MP3.",
      z
        .object({
          title,
          text: text.max(2000),
          duration_seconds: z.number().min(0.5).max(30),
          loop: z.boolean().optional(),
        })
        .strict(),
      async (context, args) =>
        attachment(
          context,
          args.title,
          await audioProvider().generateSoundEffect(
            {
              text: args.text,
              modelId: "eleven_text_to_sound_v2",
              durationSeconds: args.duration_seconds,
              loop: args.loop,
            },
            { signal: context.signal },
          ),
        ),
    ),
    mediaTool(
      "media_transcribe",
      "Transcribe saved audio or an HTTPS media URL. Supply exactly one of file/source_url. Returns text, word times and optional speakers.",
      z
        .object({
          file: text.optional(),
          source_url: z.url({ protocol: /^https$/ }).optional(),
          diarize: z.boolean().optional(),
          language_code: text.optional(),
        })
        .strict(),
      async (context, args) => {
        if (!!args.file === !!args.source_url)
          throw new HttpError(
            400,
            "Provide exactly one of file or source_url.",
          );
        const provider = audioProvider();
        const settings = {
          modelId: "scribe_v2",
          diarize: args.diarize,
          languageCode: args.language_code,
          timestampsGranularity: "word" as const,
        };
        return provider.transcribe(
          args.file
            ? {
                ...settings,
                file: await ownedBlob(context, args.file, "audio"),
                filename: "audio.mp3",
              }
            : { ...settings, sourceUrl: args.source_url! },
          { signal: context.signal },
        );
      },
    ),
  ],
};
