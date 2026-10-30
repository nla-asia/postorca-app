import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import OpenAI from "openai";
import {
  createTranscriptionProviderFromEnv,
  metaTranscriptionFromEnv,
} from "../src/providers/transcription.js";
import { MetaTranscriptionProvider } from "../src/providers/meta-transcription.js";
import { transcriptionFromEnv } from "../src/config.js";

const meta = { provider: "meta", model: "muse-voice-transcribe-1.0" } as const;
const scribe = { provider: "elevenlabs", model: "scribe_v2" } as const;
const audio = async () =>
  new Blob(
    [
      new Uint8Array(
        await readFile(
          new URL("./fixtures/media/silence.mp3", import.meta.url),
        ),
      ),
    ],
    { type: "audio/mpeg" },
  );
const response = () => ({
  sessionId: "session-test",
  transcript: "Ship it.",
  audioDurationMs: 8240,
  turns: [
    {
      turnId: 1,
      startMs: 1200,
      endMs: 8240,
      transcript: "Ship it.",
      speaker: "A",
    },
  ],
});

test("transcription settings choose the provider, require only its key, and reject unpriced models", () => {
  assert.equal(
    createTranscriptionProviderFromEnv({ ELEVENLABS_API_KEY: "eleven" }, meta),
    null,
  );
  assert.equal(
    createTranscriptionProviderFromEnv({ META_MODEL_API_KEY: "meta" }, scribe),
    null,
  );
  assert.ok(
    metaTranscriptionFromEnv({ META_MODEL_API_KEY: "meta" }, meta) instanceof
      MetaTranscriptionProvider,
  );
  assert.equal(
    metaTranscriptionFromEnv({ ELEVENLABS_API_KEY: "eleven" }, scribe),
    null,
  );
  assert.ok(
    createTranscriptionProviderFromEnv(
      { ELEVENLABS_API_KEY: "eleven" },
      scribe,
    ),
  );
  assert.throws(
    () => transcriptionFromEnv({}, { provider: "meta", model: "scribe_v2" }),
    /settings.transcription.model/,
  );
});

test("Meta rejects recordings over ten minutes before dispatch", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return Response.json(response());
  });
  const pcmBytes = 600 * 24000 * 2 + 480;
  const wav = Buffer.alloc(44 + pcmBytes);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(24000, 24);
  wav.writeUInt32LE(48000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(pcmBytes, 40);
  await assert.rejects(
    new MetaTranscriptionProvider("meta").transcribe({ wav: new Blob([wav]) }),
    /10 minutes/,
  );
  assert.equal(calls, 0);
});

test("Meta uploads WAV and documented settings, returns real turn timings without fabricated words", async (t) => {
  const calls: any[] = [];
  t.mock.method(globalThis, "fetch", async (url: any, init: RequestInit) => {
    calls.push({ url, init });
    return Response.json(response());
  });
  const result = await new MetaTranscriptionProvider(" meta-key ").transcribe({
    wav: await audio(),
    diarize: true,
    languageCode: "eng",
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.meta.ai/v1/asr/transcribe");
  assert.equal(
    new Headers(calls[0].init.headers).get("authorization"),
    "Bearer meta-key",
  );
  const form = calls[0].init.body as FormData;
  assert.deepEqual(JSON.parse(await (form.get("request") as Blob).text()), {
    model: meta.model,
    audioEncoding: "WAV",
    mode: "DIARIZATION",
    languageBias: ["English"],
  });
  assert.equal((form.get("audio") as Blob).type, "audio/wav");
  assert.deepEqual(result, {
    text: "Ship it.",
    duration_seconds: 8.24,
    timestamp_granularity: "turn",
    turns: [{ text: "Ship it.", start: 1.2, end: 8.24, speaker_id: "A" }],
  });
  assert.equal("words" in result, false);
});

test("switching to ElevenLabs preserves saved audio and HTTPS URL inputs, word timings and model", async (t) => {
  const calls: any[] = [];
  t.mock.method(globalThis, "fetch", async (url: any, init: RequestInit) => {
    calls.push({ url, init });
    return Response.json({
      text: "Ship it.",
      language_code: "en",
      words: [{ text: "Ship", type: "word", start: 0, end: 1 }],
    });
  });
  const provider = createTranscriptionProviderFromEnv(
    { ELEVENLABS_API_KEY: "eleven", META_MODEL_API_KEY: "meta" },
    scribe,
  )!;
  const file = await audio();
  const result = await provider.transcribe({
    file,
    languageCode: "en",
    diarize: true,
  });
  assert.ok("words" in result && result.words?.length);
  assert.equal(calls[0].url, "https://api.elevenlabs.io/v1/speech-to-text");
  const form = calls[0].init.body as FormData;
  assert.equal(form.get("model_id"), "scribe_v2");
  assert.equal(form.get("timestamps_granularity"), "word");
  assert.equal(form.get("language_code"), "en");
  assert.equal(form.get("diarize"), "true");
  assert.deepEqual(
    await (form.get("file") as Blob).arrayBuffer(),
    await file.arrayBuffer(),
  );
  await provider.transcribe({ sourceUrl: "https://example.test/audio.mp3" });
  assert.equal(
    calls[1].init.body.get("source_url"),
    "https://example.test/audio.mp3",
  );
});

test("Meta failures, invalid input and cancellation never retry or fall back", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return Response.json(
      { error: { code: "quota_exceeded" } },
      { status: 429 },
    );
  });
  const provider = metaTranscriptionFromEnv(
    { META_MODEL_API_KEY: "meta", ELEVENLABS_API_KEY: "eleven" },
    meta,
  )!;
  const wav = await audio();
  await assert.rejects(
    provider.transcribe({ wav }),
    (e: any) => e instanceof OpenAI.APIError && e.status === 429,
  );
  assert.equal(calls, 1);
  await assert.rejects(
    provider.transcribe({ wav, languageCode: "xx" }),
    /language_code/,
  );
  await assert.rejects(
    provider.transcribe({ wav }, { signal: AbortSignal.abort() }),
    /abort/i,
  );
  assert.equal(calls, 1);
});
