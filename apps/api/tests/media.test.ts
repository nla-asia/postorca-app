import assert from "node:assert/strict";
import { before, after, test, mock } from "node:test";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
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
import { alignScenes } from "../src/plugins/video/index.js";
import { temporaryPostgres } from "./postgres.js";

const secret = "media-suite-test-secret-at-least-32-characters";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB9sAAAAASUVORK5CYII=",
  "base64",
);
const mp3 = Buffer.from("ID3fixture");
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
  const transcript = await owner.call("media_transcribe", {
    file: speech.ref,
    diarize: true,
  });
  assert.equal(transcript.text, "Ship it.");
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
  await assert.rejects(owner.call("media_transcribe", {}), /exactly one/);
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
  assert.ok(state.skills.some((skill) => skill.name === "video-product-demo"));
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
    { video_file: clip, start_seconds: 4.5 },
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
  assert.match(scenes[0].file, /\.mp4$/);
  assert.equal(scenes[0].device, "browser");
  assert.equal(result.duration_seconds, 9);
  // Each clip scene is its own shot: three shots in 9 s.
  assert.equal(result.pacing, undefined);

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
});
