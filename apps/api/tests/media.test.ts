import assert from "node:assert/strict";
import { before, after, test, mock } from "node:test";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { createApp } from "../src/app.js";
import { configFromEnv } from "../src/config.js";
import { attachDesktopSocket } from "../src/desktop/connections.js";
import { issueDeviceToken, issueToken } from "../src/middleware/auth.js";
import { migrate } from "../src/migrate.js";
import { createUser } from "../src/repositories/users.js";
import {
  createTask,
  createTurn,
  taskDetail,
} from "../src/repositories/tasks.js";
import { loadFile, saveFile, fileRef } from "../src/storage.js";
import { executeTool } from "../src/tools/index.js";
import { loadPluginState } from "../src/plugins/service.js";
import {
  alignScenes,
  pausedTranscript,
  transcriptWithScript,
} from "../src/plugins/video/index.js";
import { temporaryPostgres } from "./postgres.js";

const secret = "media-suite-test-secret-at-least-32-characters";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB9sAAAAASUVORK5CYII=",
  "base64",
);
const mp3 = readFileSync(
  new URL("./fixtures/media/silence.mp3", import.meta.url),
);
const mp4 = Buffer.from("\0\0\0\x18ftypmp42fixture");
/** An MP4 with just a movie header saying it lasts `seconds`, after a media box. */
function clipMp4(seconds: number) {
  const box = (type: string, body: Buffer) => {
    const size = Buffer.alloc(4);
    size.writeUInt32BE(body.length + 8);
    return Buffer.concat([size, Buffer.from(type, "latin1"), body]);
  };
  const mvhd = Buffer.alloc(100);
  mvhd.writeUInt32BE(600, 12);
  mvhd.writeUInt32BE(seconds * 600, 16);
  return Buffer.concat([
    box("ftyp", Buffer.from("isom\0\0\0\0")),
    box("mdat", Buffer.alloc(64)),
    box("moov", box("mvhd", mvhd)),
  ]);
}
const realFetch = globalThis.fetch;
const savedEnv = Object.fromEntries(
  [
    "STORAGE_DIR",
    "OPENAI_IMAGE_API_KEY",
    "ELEVENLABS_API_KEY",
    "META_MODEL_API_KEY",
  ].map((key) => [key, process.env[key]]),
);
const requests: { url: string; init: RequestInit }[] = [];
let failure = false;
let fixture: Awaited<ReturnType<typeof temporaryPostgres>>;
let storage: string;
let server: Server;
let socket: ReturnType<typeof attachDesktopSocket>;
let base: string;
let accountNumber = 0;

before(async () => {
  fixture = await temporaryPostgres();
  await migrate(fixture.db);
  storage = await mkdtemp(join(tmpdir(), "postorca-media-test-"));
  process.env.STORAGE_DIR = storage;
  process.env.OPENAI_IMAGE_API_KEY = "test-image";
  process.env.ELEVENLABS_API_KEY = "test-audio";
  process.env.META_MODEL_API_KEY = "test-meta";
  mock.method(globalThis, "fetch", async (url: any, init: RequestInit = {}) => {
    if (
      !String(url).startsWith("https://api.openai.com/") &&
      !String(url).startsWith("https://api.meta.ai/") &&
      !String(url).startsWith("https://api.elevenlabs.io/")
    )
      return realFetch(url, init);
    requests.push({ url: String(url), init });
    if (failure)
      return Response.json(
        { detail: { status: "quota_exceeded", message: "private content" } },
        { status: 401 },
      );
    if (String(url).endsWith("/asr/transcribe"))
      return Response.json({
        sessionId: "test-session",
        transcript: "Ship it.",
        audioDurationMs: 2200,
        turns: [
          {
            turnId: 1,
            startMs: 200,
            endMs: 2200,
            transcript: "Ship it.",
            speaker: "A",
          },
        ],
      });
    if (/openai\.com|meta\.ai/.test(String(url)))
      return Response.json({ data: [{ b64_json: png.toString("base64") }] });
    if (String(url).includes("/voices"))
      return Response.json({
        voices: [
          {
            voice_id: "v1",
            name: "Test",
            description: "Conversational",
            labels: { accent: "neutral" },
          },
        ],
        has_more: false,
      });
    if (String(url).includes("/speech-to-text"))
      return Response.json({
        text: "Ship it.",
        language_code: "en",
        words: [
          { text: "Ship", type: "word", start: 0.2, end: 0.6 },
          { text: " ", type: "spacing", start: 0.6, end: 0.7 },
          { text: "it.", type: "word", start: 0.7, end: 2.2 },
        ],
      });
    return new Response(mp3, { headers: { "content-type": "audio/mpeg" } });
  });
  server = createApp(
    fixture.db,
    configFromEnv({ DATABASE_URL: fixture.url, JWT_SECRET: secret }),
  ).listen(0, "127.0.0.1");
  socket = attachDesktopSocket(server, secret);
  await once(server, "listening");
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
after(async () => {
  socket?.close();
  if (server)
    await new Promise<void>((resolve) => server.close(() => resolve()));
  mock.restoreAll();
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (storage) await rm(storage, { recursive: true, force: true });
  await fixture?.close();
});

async function founder(plugin: "media" | "video") {
  const user = await createUser(
    fixture.db,
    "Founder",
    `media-${++accountNumber}@example.com`,
    "test-password",
  );
  const task = await createTask(fixture.db, user.id, "work", "Media");
  const turn = await createTurn(fixture.db, user.id, task.id, "Create media");
  const context = {
    userId: user.id as string,
    taskId: task.id as string,
    turnId: turn.id as string,
  };
  await executeTool(fixture.db, context, "activate_plugin", { code: plugin });
  return {
    ...context,
    token: issueToken(user.id, secret),
    call: (name: string, args: object) =>
      executeTool(fixture.db, context, name, args) as Promise<any>,
  };
}

test("media tools save reusable owned files and deliver through existing artifacts and authenticated reads", async () => {
  const owner = await founder("media"),
    other = await founder("media");
  const generated = await owner.call("media_generate_image", {
    title: "Studio",
    prompt: "A small studio",
  });
  assert.deepEqual(await loadFile(generated.attachments[0].file), png);
  const revised = await owner.call("media_edit_image", {
    title: "Blue studio",
    file: generated.ref,
    prompt: "Use a blue background",
  });
  assert.notEqual(revised.ref, generated.ref);
  assert.deepEqual(await loadFile(generated.attachments[0].file), png);
  const artifact = await owner.call("create_artifact", {
    kind: "image",
    title: "Studio",
    content: revised.ref,
  });
  const metadata = JSON.parse(artifact.content);
  assert.equal(metadata.file, revised.attachments[0].file);
  const read = (token: string) =>
    fetch(`${base}${metadata.url.replace(/^\/api/, "")}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  assert.deepEqual(
    Buffer.from(await (await read(owner.token)).arrayBuffer()),
    png,
  );
  assert.equal((await read(other.token)).status, 404);
  assert.equal((await fetch(`${base}/files?key=${metadata.file}`)).status, 401);
  const history = await taskDetail(fixture.db, owner.userId, owner.taskId);
  assert.ok(
    history.turns
      .flatMap((turn: { artifacts: { id: string }[] }) => turn.artifacts)
      .some((item: any) => item.id === artifact.id),
  );
  const before = requests.length;
  await assert.rejects(
    other.call("media_edit_image", {
      title: "No",
      file: generated.ref,
      prompt: "Blue",
    }),
    /File not found/,
  );
  assert.equal(requests.length, before);
});

test("audio tools discover voices and preserve the original tool models, durations and saved refs", async () => {
  const owner = await founder("media");
  const voices = await owner.call("media_list_voices", {});
  assert.equal(voices.voices[0].voice_id, "v1");
  const speech = await owner.call("media_generate_speech", {
    title: "Voice",
    voice_id: "v1",
    text: "Ship it.",
  });
  const music = await owner.call("media_generate_music", {
    title: "Music",
    prompt: "Piano",
    duration_seconds: 5,
  });
  const effect = await owner.call("media_generate_sound_effect", {
    title: "Click",
    text: "Click",
    duration_seconds: 1,
  });
  for (const result of [speech, music, effect]) {
    assert.deepEqual(await loadFile(result.attachments[0].file), mp3);
    await owner.call("create_artifact", {
      kind: "audio",
      title: "Audio",
      content: result.ref,
    });
  }
  const speechRequest = [...requests]
    .reverse()
    .find((request) => request.url.includes("/text-to-speech"))!;
  assert.equal(
    JSON.parse(String(speechRequest.init.body)).model_id,
    "eleven_multilingual_v2",
  );
  const musicRequest = [...requests]
    .reverse()
    .find((request) => request.url.includes("/v1/music"))!;
  assert.equal(
    JSON.parse(String(musicRequest.init.body)).music_length_ms,
    5000,
  );
  assert.equal(
    JSON.parse(String(musicRequest.init.body)).force_instrumental,
    true,
  );
  const before = requests.length;
  await assert.rejects(
    owner.call("media_generate_music", {
      title: "Too long",
      prompt: "Piano",
      duration_seconds: 61,
    }),
  );
  await assert.rejects(
    owner.call("media_edit_image", {
      title: "Wrong type",
      file: speech.ref,
      prompt: "Blue",
    }),
    /saved image/,
  );
  assert.equal(requests.length, before);
});

test("images go to Muse Image and masks are refused before any paid call", async () => {
  const owner = await founder("media");
  const generated = await owner.call("media_generate_image", {
    title: "Studio",
    prompt: "A small studio",
  });
  assert.equal(
    requests.at(-1)!.url,
    "https://api.meta.ai/v1/images/generations",
  );
  const before = requests.length;
  await assert.rejects(
    owner.call("media_edit_image", {
      title: "Masked",
      file: generated.ref,
      mask_file: generated.ref,
      prompt: "Blue",
    }),
    /edits from the prompt alone/,
  );
  assert.equal(requests.length, before);
  await owner.call("media_edit_image", {
    title: "Blue",
    file: generated.ref,
    prompt: "Blue",
  });
  assert.equal(requests.at(-1)!.url, "https://api.meta.ai/v1/images/edits");
});

test("missing credentials and quota failures are actionable and do not repeat paid calls", async () => {
  const owner = await founder("media");
  delete process.env.META_MODEL_API_KEY;
  await assert.rejects(
    owner.call("media_generate_image", { title: "Studio", prompt: "Studio" }),
    /META_MODEL_API_KEY/,
  );
  process.env.META_MODEL_API_KEY = "test-meta";
  const before = requests.length;
  failure = true;
  try {
    await assert.rejects(
      owner.call("media_generate_speech", {
        title: "Speech",
        text: "Ship it.",
        voice_id: "v1",
      }),
      /out of credits.*do not retry/i,
    );
  } finally {
    failure = false;
  }
  assert.equal(requests.length, before + 1);
});

test("video previews and exports use the real desktop transport, cached speech timing and saved colours", async (t) => {
  const owner = await founder("video");
  const deviceToken = issueDeviceToken(owner.userId, randomUUID(), secret);
  const calls: any[] = [];
  const ws = new WebSocket(
    `${base.replace(/^http/, "ws")}/desktop/socket?token=${deviceToken}`,
  );
  const errors: unknown[] = [];
  ws.on("message", (raw) => {
    void (async () => {
      const message = JSON.parse(raw.toString());
      const call = message.data;
      calls.push(call);
      const preview = call.tool === "video_preview_frames";
      const file = await saveFile(
        owner.userId,
        "media",
        preview ? png : mp4,
        preview ? "image/png" : "video/mp4",
      );
      const response = await fetch(`${base}/desktop/tool-result`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${deviceToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          executionId: call.executionId,
          ok: true,
          result: {
            attachments: [
              { file, mime_type: preview ? "image/png" : "video/mp4" },
            ],
          },
        }),
      });
      assert.equal(response.status, 204);
    })().catch((error) => errors.push(error));
  });
  await once(ws, "open");
  t.after(() => ws.terminate());
  const image = await saveFile(owner.userId, "media", png, "image/png");
  const voice = await saveFile(owner.userId, "media", mp3, "audio/mpeg");
  const music = await saveFile(owner.userId, "media", mp3, "audio/mpeg");
  await fixture.db.query(
    "UPDATE brand_profiles SET colors=$2 WHERE user_id=$1",
    [
      owner.userId,
      { background: "#112233", text: "#ffffff", highlight: "#abcdef" },
    ],
  );
  const args = {
    format: "16:9",
    scenes: [
      {
        image_file: fileRef(image),
        text: "Ship it",
        duration_seconds: 1,
        fit: "contain",
        device: "browser",
        focus: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 },
        highlight: { x: 0, y: 0, width: 0.2, height: 0.2 },
      },
    ],
    voiceover_file: fileRef(voice),
    music: { file: fileRef(music), start_seconds: 2 },
  };
  const before = requests.filter((request) =>
    request.url.includes("speech-to-text"),
  ).length;
  const preview = await owner.call("video_preview_frames", {
    ...args,
    times_seconds: Array.from({ length: 10 }, (_, i) => i / 10),
  });
  assert.equal(preview.duration_seconds, 2.8);
  assert.match(preview.note, /extended/);
  assert.match(preview.skipped_times, /first 8/);
  const exported = await owner.call("video_export", {
    ...args,
    captions: false,
    title: "Demo",
  });
  assert.equal(
    requests.filter((request) => request.url.includes("speech-to-text")).length,
    before + 1,
  );
  assert.equal(calls[0].arguments.times_ms.length, 8);
  assert.equal(calls[0].timeoutMs, 180_000);
  assert.equal(calls[1].timeoutMs, 600_000);
  assert.equal(calls[0].arguments.scenes[0].file, image);
  assert.equal(calls[0].arguments.scenes[0].duration_ms, 2800);
  assert.equal(calls[0].arguments.brand.highlight, "#abcdef");
  assert.deepEqual(calls[0].arguments.music.voice_ranges_ms, [[200, 2200]]);
  assert.equal(calls[0].arguments.music.volume, 0.15);
  assert.equal(calls[0].arguments.music.start_ms, 2000);
  assert.equal(calls[1].arguments.transcript, undefined);
  await owner.call("create_artifact", {
    kind: "video",
    title: "Demo",
    content: fileRef(exported.attachments[0].file),
  });
  assert.deepEqual(errors, []);
  const state = await loadPluginState(fixture.db, owner.taskId);
  assert.ok(state.tools.some((tool) => tool.name === "media_generate_speech"));
  assert.ok(state.skills.some((skill) => skill.name === "product-content-edit"));
  const beforeCalls = calls.length;
  await assert.rejects(
    owner.call("video_export", {
      title: "Too long",
      scenes: [
        { text: "One", duration_seconds: 60 },
        { text: "Two", duration_seconds: 31 },
      ],
    }),
    /limit is 90/,
  );
  await assert.rejects(
    owner.call("video_export", {
      title: "Empty",
      scenes: [{ duration_seconds: 1 }],
    }),
  );
  assert.equal(calls.length, beforeCalls);
});

test("clip scenes trim, speed up and hold recorded videos, deriving their durations", async (t) => {
  const owner = await founder("video");
  const deviceToken = issueDeviceToken(owner.userId, randomUUID(), secret);
  const calls: any[] = [];
  const ws = new WebSocket(
    `${base.replace(/^http/, "ws")}/desktop/socket?token=${deviceToken}`,
  );
  ws.on("message", (raw) => {
    const call = JSON.parse(raw.toString()).data;
    calls.push(call);
    void fetch(`${base}/desktop/tool-result`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${deviceToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        executionId: call.executionId,
        ok: true,
        result: { attachments: [] },
      }),
    });
  });
  await once(ws, "open");
  t.after(() => ws.terminate());
  const clip = fileRef(
    await saveFile(owner.userId, "media", clipMp4(6), "video/mp4"),
  );
  const image = fileRef(
    await saveFile(owner.userId, "media", png, "image/png"),
  );
  const preview = (scenes: object[]) =>
    owner.call("video_preview_frames", { scenes, times_seconds: [0] });

  const result = await preview([
    {
      video_file: clip,
      start_seconds: 1,
      end_seconds: 5,
      speed: 2,
      hold_seconds: 2.5,
      fit: "contain",
      device: "browser",
      focus: { x: 0.5, y: 0.5, width: 0.4, height: 0.4 },
    },
    { video_file: clip, start_seconds: 4.5, sound: true },
    { video_file: clip, end_seconds: 2, duration_seconds: 3 },
  ]);
  const scenes = calls.at(-1).arguments.scenes;
  assert.deepEqual(
    scenes.map((scene: any) => [
      scene.duration_ms,
      scene.start_ms,
      scene.end_ms,
      scene.speed,
    ]),
    [
      [4500, 1000, 5000, 2],
      [1500, 4500, 6000, 1],
      [3000, 0, 2000, 1],
    ],
  );
  // Only the clip asked to keep its sound plays with it.
  assert.deepEqual(scenes.map((scene: any) => scene.sound), [undefined, true, undefined]);
  assert.match(scenes[0].file, /\.mp4$/);
  assert.equal(scenes[0].device, "browser");
  assert.equal(result.duration_seconds, 9);
  // Each clip scene is its own shot: three shots in 9 s.
  assert.equal(result.pacing, undefined);
  // Nothing on screen says what this is until the voiceover does.
  assert.match(result.opening, /no on-screen text/);
  const titled = await preview([
    { video_file: clip, end_seconds: 3, text: "Introducing Clip" },
  ]);
  assert.equal(titled.opening, undefined);

  const before = calls.length;
  for (const [scene, error] of [
    [{ video_file: clip, end_seconds: 7 }, /past the end.*6 s long/],
    [{ video_file: clip, start_seconds: 6 }, /past the end/],
    [
      { video_file: clip, start_seconds: 1, end_seconds: 1.4, speed: 4 },
      /at least 0\.5 s/,
    ],
    [{ video_file: image }, /Choose a saved video file/],
    [{ image_file: clip, duration_seconds: 1 }, /Choose a saved image file/],
  ] as const)
    await assert.rejects(preview([scene]), error);
  for (const scene of [
    { image_file: image, video_file: clip, duration_seconds: 1 },
    { image_file: image, duration_seconds: 1, speed: 2 },
    { image_file: image, duration_seconds: 1, sound: true },
    { text: "Trimmed", duration_seconds: 1, end_seconds: 2 },
    { image_file: image },
    { video_file: clip, start_seconds: 3, end_seconds: 2 },
    { video_file: clip, speed: 8 },
  ])
    await assert.rejects(preview([scene]), "invalid: " + JSON.stringify(scene));
  assert.equal(calls.length, before);
});

test("video rejects foreign files before rendering, and reports an offline desktop", async () => {
  const owner = await founder("video"),
    other = await founder("media");
  const foreign = await saveFile(other.userId, "media", png, "image/png");
  await assert.rejects(
    owner.call("video_export", {
      title: "No",
      scenes: [{ image_file: foreign, duration_seconds: 1 }],
    }),
    /File not found/,
  );
  await assert.rejects(
    owner.call("video_export", {
      title: "Offline",
      music: null,
      scenes: [{ text: "Hello", duration_seconds: 1 }],
    }),
    /not connected/,
  );
});

test("scenes that declare their words start when those words are spoken", () => {
  const word = (text: string, start: number) => ({
    text,
    type: "word",
    start,
    end: start + 0.3,
  });
  const transcript = {
    words: [
      word("I", 0.2),
      word("open", 0.5),
      word("Streaks.", 0.9),
      word("I", 4),
      word("hit", 4.3),
      word("recap.", 4.6),
      word("I", 9),
      word("copy.", 9.3),
    ],
  } as any;
  const scenes = [
    { says: "I open" },
    { says: "I hit recap" },
    {},
    { says: "I copy" },
  ];
  // Scene 1 is held to 4 s; scene 3 is cut to fill the 5 s to the last line.
  assert.deepEqual(
    alignScenes(scenes, [2000, 3000, 3000, 1000], transcript),
    [4000, 3000, 2000, 1000],
  );
  // Plain scenes keep their planned lengths.
  assert.deepEqual(
    alignScenes([{}, {}], [2000, 3000], transcript),
    [2000, 3000],
  );
  assert.throws(
    () => alignScenes([{}, { says: "sixteen" }], [1000, 1000], transcript),
    /not spoken/,
  );
  assert.throws(
    () =>
      alignScenes(
        [{ says: "I hit" }, { says: "I open" }],
        [1000, 1000],
        transcript,
      ),
    /spoken order/,
  );
  assert.throws(
    () => alignScenes([{}, { says: "I open" }], [1000, 1000], transcript),
    /at least 0.5 s/,
  );

  // A clip with its own sound pauses the voiceover after "Streaks." for its 10 s; the
  // voice picks up with "I hit", and everything after it comes 10 s later.
  const pauses: { at_ms: number; ms: number }[] = [];
  assert.deepEqual(
    alignScenes(
      [{ says: "I open" }, { sound: true }, { says: "I hit" }, { says: "I copy" }],
      [2000, 10000, 2000, 1000],
      transcript,
      pauses,
    ),
    [1200, 12800, 5000, 1000],
  );
  assert.deepEqual(pauses, [{ at_ms: 1200, ms: 10000 }]);
  assert.deepEqual(
    pausedTranscript(transcript, pauses).words!.map((w) => w.start),
    [0.2, 0.5, 0.9, 14, 14.3, 14.6, 19, 19.3],
  );
  assert.throws(
    () => alignScenes([{ says: "I open", sound: true }], [1000], transcript),
    /nothing is said over it/,
  );
  assert.throws(
    () => alignScenes([{}, { sound: true }, {}], [1000, 1000, 1000], transcript),
    /give it says/,
  );
});

test("captions take the script's words and keep the transcript's timing", () => {
  const word = (text: string, start: number) => ({
    text,
    type: "word",
    start,
    end: start + 0.3,
  });
  const space = { text: " ", type: "spacing", start: 0, end: 0 };
  const result = transcriptWithScript(
    {
      words: [
        word("I", 0.1),
        space,
        word("stop", 0.3),
        space,
        word("guessing.", 0.6),
        word("I", 2),
        word("track", 2.2),
        word("habits", 2.5),
        word("and", 2.8),
        word("streaks", 3),
      ],
    } as any,
    "I stopped guessing. I track habits in Streaks.",
  );
  const words = (result.words ?? []).filter((w) => w.type === "word");
  assert.deepEqual(
    words.map((w) => w.text),
    ["I", "stopped", "guessing.", "I", "track", "habits", "in", "Streaks."],
  );
  assert.equal(words[1].start, 0.3);
  assert.equal(result.words?.[1], space);
  // Words that don't line up one to one stay as heard.
  const uneven = transcriptWithScript(
    { words: [word("sixteen", 0), word("check-ins", 1)] } as any,
    "sixteen really great check-ins",
  );
  assert.deepEqual(
    uneven.words?.map((w) => w.text),
    ["sixteen", "check-ins"],
  );
});

test("the desktop's WAV reaches Meta through the thin route, charged to its own turn", async () => {
  const owner = await founder("media");
  const speech = await owner.call("media_generate_speech", {
    title: "Voice",
    voice_id: "v1",
    text: "Ship it.",
  });
  const device = issueDeviceToken(owner.userId, randomUUID(), secret);
  const headers = {
    Authorization: `Bearer ${device}`,
    "Content-Type": "audio/wav",
  };
  const wav = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4096)]);
  const query = `task_id=${owner.taskId}&turn_id=${owner.turnId}`;

  const audio = await fetch(`${base}/desktop/audio-file?ref=${speech.ref}`, {
    headers,
  });
  assert.equal(audio.status, 200);
  assert.match(((await audio.json()) as any).key, /\.mp3$/);

  const sent = await fetch(`${base}/desktop/transcribe?${query}&diarize=true`, {
    method: "POST",
    headers,
    body: wav,
  });
  assert.equal(sent.status, 200);
  const transcript = (await sent.json()) as any;
  assert.equal(transcript.timestamp_granularity, "turn");
  assert.equal(transcript.words, undefined);
  const request = requests.at(-1)!;
  assert.equal(request.url, "https://api.meta.ai/v1/asr/transcribe");
  const form = request.init.body as FormData;
  assert.equal(
    JSON.parse(await (form.get("request") as Blob).text()).mode,
    "DIARIZATION",
  );
  assert.equal((form.get("audio") as Blob).size, wav.length);
  const {
    rows: [row],
  } = await fixture.db.query(
    "SELECT operation, provider FROM api_requests WHERE turn_id=$1 AND operation='transcription'",
    [owner.turnId],
  );
  assert.deepEqual(row, { operation: "transcription", provider: "meta" });

  // Another founder can use neither this turn nor this audio.
  const other = await founder("media");
  const before = requests.length;
  const otherHeaders = {
    Authorization: `Bearer ${issueDeviceToken(other.userId, randomUUID(), secret)}`,
    "Content-Type": "audio/wav",
  };
  const stolen = await fetch(`${base}/desktop/transcribe?${query}`, {
    method: "POST",
    headers: otherHeaders,
    body: wav,
  });
  assert.equal(stolen.status, 404);
  const file = await fetch(`${base}/desktop/audio-file?ref=${speech.ref}`, {
    headers: otherHeaders,
  });
  assert.equal(file.status, 404);
  assert.equal(requests.length, before);
});

test("a recording's size comes from its header; previews say when the video runs silent or a focus leaves the frame empty", async () => {
  const { mp4Info, silentTail, framingNotes } = await import("../src/plugins/video/index.js");
  const box = (type: string, body: Buffer) => {
    const size = Buffer.alloc(4);
    size.writeUInt32BE(body.length + 8);
    return Buffer.concat([size, Buffer.from(type, "latin1"), body]);
  };
  const mvhd = Buffer.alloc(100);
  mvhd.writeUInt32BE(600, 12);
  mvhd.writeUInt32BE(9 * 600, 16);
  const tkhd = Buffer.alloc(84);
  tkhd.writeUInt32BE(2940 * 65536, 76);
  tkhd.writeUInt32BE(1846 * 65536, 80);
  const file = join(await mkdtemp(join(tmpdir(), "mp4-")), "clip.mp4");
  await writeFile(
    file,
    Buffer.concat([box("ftyp", Buffer.from("isom\0\0\0\0")), box("moov", Buffer.concat([box("mvhd", mvhd), box("trak", box("tkhd", tkhd))]))]),
  );
  assert.deepEqual(await mp4Info(file), { seconds: 9, width: 2940, height: 1846 });

  assert.equal(silentTail(22_000, 19_400), undefined);
  assert.match(silentTail(26_500, 19_400)!, /runs 7\.1 s after the voiceover ends/);

  const aspect = 2940 / 1846;
  // A row of cards is a fine close-up in landscape; a sliver isn't.
  assert.deepEqual(framingNotes([{ focus: { width: 0.78, height: 0.38 }, aspect }], "16:9"), []);
  const [sliver] = framingNotes([{ focus: { width: 0.9, height: 0.2 }, aspect }], "16:9");
  assert.match(sliver, /Scene 1's focus is 7\.2:1 .* Make it taller/);
  assert.deepEqual(framingNotes([{ focus: { width: 0.92, height: 0.84 }, aspect }, {}], "16:9"), []);
  const app = { width: 0.99, height: 0.86 };
  const [overview] = framingNotes([{ focus: app, aspect }, { focus: app, aspect }, { focus: { width: 0.4, height: 0.3 }, aspect }], "16:9");
  assert.match(overview, /^Scenes 1, 2 each show the whole app/);
  const [whole] = framingNotes([{ aspect }, { focus: { width: 0.92, height: 0.84 }, aspect }, { aspect }], "16:9");
  assert.match(whole, /^Scenes 1, 3 show the whole recording/);
  const { unframedClips } = await import("../src/plugins/video/index.js");
  const focus = { x: 0, y: 0, width: 1, height: 1 };
  assert.deepEqual(
    unframedClips([{ video_file: "a" }, { video_file: "a", focus }, { text: "Card" } as any, { video_file: "b", device: "phone" }]),
    [1],
  );
  assert.match(framingNotes([{ focus: { width: 0.9, height: 0.5 }, aspect }], "9:16")[0], /Make it taller/);
});
