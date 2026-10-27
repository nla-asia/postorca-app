import { z } from "zod";
import { callDesktop } from "../../desktop/calls.js";
import { HttpError } from "../../handlers/errors.js";
import {
  createElevenLabsProviderFromEnv,
  ElevenLabsError,
  type Transcript,
} from "../../providers/elevenlabs.js";
import { brandColors } from "../../repositories/brand.js";
import { brandColorsSchema } from "../../schemas/brand.js";
import { loadSkill } from "../../skills/load.js";
import { mediaPlugin, ownedBlob, ownedFile } from "../media/index.js";
import type {
  PluginContext,
  PluginDefinition,
  PluginToolDefinition,
} from "../types.js";

const file = z.string().trim().min(1);
const region = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().min(0.02).max(1),
    height: z.number().min(0.02).max(1),
  })
  .strict();
const clipArgs = z
  .object({
    format: z
      .enum(["9:16", "4:5", "1:1", "16:9"])
      .optional()
      .describe("9:16 by default; also feed, square or landscape."),
    scenes: z
      .array(
        z
          .object({
            image_file: file
              .optional()
              .describe("Saved image ref; omit for a text card."),
            text: z
              .string()
              .trim()
              .max(120)
              .optional()
              .describe(
                "Headline sticker over an image, or a text card without an image.",
              ),
            duration_seconds: z.number().min(0.5).max(60),
            fit: z
              .enum(["cover", "contain"])
              .optional()
              .describe(
                "cover fills/crops; contain shows the whole image over a blurred background.",
              ),
            device: z
              .enum(["browser", "laptop", "phone"])
              .optional()
              .describe(
                "Frame bare screen content in a device; avoid doubling an existing frame.",
              ),
            focus: region
              .optional()
              .describe(
                "Zoom into this image region; coordinates are fractions of the original image.",
              ),
            highlight: region
              .optional()
              .describe(
                "Outline this image region and dim the surrounding content.",
              ),
          })
          .strict()
          .refine((scene) => !!(scene.image_file || scene.text), {
            message: "A scene needs an image_file, text, or both.",
          }),
      )
      .min(1)
      .max(40),
    voiceover_file: file.optional(),
    music: z
      .object({
        file,
        volume: z.number().min(0.05).max(1).optional(),
        start_seconds: z.number().min(0).optional(),
        fade_in_seconds: z.number().min(0).max(5).optional(),
        fade_out_seconds: z.number().min(0).max(5).optional(),
        duck: z
          .boolean()
          .optional()
          .describe(
            "Lower music during speech, raising it in pauses. Defaults to true.",
          ),
      })
      .strict()
      .nullable()
      .optional(),
    captions: z.boolean().optional(),
    brand: brandColorsSchema
      .optional()
      .describe(
        "Override saved brand colours only when the founder requests it.",
      ),
  })
  .strict();
type Clip = z.infer<typeof clipArgs>;

// Immutable saved files share a transcript between previews and exports in this process.
const transcripts = new Map<string, Promise<Transcript>>();
function transcriptFor(context: PluginContext, key: string) {
  const cached = transcripts.get(key);
  if (cached) return cached;
  const provider = createElevenLabsProviderFromEnv();
  if (!provider)
    throw new HttpError(
      503,
      "Voiceovers need transcription. Set ELEVENLABS_API_KEY on the server.",
    );
  const pending = ownedBlob(context, key, "audio").then((blob) =>
    provider.transcribe(
      {
        file: blob,
        filename: "voiceover.mp3",
        modelId: "scribe_v2",
        timestampsGranularity: "word",
      },
      { signal: context.signal },
    ),
  );
  transcripts.set(key, pending);
  void pending.catch(() => transcripts.delete(key));
  if (transcripts.size > 100)
    transcripts.delete(transcripts.keys().next().value!);
  return pending;
}

function speechRanges(transcript: Transcript) {
  const ranges: [number, number][] = [];
  for (const word of transcript.words ?? []) {
    if (word.type !== "word") continue;
    const start = Math.round((word.start ?? 0) * 1000);
    const end = Math.round((word.end ?? word.start ?? 0) * 1000);
    const previous = ranges.at(-1);
    if (previous && start - previous[1] < 700)
      previous[1] = Math.max(previous[1], end);
    else ranges.push([start, end]);
  }
  return ranges;
}

function voiceoverLines(transcript: Transcript) {
  const lines: { at_seconds: number; text: string }[] = [];
  let current: (typeof lines)[number] | undefined;
  for (const word of transcript.words ?? []) {
    if (word.type !== "word") {
      if (current) current.text += word.text;
      continue;
    }
    if (!current) {
      current = {
        at_seconds: Math.round((word.start ?? 0) * 10) / 10,
        text: "",
      };
      lines.push(current);
    }
    current.text += word.text;
    if (/[.!?,;:]["”’)]*$/.test(word.text)) current = undefined;
  }
  return lines.map((line) => ({ ...line, text: line.text.trim() }));
}

async function prepare(context: PluginContext, clip: Clip) {
  const images = new Map<string, string>();
  for (const scene of clip.scenes)
    if (scene.image_file && !images.has(scene.image_file))
      images.set(
        scene.image_file,
        await ownedFile(context, scene.image_file, "image"),
      );
  const voice = clip.voiceover_file
    ? await ownedFile(context, clip.voiceover_file, "audio")
    : undefined;
  const music = clip.music
    ? await ownedFile(context, clip.music.file, "audio")
    : undefined;
  const durations = clip.scenes.map((scene) =>
    Math.round(scene.duration_seconds * 1000),
  );
  const transcript = voice ? await transcriptFor(context, voice) : undefined;
  const originalMs = durations.reduce((sum, value) => sum + value, 0);
  const speechMs = transcript
    ? Math.max(0, ...(transcript.words ?? []).map((word) => word.end ?? 0)) *
      1000
    : 0;
  const extension = transcript
    ? Math.max(0, Math.ceil(speechMs + 600 - originalMs))
    : 0;
  durations[durations.length - 1] += extension;
  const totalMs = originalMs + extension;
  if (totalMs > 90_000)
    throw new HttpError(
      400,
      `The video would run ${(totalMs / 1000).toFixed(1)} s; the limit is 90 s. Shorten the scenes or the voiceover.`,
    );
  const colors = await brandColors(context.db, context.userId);
  const brand = { ...colors, ...clip.brand };
  const shots = clip.scenes.filter(
    (scene, index, scenes) =>
      index === 0 ||
      !scene.image_file ||
      scene.image_file !== scenes[index - 1].image_file ||
      JSON.stringify(scene.focus ?? null) !==
        JSON.stringify(scenes[index - 1].focus ?? null),
  ).length;
  return {
    render: {
      format: clip.format,
      scenes: clip.scenes.map((scene, index) => ({
        file: scene.image_file ? images.get(scene.image_file) : undefined,
        text: scene.text || undefined,
        duration_ms: durations[index],
        fit: scene.fit,
        device: scene.device,
        focus: scene.focus,
        highlight: scene.highlight,
      })),
      voiceover_file: voice,
      music: clip.music && {
        file: music,
        volume: clip.music.volume ?? (voice ? 0.15 : 0.6),
        start_ms: Math.round((clip.music.start_seconds ?? 0) * 1000),
        fade_in_ms: Math.round((clip.music.fade_in_seconds ?? 0.5) * 1000),
        fade_out_ms: Math.round((clip.music.fade_out_seconds ?? 1) * 1000),
        voice_ranges_ms:
          transcript && (clip.music.duck ?? true)
            ? speechRanges(transcript)
            : undefined,
      },
      transcript: (clip.captions ?? true) ? transcript : undefined,
      brand,
    },
    timing: {
      duration_seconds: totalMs / 1000,
      brand_colors: Object.keys(colors).length
        ? brand
        : "No brand colours are saved in the Brand Profile; template defaults were used.",
      ...(transcript && { voiceover_lines: voiceoverLines(transcript) }),
      ...(extension > 0 && {
        note: `The last scene was extended by ${(extension / 1000).toFixed(1)} s to cover the voiceover.`,
      }),
      ...(totalMs / shots > 3000 && {
        pacing: `Shots average ${(totalMs / shots / 1000).toFixed(1)} s; consecutive scenes on the same image are one shot. UGC usually changes shot every 2–3 s. Alternate images for faster cuts.`,
      }),
    },
  };
}

function videoTool(
  name: string,
  description: string,
  args: z.ZodObject,
  timeoutMs: number,
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
        const { title, times_seconds, ...clip } = input;
        const { render, timing } = await prepare(context, clip);
        const preview = name === "video_preview_frames";
        const times: number[] = preview ? times_seconds.slice(0, 8) : [];
        const result = await callDesktop(
          context,
          name,
          { timeoutMs },
          {
            ...render,
            ...(preview
              ? { times_ms: times.map((time) => time * 1000) }
              : { title }),
          },
        );
        return {
          ...(result as object),
          ...timing,
          ...(preview &&
            times_seconds.length > times.length && {
              skipped_times: `Only the first 8 times were rendered; ${times_seconds.slice(8).join(", ")} s were skipped.`,
            }),
          ...(!preview && {
            message:
              "The video appears in this conversation. Deliver its saved ref with create_artifact; do not embed internal file keys as Markdown URLs.",
          }),
        };
      } catch (error) {
        if (error instanceof ElevenLabsError)
          throw new HttpError(
            502,
            `Voiceover transcription failed (HTTP ${error.status ?? "unknown"}${error.code ? `, ${error.code}` : ""}). Do not automatically repeat this paid request.`,
          );
        throw error;
      }
    },
  };
}

const sharedMedia = new Set([
  "media_generate_image",
  "media_edit_image",
  "media_list_voices",
  "media_generate_speech",
  "media_generate_music",
]);
export const videoPlugin: PluginDefinition = {
  code: "video",
  name: "Video",
  description:
    "Compose UGC and product-demo videos from images, text, voiceover, captions and optional music. Preview frames and export an MP4 on the founder's desktop; includes the media generation tools it needs.",
  skills: [
    "video-create",
    "video-product-demo",
    "video-pov-storytime",
    "video-build-log",
    "video-lesson",
    "video-product-update",
    "video-event-invite",
    "video-post-to-video",
    "video-music",
  ].map((name) => loadSkill(new URL(`./skills/${name}/`, import.meta.url))),
  tools: [
    videoTool(
      "video_preview_frames",
      "Inspect still previews before exporting. Renders at most 8 chosen times; requires the desktop app.",
      clipArgs
        .extend({
          times_seconds: z.array(z.number().min(0)).min(1).max(30),
          title: z.string().optional(),
        })
        .strict(),
      180_000,
    ),
    videoTool(
      "video_export",
      "Export an MP4 at 30 fps in the selected format (default 1080×1920). Requires the desktop app; returns a saved attachment.",
      clipArgs.extend({ title: z.string().trim().min(1).max(200) }).strict(),
      600_000,
    ),
    ...mediaPlugin.tools.filter((tool) => sharedMedia.has(tool.name)),
  ],
};
