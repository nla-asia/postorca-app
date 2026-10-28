import assert from "node:assert/strict";
import { test } from "node:test";
import {
  OpenAIImageProvider,
  DEFAULT_IMAGE_MODEL,
  createOpenAIImageProviderFromEnv,
} from "../src/providers/openai-image.js";
import {
  MetaImageProvider,
  META_IMAGE_MODEL,
  createImageProviderFromEnv,
} from "../src/providers/meta-image.js";
import {
  ElevenLabsProvider,
  ElevenLabsError,
  createElevenLabsProviderFromEnv,
} from "../src/providers/elevenlabs.js";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB9sAAAAASUVORK5CYII=",
  "base64",
);
const audio = () =>
  new Response(new Uint8Array([73, 68, 51, 1]), {
    headers: { "content-type": "audio/mpeg", "request-id": "request-1" },
  });

test("images use a separate credential and preserve model, defaults and PNG output", async (t) => {
  const calls: any[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return Response.json(
      {
        data: [{ b64_json: png.toString("base64") }],
        usage: { total_tokens: 4 },
      },
      { headers: { "x-request-id": "image-1" } },
    );
  });
  const result = await new OpenAIImageProvider("image-only-key").generateImage(
    { prompt: "A small studio" },
    { safetyIdentifier: "founder-hash" },
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.openai.com/v1/images/generations");
  assert.equal(
    new Headers(calls[0].init.headers).get("authorization"),
    "Bearer image-only-key",
  );
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    model: DEFAULT_IMAGE_MODEL,
    prompt: "A small studio",
    n: 1,
    size: "1024x1024",
    quality: "medium",
    output_format: "png",
    safety_identifier: "founder-hash",
  });
  assert.deepEqual(result.data, png);
  assert.equal(result.requestId, "image-1");
});

test("image revisions upload the source and PNG mask; invalid masks fail before requesting", async (t) => {
  let edits = 0;
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    if (url === "data:,") return new Response("");
    edits++;
    assert.equal(url, "https://api.openai.com/v1/images/edits");
    const form = init.body as FormData;
    assert.ok(form.get("image") instanceof Blob);
    assert.ok(form.get("mask") instanceof Blob);
    assert.equal(form.get("prompt"), "Make the background blue");
    assert.equal(form.get("model"), DEFAULT_IMAGE_MODEL);
    return Response.json({ data: [{ b64_json: png.toString("base64") }] });
  });
  const provider = new OpenAIImageProvider("key");
  const image = new Blob([png], { type: "image/png" });
  await provider.editImage({
    image,
    mask: image,
    prompt: "Make the background blue",
  });
  await assert.rejects(
    provider.editImage({
      image,
      mask: new Blob([png], { type: "image/jpeg" }),
      prompt: "Blue",
    }),
    /masks must be PNG/,
  );
  assert.equal(edits, 1);
});

test("Muse Image requests PNGs from Meta, maps low quality to one pass, and takes no mask", async (t) => {
  const calls: any[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return Response.json({ data: [{ b64_json: png.toString("base64") }] });
  });
  const provider = new MetaImageProvider("meta-key");
  await provider.generateImage(
    { prompt: "A small studio", quality: "low", size: "1536x1024" },
    { safetyIdentifier: "founder-hash" },
  );
  assert.equal(calls[0].url, "https://api.meta.ai/v1/images/generations");
  assert.equal(
    new Headers(calls[0].init.headers).get("authorization"),
    "Bearer meta-key",
  );
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    prompt: "A small studio",
    size: "1536x1024",
    model: META_IMAGE_MODEL,
    n: 1,
    output_format: "png",
    reasoning_strength: "low",
    user: "founder-hash",
  });
  const image = new Blob([png], { type: "image/png" });
  await provider.editImage({ image, prompt: "Make it blue" });
  assert.equal(calls[1].url, "https://api.meta.ai/v1/images/edits");
  const form = calls[1].init.body as FormData;
  assert.ok(form.get("image") instanceof Blob);
  assert.equal(form.get("model"), META_IMAGE_MODEL);
  assert.equal(form.get("reasoning_strength"), "high");
  await assert.rejects(
    provider.editImage({ image, mask: image, prompt: "Blue" }),
    /takes no mask/,
  );
  assert.equal(calls.length, 2);
});

test("images use Muse Image when Meta is configured unless IMAGE_PROVIDER=openai", (t) => {
  for (const key of ["META_MODEL_API_KEY", "OPENAI_IMAGE_API_KEY", "IMAGE_PROVIDER"]) {
    const old = process.env[key];
    t.after(() => {
      if (old === undefined) delete process.env[key];
      else process.env[key] = old;
    });
  }
  process.env.META_MODEL_API_KEY = "meta-key";
  process.env.OPENAI_IMAGE_API_KEY = "image-key";
  delete process.env.IMAGE_PROVIDER;
  assert.ok(createImageProviderFromEnv() instanceof MetaImageProvider);
  process.env.IMAGE_PROVIDER = "openai";
  assert.ok(createImageProviderFromEnv() instanceof OpenAIImageProvider);
  delete process.env.META_MODEL_API_KEY;
  delete process.env.IMAGE_PROVIDER;
  assert.ok(createImageProviderFromEnv() instanceof OpenAIImageProvider);
});

test("failed paid image calls are not retried and malformed PNG responses are rejected", async (t) => {
  const requests = t.mock.method(globalThis, "fetch", async () =>
    Response.json({ error: { message: "Failed" } }, { status: 503 }),
  );
  const provider = new OpenAIImageProvider("key");
  await assert.rejects(provider.generateImage({ prompt: "A studio" }));
  assert.equal(requests.mock.callCount(), 1);
  requests.mock.mockImplementation(async () =>
    Response.json({
      data: [{ b64_json: Buffer.from("not PNG").toString("base64") }],
    }),
  );
  await assert.rejects(
    provider.generateImage({ prompt: "A studio" }),
    /invalid PNG/,
  );
  const controller = new AbortController();
  controller.abort();
  const before = requests.mock.callCount();
  await assert.rejects(
    provider.generateImage(
      { prompt: "A studio" },
      { signal: controller.signal },
    ),
  );
  assert.equal(requests.mock.callCount(), before);
});

test("audio requests preserve speech, music and effect parameters and authenticate independently", async (t) => {
  const calls: any[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return audio();
  });
  const provider = new ElevenLabsProvider("audio-key");
  const result = await provider.generateSpeech({
    text: "Welcome",
    voiceId: "voice/id",
    modelId: "eleven_multilingual_v2",
    voiceSettings: { speed: 0.9 },
    seed: 0,
  });
  await provider.generateMusic({
    prompt: "Piano",
    modelId: "music_v1",
    durationMs: 5000,
    instrumental: true,
  });
  await provider.generateSoundEffect({
    text: "Click",
    modelId: "eleven_text_to_sound_v2",
    durationSeconds: 1,
    loop: false,
  });
  assert.equal(result.mimeType, "audio/mpeg");
  assert.equal(result.requestId, "request-1");
  assert.deepEqual(
    calls.map((call) => call.url),
    [
      "https://api.elevenlabs.io/v1/text-to-speech/voice%2Fid?output_format=mp3_44100_128",
      "https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128",
      "https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128",
    ],
  );
  assert.deepEqual(
    calls.map((call) => JSON.parse(call.init.body)),
    [
      {
        text: "Welcome",
        model_id: "eleven_multilingual_v2",
        voice_settings: { speed: 0.9 },
        seed: 0,
      },
      {
        prompt: "Piano",
        model_id: "music_v1",
        music_length_ms: 5000,
        force_instrumental: true,
      },
      {
        text: "Click",
        model_id: "eleven_text_to_sound_v2",
        duration_seconds: 1,
        loop: false,
      },
    ],
  );
  for (const call of calls) {
    assert.equal(new Headers(call.init.headers).get("xi-api-key"), "audio-key");
    assert.equal(call.init.redirect, "error");
  }
});

test("transcription uses multipart sources, preserving words and speaker labels", async (t) => {
  const transcript = {
    text: "Welcome",
    language_code: "en",
    words: [
      {
        text: "Welcome",
        type: "word",
        start: 0,
        end: 1,
        speaker_id: "speaker_0",
      },
    ],
  };
  const forms: FormData[] = [];
  t.mock.method(
    globalThis,
    "fetch",
    async (_url: string, init: RequestInit) => {
      forms.push(init.body as FormData);
      return Response.json(transcript);
    },
  );
  const provider = new ElevenLabsProvider("key");
  assert.deepEqual(
    await provider.transcribe({
      file: new Blob(["ID3"]),
      filename: "voice.mp3",
      modelId: "scribe_v2",
      diarize: true,
      timestampsGranularity: "word",
    }),
    transcript,
  );
  await provider.transcribe({
    sourceUrl: "https://example.com/audio.mp3",
    modelId: "scribe_v2",
  });
  assert.ok(forms[0].get("file") instanceof Blob);
  assert.equal(forms[0].get("diarize"), "true");
  assert.equal(forms[0].get("timestamps_granularity"), "word");
  assert.equal(forms[1].get("source_url"), "https://example.com/audio.mp3");
  assert.equal(forms[1].get("webhook"), "false");
  await assert.rejects(
    provider.transcribe({
      sourceUrl: "http://example.com/audio.mp3",
      modelId: "scribe_v2",
    }),
  );
  await assert.rejects(
    provider.transcribe({
      sourceUrl: "https://example.com/audio.mp3",
      file: new Blob(["ID3"]),
      modelId: "scribe_v2",
    } as any),
    /exactly one/,
  );
  assert.equal(forms.length, 2);
});

test("voices paginate and retain labels; models retain provider capabilities", async (t) => {
  const urls: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string) => {
    urls.push(url);
    return Response.json(
      url.includes("voices")
        ? {
            voices: [{ voice_id: "voice", labels: { accent: "neutral" } }],
            has_more: true,
            next_page_token: "next",
          }
        : [{ model_id: "m", can_do_text_to_speech: true }],
    );
  });
  const provider = new ElevenLabsProvider("key");
  const voices = await provider.listVoices({
    search: "warm",
    pageSize: 4,
    nextPageToken: "page",
  });
  assert.deepEqual(voices.voices[0].labels, { accent: "neutral" });
  assert.equal(new URL(urls[0]).searchParams.get("next_page_token"), "page");
  assert.equal((await provider.listModels())[0].can_do_text_to_speech, true);
});

test("quota failures keep a short code without leaking the provider body or retrying", async (t) => {
  const requests = t.mock.method(globalThis, "fetch", async () =>
    Response.json(
      {
        detail: { status: "quota_exceeded", message: "private script and key" },
      },
      { status: 401, headers: { "request-id": "q", "retry-after": "30" } },
    ),
  );
  await assert.rejects(
    new ElevenLabsProvider("key").generateSpeech({
      text: "Script",
      voiceId: "voice",
      modelId: "m",
    }),
    (error: any) => {
      assert.ok(error instanceof ElevenLabsError);
      assert.equal(error.code, "quota_exceeded");
      assert.equal(error.retryAfter, "30");
      assert.doesNotMatch(error.message, /private script/);
      return true;
    },
  );
  assert.equal(requests.mock.callCount(), 1);
});

test("audio validation and cancellation prevent requests; empty and malformed results fail", async (t) => {
  const requests = t.mock.method(
    globalThis,
    "fetch",
    async () => new Response("", { headers: { "content-type": "audio/mpeg" } }),
  );
  const provider = new ElevenLabsProvider("key");
  await assert.rejects(
    provider.generateMusic({
      prompt: "Piano",
      modelId: "music_v1",
      durationMs: 1,
    }),
  );
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(
    provider.generateSpeech(
      { text: "Script", voiceId: "v", modelId: "m" },
      { signal: abort.signal },
    ),
  );
  assert.equal(requests.mock.callCount(), 0);
  await assert.rejects(
    provider.generateSpeech({ text: "Script", voiceId: "v", modelId: "m" }),
    /empty audio/,
  );
  requests.mock.mockImplementation(async () =>
    Response.json({ voices: "bad" }),
  );
  await assert.rejects(provider.listVoices(), /invalid JSON response/);
});

test("media credentials remain optional with no fallback to the conversation key", (t) => {
  for (const key of ["OPENAI_IMAGE_API_KEY", "ELEVENLABS_API_KEY"]) {
    const old = process.env[key];
    delete process.env[key];
    t.after(() => {
      if (old === undefined) delete process.env[key];
      else process.env[key] = old;
    });
  }
  assert.equal(createOpenAIImageProviderFromEnv(), null);
  assert.equal(createElevenLabsProviderFromEnv(), null);
  assert.throws(() => new OpenAIImageProvider(" "), /OPENAI_IMAGE_API_KEY/);
  assert.throws(() => new ElevenLabsProvider(" "), /ELEVENLABS_API_KEY/);
});
