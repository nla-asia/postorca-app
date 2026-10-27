import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { createApp } from "../src/app.js";
import { configFromEnv } from "../src/config.js";
import { migrate } from "../src/migrate.js";
import { issueDeviceToken, issueToken } from "../src/middleware/auth.js";
import {
  createTask,
  createTurn,
  taskDetail,
} from "../src/repositories/tasks.js";
import { createUser } from "../src/repositories/users.js";
import {
  describeFile,
  detectDownloadType,
  fileRef,
  isUserFileKey,
  loadFile,
  saveDownload,
  saveFile,
} from "../src/storage.js";
import { executeTool } from "../src/tools/index.js";
import { artifactMedia, messageMedia } from "../../desktop/src/lib/media.js";
import { temporaryPostgres } from "./postgres.js";

const secret = "files-test-secret-at-least-32-characters";
let fixture: Awaited<ReturnType<typeof temporaryPostgres>>;
let storage: string;
const previousStorage = process.env.STORAGE_DIR;
let server: Server;
let base: string;
let accountNumber = 0;
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB9sAAAAASUVORK5CYII=",
  "base64",
);
const mp3 = Buffer.from("ID3audio-test");

before(async () => {
  fixture = await temporaryPostgres();
  await migrate(fixture.db);
  storage = await mkdtemp(join(tmpdir(), "postorca-files-storage-"));
  process.env.STORAGE_DIR = storage;
  server = createApp(
    fixture.db,
    configFromEnv({ DATABASE_URL: fixture.url, JWT_SECRET: secret }),
  ).listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
after(async () => {
  if (server)
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  if (previousStorage === undefined) delete process.env.STORAGE_DIR;
  else process.env.STORAGE_DIR = previousStorage;
  await rm(storage, { recursive: true, force: true });
  await fixture?.close();
});

async function account() {
  const user = await createUser(
    fixture.db,
    "Founder",
    `files-${++accountNumber}@example.com`,
    "files-test-password",
  );
  return {
    id: user.id as string,
    token: issueToken(user.id, secret),
    device: issueDeviceToken(user.id, randomUUID(), secret),
  };
}

test("desktops stream original files with their metadata; founders read them back with ranges", async () => {
  const founder = await account();
  const other = await account();
  const data = Buffer.from("%PDF-1.7\noriginal file bytes\n");
  const metadata = {
    filename: "Résumé 文書.pdf",
    source_url: "https://example.com/source",
    download_url: "https://example.com/file",
    reported_type: "image/jpeg",
  };
  const headers = {
    "Content-Type": "application/octet-stream",
    "X-PostOrca-File": encodeURIComponent(JSON.stringify(metadata)),
  };
  const upload = (authorization?: string, body: Buffer = data, extra = {}) =>
    fetch(`${base}/desktop/downloads`, {
      method: "POST",
      headers: {
        ...headers,
        ...extra,
        ...(authorization ? { Authorization: `Bearer ${authorization}` } : {}),
      },
      body,
    });
  // Only a device can import files.
  assert.equal((await upload()).status, 401);
  assert.equal((await upload(founder.token)).status, 401);
  assert.equal(
    (await upload(founder.device, data, { "X-PostOrca-File": "%E0%A4%A" })).status,
    400,
  );
  assert.equal(
    (await upload(founder.device, data, { "Content-Type": "text/plain" })).status,
    400,
  );
  const response = await upload(founder.device);
  assert.equal(response.status, 201);
  const result = (await response.json()) as {
    file: string;
    mime_type: string;
    sha256: string;
    bytes: number;
    filename: string;
  };
  // The type comes from the bytes, never from what the site claimed.
  assert.equal(result.mime_type, "application/pdf");
  assert.equal(result.bytes, data.length);
  assert.equal(result.filename, metadata.filename);
  assert.equal(result.sha256, createHash("sha256").update(data).digest("hex"));
  assert.deepEqual(await loadFile(result.file), data);
  assert.equal((await describeFile(result.file)).filename, metadata.filename);
  assert.equal(isUserFileKey(other.id, result.file), false);

  const read = (token: string, extra: Record<string, string> = {}) =>
    fetch(`${base}/files?key=${encodeURIComponent(result.file)}`, {
      headers: { Authorization: `Bearer ${token}`, ...extra },
    });
  const range = await read(founder.token, { Range: "bytes=0-4" });
  assert.equal(range.status, 206);
  assert.equal(await range.text(), "%PDF-");
  const whole = await read(founder.token);
  assert.equal(whole.headers.get("content-type"), "application/pdf");
  assert.equal(whole.headers.get("cache-control"), "private, no-store");
  // Downloads are offered as attachments, never rendered inline.
  assert.match(whole.headers.get("content-disposition")!, /^attachment/);
  assert.deepEqual(Buffer.from(await whole.arrayBuffer()), data);
  // Nobody else can read it, with or without a token.
  assert.equal((await read(other.token)).status, 404);
  assert.equal((await fetch(`${base}/files?key=${result.file}`)).status, 401);
  assert.equal(
    (
      await fetch(`${base}/files?key=${encodeURIComponent("../../etc/passwd")}`, {
        headers: { Authorization: `Bearer ${founder.token}` },
      })
    ).status,
    404,
  );
  // A desktop reads the founder's files with its device token.
  const desktopRead = await fetch(
    `${base}/desktop/files?key=${encodeURIComponent(result.file)}`,
    { headers: { Authorization: `Bearer ${founder.device}` } },
  );
  assert.equal(desktopRead.status, 200);
  assert.deepEqual(Buffer.from(await desktopRead.arrayBuffer()), data);
  // The desktop shows a download only as a structured tool attachment.
  assert.equal(
    messageMedia({
      kind: "tool_result",
      content: {
        result: {
          attachments: [
            {
              kind: "download",
              file: result.file,
              mime_type: result.mime_type,
              filename: metadata.filename,
            },
          ],
        },
      },
    }).length,
    1,
  );
});

test("downloads detect their type from the bytes and never keep partial files", async () => {
  const founder = await account();
  const metadata = { filename: "page.html" };
  const unknown = await saveDownload(
    founder.id,
    Readable.from([Buffer.from("<html>login page</html>")]),
    metadata,
  );
  assert.equal(unknown.mime_type, "application/octet-stream");
  assert.equal(detectDownloadType(Buffer.from("ID3abcdef")), "audio/mpeg");
  assert.equal(detectDownloadType(Buffer.from("0000ftypM4A ")), "audio/mp4");
  assert.equal(detectDownloadType(png), "image/png");
  const interrupted = new Readable({
    read() {
      this.push(Buffer.from("partial"));
      this.destroy(new Error("connection interrupted"));
    },
  });
  await assert.rejects(saveDownload(founder.id, interrupted, metadata), /interrupted/);
  // Exercise the streamed cap without allocating a 201 MB buffer.
  function* oversized() {
    const chunk = Buffer.alloc(1024 * 1024);
    for (let index = 0; index < 201; index++) yield chunk;
  }
  await assert.rejects(
    saveDownload(founder.id, Readable.from(oversized()), metadata),
    /exceeds 200 MB/,
  );
  await assert.rejects(
    saveDownload(founder.id, Readable.from([]), metadata),
    /empty/,
  );
  // One complete file and its metadata sidecar; no partial files.
  const files = await readdir(join(storage, "users", founder.id, "downloads"));
  assert.equal(files.length, 2);
});

test("desktops upload screenshots, MP3s and MP4s, each saved where it belongs", async () => {
  const founder = await account();
  const post = (body: Buffer, type: string) =>
    fetch(`${base}/desktop/files`, {
      method: "POST",
      headers: { "Content-Type": type, Authorization: `Bearer ${founder.device}` },
      body,
    });
  for (const [body, type, pattern] of [
    [png, "image/png", /\/screenshots\/[0-9a-f-]{36}\.png$/],
    [mp3, "audio/mpeg", /\/media\/[0-9a-f-]{36}\.mp3$/],
    [Buffer.from("video-fixture"), "video/mp4", /\/media\/[0-9a-f-]{36}\.mp4$/],
  ] as const) {
    const saved = await post(body, type);
    assert.equal(saved.status, 201);
    const { file } = (await saved.json()) as { file: string };
    assert.match(file, pattern);
    assert.ok(file.startsWith(`users/${founder.id}/`));
    assert.deepEqual(await loadFile(file), body);
  }
  assert.equal((await post(Buffer.from("text"), "text/plain")).status, 400);
});

test("media artifacts resolve owned originals, store preview metadata and reject unsafe refs and wrong types", async () => {
  const founder = await account();
  const other = await account();
  const task = await createTask(fixture.db, founder.id, "work", "Review assets");
  const turn = await createTurn(fixture.db, founder.id, task.id, "Deliver originals");
  const context = { userId: founder.id, taskId: task.id, turnId: turn.id };
  const original = await saveDownload(founder.id, Readable.from([png]), {
    filename: "original.png",
  });
  const audio = await saveFile(founder.id, "media", mp3, "audio/mpeg");
  const video = await saveFile(
    founder.id,
    "media",
    Buffer.from("video-fixture"),
    "video/mp4",
  );
  for (const [kind, key] of [
    ["image", original.file],
    ["audio", audio],
    ["video", video],
  ]) {
    const result: any = await executeTool(fixture.db, context, "create_artifact", {
      kind,
      title: `Review ${kind}`,
      content: fileRef(key),
    });
    const metadata = JSON.parse(result.content);
    assert.equal(metadata.file, key);
    assert.match(metadata.url, /^\/api\/files\?key=/);
    const preview = artifactMedia(result);
    assert.equal(preview?.file, key);
    assert.equal(preview?.title, `Review ${kind}`);
    const response = await fetch(`${base}/files?key=${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${founder.token}` },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), await loadFile(key));
  }
  const image = JSON.parse(
    (await taskDetail(fixture.db, founder.id, task.id)).turns[0].artifacts.find(
      (item: { kind: string }) => item.kind === "image",
    ).content,
  );
  assert.equal(image.filename, "original.png");
  assert.equal(image.bytes, png.length);
  const detail = await taskDetail(fixture.db, founder.id, task.id);
  assert.deepEqual(
    detail.turns[0].artifacts.map((item: { kind: string }) => item.kind).sort(),
    ["audio", "image", "video"],
  );
  const foreign = await saveFile(other.id, "media", png, "image/png");
  for (const content of [
    foreign,
    fileRef(foreign),
    "https://example.com/image.png",
    "../../secret",
  ])
    await assert.rejects(
      executeTool(fixture.db, context, "create_artifact", {
        kind: "image",
        title: "No",
        content,
      }),
      /file not found/i,
    );
  await assert.rejects(
    executeTool(fixture.db, context, "create_artifact", {
      kind: "audio",
      title: "No",
      content: original.file,
    }),
    /saved audio/,
  );
  await assert.rejects(
    executeTool(fixture.db, context, "create_artifact", {
      kind: "image",
      title: "No",
      content: original.file.replace(
        /[0-9a-f-]+\.bin$/,
        "00000000-0000-0000-0000-000000000000.png",
      ),
    }),
    /file not found/i,
  );
  // The desktop never renders model-written URLs or mismatched types.
  assert.equal(
    artifactMedia({
      kind: "image",
      title: "No",
      content: JSON.stringify({
        file: "https://example.com/x.png",
        mime_type: "image/png",
      }),
    }),
    null,
  );
  assert.equal(artifactMedia({ kind: "image", title: "No", content: "invalid" }), null);
  assert.equal(
    artifactMedia({
      kind: "video",
      title: "No",
      content: JSON.stringify({ file: audio, mime_type: "audio/mpeg" }),
    }),
    null,
  );
});
