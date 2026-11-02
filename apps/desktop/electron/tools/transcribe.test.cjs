const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { media_transcribe, toWav } = require("./transcribe.cjs");

const mp3 = fs.readFileSync(
  path.join(__dirname, "../../../api/tests/fixtures/media/silence.mp3"),
);

test("audio becomes mono 24 kHz 16-bit PCM WAV, without changing the source", async () => {
  const before = Buffer.from(mp3);
  const wav = await toWav(mp3);
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.equal(wav.readUInt16LE(20), 1); // PCM
  assert.equal(wav.readUInt16LE(22), 1); // mono
  assert.equal(wav.readUInt32LE(24), 24000);
  assert.equal(wav.readUInt16LE(34), 16);
  assert.deepEqual(mp3, before);
});

test("audio that isn't audio is refused before anything is sent", async () => {
  await assert.rejects(
    toWav(Buffer.from("not audio")),
    /could not be converted/,
  );
});

test("a saved file is converted and sent to the thin route with its turn", async () => {
  const calls = [];
  const result = await media_transcribe.run(
    { file: "abc12345", diarize: true, language_code: "en" },
    {
      taskId: "task",
      turnId: "turn",
      download: async (key) => {
        assert.equal(key, "users/u/media/a.mp3");
        return { data: mp3 };
      },
      request: async (url, init) => {
        calls.push([url, init]);
        return url.startsWith("audio-file")
          ? { key: "users/u/media/a.mp3" }
          : { text: "Ship it." };
      },
    },
  );
  assert.deepEqual(result, { text: "Ship it." });
  assert.equal(calls[0][0], "audio-file?ref=abc12345");
  assert.equal(
    calls[1][0],
    "transcribe?task_id=task&turn_id=turn&diarize=true&language_code=en",
  );
  assert.equal(calls[1][1].headers["Content-Type"], "audio/wav");
  assert.equal(calls[1][1].body.toString("ascii", 0, 4), "RIFF");
});

test("exactly one source is required", async () => {
  await assert.rejects(media_transcribe.run({}, {}), /exactly one/);
});
