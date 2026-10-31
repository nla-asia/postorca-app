import { open } from "node:fs/promises";
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
import { filePath } from "../../storage.js";
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
              .describe("Saved image ref; omit for a text card or a clip."),
            video_file: file
              .optional()
              .describe(
                "Saved video ref (a recorded clip), played muted instead of an image.",
              ),
            start_seconds: z
              .number()
              .min(0)
              .optional()
              .describe("Clip only: where to start in the clip (default 0)."),
            end_seconds: z
              .number()
              .min(0)
              .optional()
              .describe("Clip only: where to stop (default the clip's end)."),
            speed: z
              .number()
              .min(0.5)
              .max(4)
              .optional()
              .describe("Clip only: playback speed; 2 plays twice as fast."),
            hold_seconds: z
              .number()
              .min(0)
              .max(10)
              .optional()
              .describe("Clip only: freeze the last frame this long."),
            text: z
              .string()
              .trim()
              .max(120)
              .optional()
              .describe(
                "Headline sticker over an image or clip, or a text card without either.",
              ),
            says: z
              .string()
              .trim()
              .min(1)
              .max(200)
              .optional()
              .describe(
                "With voiceover_file: the first words of the voiceover this scene goes with, as spoken. The scene starts when they are spoken; the scene before it is held or cut to fit.",
              ),
            duration_seconds: z
              .number()
              .min(0.5)
              .max(60)
              .optional()
              .describe(
                "Required without video_file. For a clip, omit it to play the trimmed part at its speed, plus hold_seconds.",
              ),
            fit: z
              .enum(["cover", "contain"])
              .optional()
              .describe(
                "cover fills/crops; contain shows the whole image or clip over a blurred background. Stickers and captions sit over cover content; in 16:9, 1:1 and 4:5, contain or a device frame gives them their own space above and below instead. In 9:16 they always sit over the content.",
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
                "Zoom into this region; coordinates are fractions of the original image or video frame.",
              ),
            highlight: region
              .optional()
              .describe("Outline this region and dim the surrounding content."),
          })
          .strict()
          .refine(
            (scene) => !!(scene.image_file || scene.video_file || scene.text),
            { message: "A scene needs an image_file, video_file or text." },
          )
          .refine((scene) => !(scene.image_file && scene.video_file), {
            message: "Use image_file or video_file in a scene, not both.",
          })
          .refine(
            (scene) =>
              !!scene.video_file ||
              (scene.start_seconds ??
                scene.end_seconds ??
                scene.speed ??
                scene.hold_seconds) === undefined,
            {
              message:
                "start_seconds, end_seconds, speed and hold_seconds apply only to a video_file scene.",
            },
          )
          .refine(
            (scene) =>
              !!scene.video_file || scene.duration_seconds !== undefined,
            { message: "An image or text scene needs duration_seconds." },
          )
          .refine(
            (scene) =>
              scene.end_seconds === undefined ||
              scene.end_seconds > (scene.start_seconds ?? 0),
            { message: "end_seconds must be after start_seconds." },
          ),
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
    voiceover_script: z
      .string()
      .trim()
      .max(5000)
      .optional()
      .describe(
        "The text the voiceover was generated from. Captions and `says` then use its exact words instead of what transcription heard.",
      ),
    brand: brandColorsSchema
      .optional()
      .describe(
        "Override saved brand colours only when the founder requests it.",
      ),
  })
  .strict();
type Clip = z.infer<typeof clipArgs>;
type SceneArgs = Clip["scenes"][number];

/** Length in seconds of an MP4/QuickTime file, from its movie header; null when absent. */
export async function mp4Seconds(path: string) {
  return (await mp4Info(path))?.seconds ?? null;
}

/** An MP4's duration and its video track's size, read from its header without decoding. */
export async function mp4Info(path: string) {
  const handle = await open(path, "r");
  try {
    const { size } = await handle.stat();
    const header = Buffer.alloc(16);
    async function boxes(type: string, start: number, end: number) {
      const found: { start: number; end: number }[] = [];
      for (let offset = start; offset + 8 <= end;) {
        await handle.read(header, 0, 16, offset);
        let length = header.readUInt32BE(0),
          body = 8;
        if (length === 1) {
          length = Number(header.readBigUInt64BE(8));
          body = 16;
        } else if (length === 0) length = end - offset;
        if (length < body) break;
        if (header.toString("latin1", 4, 8) === type)
          found.push({ start: offset + body, end: offset + length });
        offset += length;
      }
      return found;
    }
    const [moov] = await boxes("moov", 0, size);
    const [mvhd] = moov ? await boxes("mvhd", moov.start, moov.end) : [];
    if (!mvhd) return null;
    const box = Buffer.alloc(32);
    await handle.read(box, 0, 32, mvhd.start);
    const [scale, duration] =
      box[0] === 1
        ? [box.readUInt32BE(20), Number(box.readBigUInt64BE(24))]
        : [box.readUInt32BE(12), box.readUInt32BE(16)];
    let width = 0,
      height = 0;
    // The first track with a size is the video; width and height are 16.16 fixed point.
    for (const trak of await boxes("trak", moov.start, moov.end)) {
      const [tkhd] = await boxes("tkhd", trak.start, trak.end);
      if (!tkhd) continue;
      const head = Buffer.alloc(96);
      await handle.read(head, 0, 96, tkhd.start);
      const at = head[0] === 1 ? 88 : 76;
      width = head.readUInt32BE(at) / 65536;
      height = head.readUInt32BE(at + 4) / 65536;
      if (width && height) break;
    }
    return {
      seconds: scale ? duration / scale : null,
      ...(width && height ? { width, height } : {}),
    };
  } finally {
    await handle.close();
  }
}

/** How long the video runs on after the voiceover ends, when that is more than an end card's hold. */
export function silentTail(totalMs: number, speechMs: number) {
  const tail = (totalMs - speechMs) / 1000;
  return tail > 3.5
    ? `The video runs ${tail.toFixed(1)} s after the voiceover ends; nothing is said over that. Beyond an end card held 2–3 s, trim the last clip (end_seconds), shorten holds, or move lines later so the voice covers the picture.`
    : undefined;
}

/**
 * Recording scenes whose focus is far from the frame's shape: only the focus shows, so
 * the rest of the frame is blur. The frame here is the space above the captions.
 */
export function framingNotes(
  scenes: {
    focus?: { width: number; height: number };
    aspect?: number | null;
  }[],
  format: string,
) {
  const [w, h] = format.split(":").map(Number);
  const frame = (w / h) * (format === "9:16" ? 1 : 1.2);
  // Only clip scenes carry an aspect here.
  const whole = scenes.flatMap((scene, index) =>
    scene.aspect && !scene.focus ? [index + 1] : [],
  );
  const unfocused = whole.length
    ? [
        `Scene${whole.length > 1 ? "s" : ""} ${whole.join(", ")} show${whole.length > 1 ? "" : "s"} the whole recording: whatever was captured around the app (browser tabs and address bar, banners, the desktop) shows, and the app is smaller. Give each a focus: the app itself inside those bars for an overview, or the part in action.`,
      ]
    : [];
  // A focus on most of the recording is an overview: once sets the scene, but in every
  // shot nothing stands out and the text stays small.
  const overviews = scenes.flatMap((scene, index) =>
    scene.aspect && scene.focus && scene.focus.width * scene.focus.height > 0.6
      ? [index + 1]
      : [],
  );
  const zoom =
    overviews.length > 1
      ? [
          `Scenes ${overviews.join(", ")} each show the whole app, so nothing in them stands out and its text stays small. Show it whole once to set the scene, then zoom in: focus each later scene on what its line is about (the field being filled, the number that changes, the status that appears).`,
        ]
      : [];
  return unfocused.concat(
    zoom,
    scenes.flatMap((scene, index) => {
      if (!scene.focus || !scene.aspect) return [];
      const box = (scene.focus.width * scene.aspect) / scene.focus.height;
      const fills = Math.min(box / frame, frame / box);
      return fills < 0.5
        ? [
            `Scene ${index + 1}'s focus is ${box.toFixed(1)}:1 in a ${frame.toFixed(1)}:1 frame, so it fills only ${Math.round(fills * 100)}% of it and shows small. Make it ${box > frame ? "taller" : "wider"}, closer to the frame's shape, keeping the elements the scene needs.`,
          ]
        : [];
    }),
  );
}

/** Clip scenes, numbered from 1, that show their recording with no focus or device frame. */
export function unframedClips(scenes: { video_file?: string; focus?: unknown; device?: unknown }[]) {
  return scenes.flatMap((scene, index) =>
    scene.video_file && !scene.focus && !scene.device ? [index + 1] : [],
  );
}

/**
 * Trim, speed and hold of a clip scene, and its length: duration_seconds when given,
 * otherwise the trimmed part at its speed plus the hold.
 */
export function clipTiming(scene: SceneArgs, clipSeconds: number | null) {
  const start = scene.start_seconds ?? 0;
  const speed = scene.speed ?? 1;
  const length =
    clipSeconds === null ? null : Math.round(clipSeconds * 100) / 100;
  if (length !== null && start >= length - 0.1)
    throw new HttpError(
      400,
      `start_seconds ${start} is at or past the end of clip ${scene.video_file}, which is ${length} s long.`,
    );
  if (
    length !== null &&
    scene.end_seconds !== undefined &&
    scene.end_seconds > length + 0.05
  )
    throw new HttpError(
      400,
      `end_seconds ${scene.end_seconds} is past the end of clip ${scene.video_file}, which is ${length} s long. Use at most ${length}, or omit end_seconds.`,
    );
  const end = scene.end_seconds ?? length;
  if (end === null)
    throw new HttpError(
      400,
      `The length of clip ${scene.video_file} is unknown; pass end_seconds.`,
    );
  const hold = scene.hold_seconds ?? 0;
  const seconds = scene.duration_seconds ?? (end - start) / speed + hold;
  if (seconds < 0.5)
    throw new HttpError(
      400,
      `The clip scene on ${scene.video_file} would last ${seconds.toFixed(2)} s; a scene needs at least 0.5 s. Widen the trim, lower the speed or add hold_seconds.`,
    );
  if (seconds > 60)
    throw new HttpError(
      400,
      `The clip scene on ${scene.video_file} would last ${seconds.toFixed(1)} s; a scene is at most 60 s. Trim it, raise the speed or split it into scenes.`,
    );
  return {
    start_ms: Math.round(start * 1000),
    end_ms: Math.round(end * 1000),
    speed,
    duration_ms: Math.round(seconds * 1000),
  };
}

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

/**
 * Keeps the transcript's timing but the script's words: transcription mishears
 * ("in Streaks" as "and streaks"). Words that don't line up one to one are left alone.
 */
export function transcriptWithScript(
  transcript: Transcript,
  script: string,
): Transcript {
  const heard = (transcript.words ?? []).flatMap((word, index) =>
    word.type === "word" ? [{ index, key: spokenWord(word.text) }] : [],
  );
  const written = script.split(/\s+/).filter((word) => spokenWord(word));
  const keys = written.map(spokenWord);
  // Longest common subsequence of the two word lists.
  const table = Array.from({ length: heard.length + 1 }, () =>
    new Array<number>(keys.length + 1).fill(0),
  );
  for (let a = heard.length - 1; a >= 0; a--)
    for (let b = keys.length - 1; b >= 0; b--)
      table[a][b] =
        heard[a].key === keys[b]
          ? table[a + 1][b + 1] + 1
          : Math.max(table[a + 1][b], table[a][b + 1]);
  const words = [...(transcript.words ?? [])];
  const replace = (a: number, b: number) => {
    words[heard[a].index] = { ...words[heard[a].index], text: written[b] };
  };
  let a = 0,
    b = 0;
  while (a < heard.length && b < keys.length) {
    if (heard[a].key === keys[b]) replace(a++, b++);
    else {
      const gapA = a,
        gapB = b;
      while (a < heard.length && b < keys.length && heard[a].key !== keys[b]) {
        if (table[a + 1][b] >= table[a][b + 1]) a++;
        else b++;
      }
      if (a - gapA === b - gapB)
        for (let i = 0; i < a - gapA; i++) replace(gapA + i, gapB + i);
    }
  }
  if (heard.length - a === keys.length - b)
    while (a < heard.length) replace(a++, b++);
  return { ...transcript, words };
}

const spokenWord = (text: string) =>
  text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/** Moves each scene that declares `says` to the moment those words are spoken. */
export function alignScenes(
  scenes: { says?: string }[],
  durations: number[],
  transcript: Transcript,
) {
  const words = (transcript.words ?? []).filter((w) => w.type === "word");
  const spoken = words.map((w) => spokenWord(w.text));
  const aligned = [...durations];
  let from = 0;
  let elapsed = 0;
  scenes.forEach((scene, index) => {
    if (scene.says) {
      const wanted = scene.says.split(/\s+/).map(spokenWord).filter(Boolean);
      let at = -1;
      for (let i = from; at < 0 && i + wanted.length <= spoken.length; i++)
        if (wanted.every((word, n) => spoken[i + n] === word)) at = i;
      if (at < 0)
        throw new HttpError(
          400,
          `Scene ${index + 1} says "${scene.says}", which is not spoken after the previous scene's words. Quote the voiceover exactly and keep scenes in spoken order. It says: ${voiceoverLines(
            transcript,
          )
            .map((line) => line.text)
            .join(" ")}`,
        );
      from = at + wanted.length;
      const target = Math.round((words[at].start ?? 0) * 1000);
      if (index > 0) {
        const previous = aligned[index - 1] + target - elapsed;
        if (previous < 500)
          throw new HttpError(
            400,
            `Scene ${index} would last ${(previous / 1000).toFixed(2)} s because scene ${index + 1}'s words start at ${(target / 1000).toFixed(1)} s; a scene needs at least 0.5 s. Remove a scene or say something earlier.`,
          );
        aligned[index - 1] = previous;
        elapsed = target;
      }
    }
    elapsed += aligned[index];
  });
  return aligned;
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
  const videos = new Map<
    string,
    { key: string; seconds: number | null; aspect: number | null }
  >();
  for (const scene of clip.scenes) {
    if (scene.image_file && !images.has(scene.image_file))
      images.set(
        scene.image_file,
        await ownedFile(context, scene.image_file, "image"),
      );
    if (scene.video_file && !videos.has(scene.video_file)) {
      const key = await ownedFile(context, scene.video_file, "video");
      const info = await mp4Info(filePath(key)).catch(() => null);
      videos.set(scene.video_file, {
        key,
        seconds: info?.seconds ?? null,
        aspect: info?.width && info.height ? info.width / info.height : null,
      });
    }
  }
  const voice = clip.voiceover_file
    ? await ownedFile(context, clip.voiceover_file, "audio")
    : undefined;
  const music = clip.music
    ? await ownedFile(context, clip.music.file, "audio")
    : undefined;
  const clips = clip.scenes.map((scene) =>
    scene.video_file
      ? clipTiming(scene, videos.get(scene.video_file)!.seconds)
      : undefined,
  );
  const heard = voice ? await transcriptFor(context, voice) : undefined;
  const transcript =
    heard && clip.voiceover_script
      ? transcriptWithScript(heard, clip.voiceover_script)
      : heard;
  const planned = clip.scenes.map(
    (scene, index) =>
      clips[index]?.duration_ms ?? Math.round(scene.duration_seconds! * 1000),
  );
  const durations = transcript
    ? alignScenes(clip.scenes, planned, transcript)
    : planned;
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
  const format = clip.format ?? "9:16";
  return {
    render: {
      format: clip.format,
      scenes: clip.scenes.map((scene, index) => ({
        file: scene.video_file
          ? videos.get(scene.video_file)!.key
          : scene.image_file
            ? images.get(scene.image_file)
            : undefined,
        text: scene.text || undefined,
        duration_ms: durations[index],
        ...(clips[index] && {
          start_ms: clips[index].start_ms,
          end_ms: clips[index].end_ms,
          speed: clips[index].speed,
        }),
        // A screen recording is shown whole, never cropped: outside portrait, contain.
        // It fills the frame's height, with stickers and captions over it and a focus
        // kept clear of the captions.
        fit:
          scene.fit ??
          (scene.video_file && !scene.device && format !== "9:16"
            ? "contain"
            : undefined),
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
      ...(clip.scenes.some((scene) => scene.says) && {
        scene_starts: clip.scenes.map((scene, index) => ({
          scene: index + 1,
          at_seconds:
            Math.round(
              durations.slice(0, index).reduce((sum, ms) => sum + ms, 0) / 100,
            ) / 10,
          ...(scene.says && { says: scene.says }),
        })),
      }),
      ...(extension > 0 && {
        note: `The last scene was extended by ${(extension / 1000).toFixed(1)} s to cover the voiceover.`,
      }),
      ...(transcript &&
        silentTail(totalMs, speechMs) && {
          silent_tail: silentTail(totalMs, speechMs),
        }),
      ...(() => {
        const framing = framingNotes(
          clip.scenes.map((scene) => ({
            focus: scene.focus,
            aspect: scene.video_file
              ? videos.get(scene.video_file)!.aspect
              : null,
          })),
          format,
        );
        return framing.length ? { framing } : {};
      })(),
      // Viewers need longer to read a screen recording than to take in a photo.
      ...(totalMs / shots >
        (clip.scenes.some((scene) => scene.video_file) ? 5000 : 3000) && {
        pacing: `Shots average ${(totalMs / shots / 1000).toFixed(1)} s; consecutive scenes on the same image are one shot; each clip scene is a shot. UGC usually changes shot every 2–3 s, and a screen recording at most every 5 s. Alternate images, or trim and speed up clips, for faster cuts.`,
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
        const preview = name === "video_preview_frames";
        // An export says how each recording is framed; a preview may look at it raw.
        const unframed = preview ? [] : unframedClips(clip.scenes);
        if (unframed.length)
          throw new HttpError(
            400,
            `Scene${unframed.length > 1 ? "s" : ""} ${unframed.join(", ")} show${unframed.length > 1 ? "" : "s"} a recording with no focus. Give every clip scene a focus: the app inside whatever was captured around it (browser bars, banners, the desktop) for an overview, the whole frame (0, 0, 1, 1) if the recording is only the app, or the part in action. Preview, then export.`,
          );
        const { render, timing } = await prepare(context, clip);
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
    "Compose UGC and product-demo videos from images, recorded clips, text, voiceover, captions and optional music. Preview frames and export an MP4 on the founder's desktop; includes the media generation tools it needs.",
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
