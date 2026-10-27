import { z } from "zod";

const text = z.string().trim().min(1);
const unit = z.number().min(0).max(1);
const speech = z
  .object({
    text,
    voiceId: text,
    modelId: text,
    languageCode: text.optional(),
    voiceSettings: z
      .object({
        stability: unit.optional(),
        similarity_boost: unit.optional(),
        style: unit.optional(),
        use_speaker_boost: z.boolean().optional(),
        speed: z.number().min(0.7).max(1.2).optional(),
      })
      .strict()
      .optional(),
    seed: z.number().int().min(0).max(4294967295).optional(),
  })
  .strict();
const music = z
  .object({
    prompt: text.max(4100),
    modelId: z.enum(["music_v1", "music_v2", "music_v2_5"]),
    durationMs: z.number().int().min(3000).max(600000),
    instrumental: z.boolean().optional(),
  })
  .strict();
const effect = z
  .object({
    text,
    modelId: z.enum(["eleven_text_to_sound_v2", "eleven_text_to_sound_v3"]),
    durationSeconds: z.number().min(0.5).max(30).optional(),
    promptInfluence: unit.optional(),
    loop: z.boolean().optional(),
  })
  .strict();
const transcription = z
  .object({
    modelId: text,
    languageCode: text.optional(),
    diarize: z.boolean().optional(),
    numSpeakers: z.number().int().min(1).max(32).optional(),
    tagAudioEvents: z.boolean().optional(),
    timestampsGranularity: z.enum(["none", "word", "character"]).optional(),
  })
  .strict();
const transcriptSchema = z
  .object({
    text: z.string(),
    language_code: z.string(),
    language_probability: z.number().optional(),
    words: z
      .array(
        z
          .object({
            text: z.string(),
            type: z.string(),
            start: z.number().nullable().optional(),
            end: z.number().nullable().optional(),
            speaker_id: z.string().nullable().optional(),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();
export type Transcript = z.infer<typeof transcriptSchema>;
export type TranscriptionInput = z.input<typeof transcription> &
  (
    | { file: Blob; filename: string; sourceUrl?: never }
    | { sourceUrl: string; file?: never; filename?: never }
  );
export type ElevenLabsRequestOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
};
const voicesSchema = z
  .object({
    voices: z.array(
      z
        .object({
          voice_id: z.string(),
          name: z.string().nullable().optional(),
          description: z.string().nullable().optional(),
          preview_url: z.string().nullable().optional(),
        })
        .passthrough(),
    ),
    has_more: z.boolean(),
    next_page_token: z.string().nullable().optional(),
  })
  .passthrough();

export class ElevenLabsError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly requestId: string | null = null,
    readonly retryAfter: string | null = null,
    readonly code: string | null = null,
  ) {
    super(message);
    this.name = "ElevenLabsError";
  }
}

/** One request per invocation: retrying an interrupted paid request can charge twice. */
export class ElevenLabsProvider {
  #key: string;
  constructor(key: string) {
    if (!key.trim()) throw new Error("ELEVENLABS_API_KEY is required.");
    this.#key = key.trim();
  }

  async listVoices(
    input: { search?: string; pageSize?: number; nextPageToken?: string } = {},
    options?: ElevenLabsRequestOptions,
  ) {
    const args = z
      .object({
        search: text.optional(),
        pageSize: z.number().int().min(1).max(100).optional(),
        nextPageToken: text.optional(),
      })
      .strict()
      .parse(input);
    const query = new URLSearchParams({ include_total_count: "false" });
    for (const [name, value] of Object.entries({
      search: args.search,
      page_size: args.pageSize,
      next_page_token: args.nextPageToken,
    }))
      if (value !== undefined) query.set(name, String(value));
    return this.request(`/v2/voices?${query}`, {}, options, (response) =>
      this.json(response, voicesSchema),
    );
  }

  async listModels(options?: ElevenLabsRequestOptions) {
    return this.request("/v1/models", {}, options, (response) =>
      this.json(
        response,
        z.array(
          z
            .object({
              model_id: z.string(),
              name: z.string().optional(),
              can_do_text_to_speech: z.boolean().optional(),
            })
            .passthrough(),
        ),
      ),
    );
  }

  async generateSpeech(
    input: z.input<typeof speech>,
    options?: ElevenLabsRequestOptions,
  ) {
    const args = speech.parse(input);
    return this.audio(
      `/v1/text-to-speech/${encodeURIComponent(args.voiceId)}`,
      {
        text: args.text,
        model_id: args.modelId,
        language_code: args.languageCode,
        voice_settings: args.voiceSettings,
        seed: args.seed,
      },
      options,
    );
  }

  async generateMusic(
    input: z.input<typeof music>,
    options?: ElevenLabsRequestOptions,
  ) {
    const args = music.parse(input);
    return this.audio(
      "/v1/music",
      {
        prompt: args.prompt,
        model_id: args.modelId,
        music_length_ms: args.durationMs,
        force_instrumental: args.instrumental,
      },
      options,
    );
  }

  async generateSoundEffect(
    input: z.input<typeof effect>,
    options?: ElevenLabsRequestOptions,
  ) {
    const args = effect.parse(input);
    return this.audio(
      "/v1/sound-generation",
      {
        text: args.text,
        model_id: args.modelId,
        duration_seconds: args.durationSeconds,
        prompt_influence: args.promptInfluence,
        loop: args.loop,
      },
      options,
    );
  }

  async transcribe(
    input: TranscriptionInput,
    options?: ElevenLabsRequestOptions,
  ): Promise<Transcript> {
    const { file, filename, sourceUrl, ...rest } = input;
    const args = transcription.parse(rest);
    if ((file !== undefined) === (sourceUrl !== undefined))
      throw new Error("Provide exactly one of file or sourceUrl.");
    const body = new FormData();
    if (file !== undefined) {
      if (!(file instanceof Blob) || !file.size)
        throw new Error("Transcription requires a nonempty Blob.");
      body.set("file", file, text.parse(filename));
    } else {
      if (filename !== undefined) throw new Error("filename requires file.");
      body.set("source_url", z.url({ protocol: /^https$/ }).parse(sourceUrl));
    }
    body.set("model_id", args.modelId);
    body.set("webhook", "false");
    for (const [name, value] of Object.entries({
      language_code: args.languageCode,
      diarize: args.diarize,
      num_speakers: args.numSpeakers,
      tag_audio_events: args.tagAudioEvents,
      timestamps_granularity: args.timestampsGranularity,
    }))
      if (value !== undefined) body.set(name, String(value));
    return this.request(
      "/v1/speech-to-text",
      { method: "POST", body },
      options,
      (response) => this.json(response, transcriptSchema),
    );
  }

  private audio(
    path: string,
    body: object,
    options?: ElevenLabsRequestOptions,
  ) {
    return this.request(
      `${path}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "audio/mpeg" },
        body: JSON.stringify(body),
      },
      options,
      async (response) => {
        const type = response.headers
          .get("content-type")
          ?.split(";")[0]
          .trim()
          .toLowerCase();
        if (
          !type ||
          !["audio/mpeg", "audio/mp3", "application/octet-stream"].includes(
            type,
          )
        )
          throw new ElevenLabsError(
            "ElevenLabs returned an unexpected audio content type.",
            response.status,
          );
        const data = Buffer.from(await response.arrayBuffer());
        if (!data.length)
          throw new ElevenLabsError(
            "ElevenLabs returned empty audio.",
            response.status,
          );
        return {
          data,
          mimeType: "audio/mpeg" as const,
          extension: "mp3" as const,
          requestId: response.headers.get("request-id"),
          songId: response.headers.get("song-id"),
        };
      },
    );
  }

  private async json<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
    try {
      return schema.parse(await response.json());
    } catch (error) {
      if (
        error instanceof Error &&
        ["AbortError", "TimeoutError"].includes(error.name)
      )
        throw error;
      throw new ElevenLabsError(
        "ElevenLabs returned an invalid JSON response.",
        response.status,
        response.headers.get("request-id"),
      );
    }
  }

  private async request<T>(
    path: string,
    init: RequestInit,
    options: ElevenLabsRequestOptions = {},
    read: (response: Response) => Promise<T>,
  ) {
    const milliseconds = z
      .number()
      .int()
      .positive()
      .max(2147483647)
      .parse(options.timeoutMs ?? 300_000);
    const timeout = AbortSignal.timeout(milliseconds);
    const signal = options.signal
      ? AbortSignal.any([timeout, options.signal])
      : timeout;
    signal.throwIfAborted();
    const headers = new Headers(init.headers);
    headers.set("xi-api-key", this.#key);
    const response = await fetch(`https://api.elevenlabs.io${path}`, {
      ...init,
      headers,
      signal,
      redirect: "error",
    });
    if (response.ok) return read(response);
    const body = (await response.json().catch(() => null)) as any;
    const code =
      [body?.detail?.status, body?.detail?.code].find(
        (value) => typeof value === "string" && /^[a-z_]{3,40}$/.test(value),
      ) ?? null;
    throw new ElevenLabsError(
      `ElevenLabs request failed (HTTP ${response.status}${code ? `, ${code}` : ""}).`,
      response.status,
      response.headers.get("request-id"),
      response.headers.get("retry-after"),
      code,
    );
  }
}

export function createElevenLabsProviderFromEnv() {
  const key = process.env.ELEVENLABS_API_KEY?.trim();
  return key ? new ElevenLabsProvider(key) : null;
}
