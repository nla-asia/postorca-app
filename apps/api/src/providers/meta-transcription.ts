import OpenAI from "openai";
import { z } from "zod";
import { usageFetch } from "../api-usage/ledger.js";
import { HttpError } from "../handlers/errors.js";
import { META_BASE_URL } from "./meta.js";
import type { TranscriptionOptions } from "./transcription.js";

/** Meta's file endpoint takes up to 10 minutes of WAV; the desktop converts it. */
export const MAX_WAV_BYTES = 32 * 1024 * 1024;
export type MetaTranscriptionInput = {
  wav: Blob;
  diarize?: boolean;
  languageCode?: string;
};

const responseSchema = z.object({
  transcript: z.string(),
  audioDurationMs: z.number().finite().nonnegative(),
  sessionId: z.string(),
  turns: z.array(
    z.object({
      turnId: z.number(),
      startMs: z.number().nonnegative(),
      endMs: z.number().nonnegative(),
      transcript: z.string(),
      speaker: z.string().nullable().optional(),
    }),
  ),
});
const languages: Record<string, string> = {
  ar: "Arabic",
  bn: "Bengali",
  nl: "Dutch",
  en: "English",
  fr: "French",
  de: "German",
  he: "Hebrew",
  hi: "Hindi",
  id: "Indonesian",
  it: "Italian",
  ja: "Japanese",
  kn: "Kannada",
  ko: "Korean",
  ms: "Malay",
  zh: "Mandarin Chinese",
  mr: "Marathi",
  pl: "Polish",
  pt: "Portuguese",
  es: "Spanish",
  tl: "Tagalog",
  ta: "Tamil",
  te: "Telugu",
  th: "Thai",
  tr: "Turkish",
  vi: "Vietnamese",
};

/** One paid request, no retries or automatic provider fallback. Meta timestamps
 * are speech turns; never invent word timings for video captions. */
export class MetaTranscriptionProvider {
  constructor(
    private key: string,
    private model = "muse-voice-transcribe-1.0",
  ) {
    if (!key.trim()) throw new Error("META_MODEL_API_KEY is required.");
  }

  async transcribe(
    input: MetaTranscriptionInput,
    options: TranscriptionOptions = {},
  ) {
    let language: string | undefined;
    if (input.languageCode) {
      try {
        language = languages[new Intl.Locale(input.languageCode).language];
      } catch {
        /* reported as an unsupported language below */
      }
    }
    if (input.languageCode && !language)
      throw new HttpError(
        400,
        "That language_code is not supported by Meta transcription. Use a supported language code or omit it for automatic detection.",
      );
    if (!input.wav.size || input.wav.size - 44 > 600 * 24000 * 2)
      throw new HttpError(
        400,
        "Meta transcription supports recordings up to 10 minutes. Supply a shorter recording.",
      );
    const signal = AbortSignal.any([
      AbortSignal.timeout(options.timeoutMs ?? 300_000),
      ...(options.signal ? [options.signal] : []),
    ]);
    signal.throwIfAborted();
    const body = new FormData();
    body.set(
      "request",
      new Blob(
        [
          JSON.stringify({
            model: this.model,
            audioEncoding: "WAV",
            mode: input.diarize ? "DIARIZATION" : "ENDPOINTING",
            ...(language ? { languageBias: [language] } : {}),
          }),
        ],
        { type: "application/json" },
      ),
    );
    body.set(
      "audio",
      new Blob([input.wav], { type: "audio/wav" }),
      "audio.wav",
    );
    const response = await usageFetch(`${META_BASE_URL}/asr/transcribe`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.key.trim()}`,
        Accept: "application/json",
      },
      body,
      signal,
      redirect: "error",
    });
    if (!response.ok) {
      const data = await response.json().catch(() => undefined);
      throw OpenAI.APIError.generate(
        response.status,
        data && typeof data === "object" ? data : undefined,
        "Meta transcription failed.",
        response.headers,
      );
    }
    const parsed = responseSchema.safeParse(await response.json());
    if (!parsed.success)
      throw new Error("Meta transcription returned an invalid response.");
    const result = parsed.data;
    return {
      text: result.transcript,
      duration_seconds: result.audioDurationMs / 1000,
      timestamp_granularity: "turn" as const,
      turns: result.turns.map((turn) => ({
        text: turn.transcript,
        start: turn.startMs / 1000,
        end: turn.endMs / 1000,
        ...(turn.speaker ? { speaker_id: turn.speaker } : {}),
      })),
    };
  }
}
