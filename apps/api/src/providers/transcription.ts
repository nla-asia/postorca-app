import { transcriptionFromEnv } from "../config.js";
import type { TranscriptionChoice } from "../settings.js";
import { ElevenLabsProvider } from "./elevenlabs.js";
import { MetaTranscriptionProvider } from "./meta-transcription.js";

export type TranscriptionRequest = {
  diarize?: boolean;
  languageCode?: string;
} & ({ file: Blob; sourceUrl?: never } | { sourceUrl: string; file?: never });
export type TranscriptionOptions = { signal?: AbortSignal; timeoutMs?: number };

/** Settings choose the provider; credentials only enable that choice. Scribe's
 * original arguments/results stay intact when switching back. */
export function createTranscriptionProviderFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  choice?: TranscriptionChoice,
) {
  const selected = transcriptionFromEnv(env, choice);
  if (!selected) return null;
  if (selected.provider === "meta")
    return new MetaTranscriptionProvider(selected.apiKey, selected.model);
  const provider = new ElevenLabsProvider(selected.apiKey);
  return {
    transcribe: (input: TranscriptionRequest, options?: TranscriptionOptions) =>
      provider.transcribe(
        {
          ...(input.file
            ? { file: input.file, filename: "audio.mp3" }
            : { sourceUrl: input.sourceUrl! }),
          diarize: input.diarize,
          languageCode: input.languageCode,
          modelId: selected.model,
          timestampsGranularity: "word",
        },
        options,
      ),
  };
}
