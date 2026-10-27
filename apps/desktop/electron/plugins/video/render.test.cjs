const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { serveAssets, captionsFromTranscript } = require("./render.cjs");
const { makeFixtures, screenPng } = require("./fixtures.cjs");
let directory, assets;
before(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "postorca-render-test-"));
  await makeFixtures(directory);
  assets = await serveAssets(directory);
});
after(async () => {
  await assets?.close();
  await fs.rm(directory, { recursive: true, force: true });
});
test("render assets preserve image bytes and support media range reads", async () => {
  const image = await fetch(`${assets.url}/screen.png`);
  assert.equal(image.headers.get("content-type"), "image/png");
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), screenPng());
  const partial = await fetch(`${assets.url}/tone.wav`, {
    headers: { Range: "bytes=10-19" },
  });
  assert.equal(partial.status, 206);
  assert.equal((await partial.arrayBuffer()).byteLength, 10);
  const size = (await fs.stat(path.join(directory, "tone.wav"))).size;
  const suffix = await fetch(`${assets.url}/tone.wav`, {
    headers: { Range: "bytes=-5" },
  });
  assert.equal(
    suffix.headers.get("content-range"),
    `bytes ${size - 5}-${size - 1}/${size}`,
  );
  assert.equal(
    (
      await fetch(`${assets.url}/tone.wav`, {
        headers: { Range: `bytes=${size}-` },
      })
    ).status,
    416,
  );
});
test("render assets refuse traversal, hidden files, malformed URLs and unsupported types", async () => {
  for (const tail of [
    "..%2Fscreen.png",
    "%2e%2e%5Cscreen.png",
    ".secret.png",
    "%E0%A4%A",
    "missing.png",
    "fixture.json",
  ])
    assert.equal((await fetch(`${assets.url}/${tail}`)).status, 404, tail);
  assert.equal(
    (await fetch(`${new URL(assets.url).origin}/screen.png`)).status,
    404,
  );
});
test("word timing is converted to caption milliseconds with spacing preserved", () => {
  const captions = captionsFromTranscript({
    language_code: "en",
    text: "Ship it",
    words: [
      { text: "Ship", type: "word", start: 0, end: 0.4 },
      { text: " ", type: "spacing", start: 0.4, end: 0.5 },
      { text: "it", type: "word", start: 0.5, end: 0.8 },
    ],
  });
  assert.deepEqual(
    captions.map(({ text, startMs, endMs }) => ({ text, startMs, endMs })),
    [
      { text: "Ship", startMs: 0, endMs: 400 },
      { text: " it", startMs: 400, endMs: 800 },
    ],
  );
});
