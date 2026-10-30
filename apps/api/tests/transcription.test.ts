import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import dns from "node:dns/promises";
import https from "node:https";
import { PassThrough } from "node:stream";
import { EventEmitter } from "node:events";
import OpenAI from "openai";
import { createTranscriptionProviderFromEnv } from "../src/providers/transcription.js";
import { MetaTranscriptionProvider } from "../src/providers/meta-transcription.js";
import {
  transcriptionWav,
  MAX_AUDIO_BYTES,
} from "../src/providers/transcription-audio.js";
import { downloadTranscriptionAudio } from "../src/providers/transcription-download.js";
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
    createTranscriptionProviderFromEnv(
      { META_MODEL_API_KEY: "meta" },
      meta,
    ) instanceof MetaTranscriptionProvider,
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

test("MP3 conversion produces mono 24 kHz 16-bit PCM WAV, preserving source bytes", async () => {
  const original = await audio(),
    before = await original.arrayBuffer();
  const wav = Buffer.from(
    await (
      await transcriptionWav(original, AbortSignal.timeout(10000))
    ).arrayBuffer(),
  );
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.equal(wav.toString("ascii", 8, 12), "WAVE");
  assert.equal(wav.readUInt16LE(20), 1);
  assert.equal(wav.readUInt16LE(22), 1);
  assert.equal(wav.readUInt32LE(24), 24000);
  assert.equal(wav.readUInt16LE(34), 16);
  assert.deepEqual(await original.arrayBuffer(), before);
  await assert.rejects(
    transcriptionWav(new Blob([]), AbortSignal.timeout(10000)),
    /nonempty/,
  );
  await assert.rejects(
    transcriptionWav(
      new Blob([Buffer.alloc(MAX_AUDIO_BYTES + 1)]),
      AbortSignal.timeout(10000),
    ),
    /32 MB/,
  );
  await assert.rejects(
    transcriptionWav(new Blob(["invalid audio"]), AbortSignal.timeout(10000)),
    /could not be converted/,
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
    new MetaTranscriptionProvider("meta").transcribe({ file: new Blob([wav]) }),
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
    file: await audio(),
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
  const provider = createTranscriptionProviderFromEnv(
    { META_MODEL_API_KEY: "meta", ELEVENLABS_API_KEY: "eleven" },
    meta,
  )!;
  const file = await audio();
  await assert.rejects(
    provider.transcribe({ file }),
    (e: any) => e instanceof OpenAI.APIError && e.status === 429,
  );
  assert.equal(calls, 1);
  await assert.rejects(
    provider.transcribe({ file, languageCode: "xx" }),
    /language_code/,
  );
  await assert.rejects(
    provider.transcribe({ file }, { signal: AbortSignal.abort() }),
    /abort/i,
  );
  assert.equal(calls, 1);
});

test("Meta source URL downloads pin public DNS and reject private addresses and redirect destinations", async (t) => {
  t.mock.method(dns, "lookup", async () => [
    { address: "93.184.216.34", family: 4 },
  ]);
  let requests = 0;
  t.mock.method(https, "get", (_url: any, options: any, callback: any) => {
    requests++;
    options.lookup("example.test", {}, (_err: any, ip: string) =>
      assert.equal(ip, "93.184.216.34"),
    );
    const stream = new PassThrough() as any;
    stream.statusCode = requests === 1 ? 200 : 302;
    stream.headers =
      requests === 1 ? {} : { location: "https://127.0.0.1/private" };
    queueMicrotask(() => {
      callback(stream);
      if (requests === 1) stream.end(Buffer.from("audio"));
    });
    return new EventEmitter() as any;
  });
  const signal = AbortSignal.timeout(10000);
  assert.equal(
    await (
      await downloadTranscriptionAudio("https://example.test/audio", signal)
    ).text(),
    "audio",
  );
  await assert.rejects(
    downloadTranscriptionAudio("https://example.test/redirect", signal),
    /public internet/,
  );
  assert.equal(requests, 2);
  for (const host of [
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "[::1]",
    "[::ffff:127.0.0.1]",
  ])
    await assert.rejects(
      downloadTranscriptionAudio(`https://${host}/audio`, signal),
      /public internet/,
    );
  await assert.rejects(
    downloadTranscriptionAudio("http://example.test/audio", signal),
    /HTTPS/,
  );
  assert.equal(requests, 2);
});
