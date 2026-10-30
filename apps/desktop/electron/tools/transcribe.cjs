// media_transcribe with Meta, whose API takes only WAV. The API server converts
// nothing, so the desktop fetches the audio, converts a temporary copy with its own
// ffmpeg, and sends the WAV to a thin API route that calls Meta and records the charge.
const { execFile } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { promisify } = require("node:util");
const { mediaBinary } = require("./files.cjs");

const run = promisify(execFile);
const MAX_SOURCE_BYTES = 200 * 1024 * 1024;
const MAX_WAV_BYTES = 32 * 1024 * 1024;
const MAX_SECONDS = 600;
const BYTES_PER_SECOND = 24000 * 2;

async function sourceFrom(args, context) {
  if (args.file) {
    const { key } = await context.request(
      `audio-file?ref=${encodeURIComponent(args.file)}`,
      { signal: context.signal },
    );
    return (await context.download(key)).data;
  }
  const response = await fetch(args.source_url, { signal: context.signal });
  if (!response.ok)
    throw new Error(`Could not download the audio: HTTP ${response.status}.`);
  const data = Buffer.from(await response.arrayBuffer());
  if (!data.length || data.length > MAX_SOURCE_BYTES)
    throw new Error("The audio must be nonempty and at most 200 MB.");
  return data;
}

/** Mono 24 kHz 16-bit PCM; the saved original is never changed. */
async function toWav(source, signal, binary = mediaBinary("ffmpeg")) {
  const temporary = await fs.mkdtemp(
    path.join(os.tmpdir(), "postorca-transcribe-"),
  );
  try {
    const input = path.join(temporary, "input");
    const output = path.join(temporary, "audio.wav");
    await fs.writeFile(input, source, { mode: 0o600 });
    try {
      await run(
        binary.filename,
        [
          "-nostdin",
          "-v",
          "error",
          "-i",
          input,
          "-map",
          "0:a:0",
          "-vn",
          "-t",
          String(MAX_SECONDS + 1),
          "-ac",
          "1",
          "-ar",
          "24000",
          "-c:a",
          "pcm_s16le",
          "-map_metadata",
          "-1",
          "-fflags",
          "+bitexact",
          "-y",
          output,
        ],
        { cwd: binary.directory, signal, timeout: 60_000 },
      );
    } catch (error) {
      signal?.throwIfAborted();
      throw new Error(
        "The audio could not be converted for transcription. Supply a valid audio recording.",
        { cause: error },
      );
    }
    const wav = await fs.readFile(output);
    // At most 10 minutes: the 44-byte header aside, the size gives the length.
    if ((wav.length - 44) / BYTES_PER_SECOND > MAX_SECONDS)
      throw new Error(
        "Transcription supports recordings up to 10 minutes. Supply a shorter recording.",
      );
    return wav;
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
}

const media_transcribe = {
  run: async (args, context) => {
    if (!!args.file === !!args.source_url)
      throw new Error("Provide exactly one of file or source_url.");
    const wav = await toWav(await sourceFrom(args, context), context.signal);
    if (wav.length > MAX_WAV_BYTES)
      throw new Error("The converted audio is over the 32 MB limit.");
    const query = new URLSearchParams({
      task_id: context.taskId,
      turn_id: context.turnId,
      ...(args.diarize !== undefined && { diarize: String(args.diarize) }),
      ...(args.language_code && { language_code: args.language_code }),
    });
    return context.request(`transcribe?${query}`, {
      method: "POST",
      headers: { "Content-Type": "audio/wav" },
      body: wav,
      signal: context.signal,
    });
  },
};

module.exports = { media_transcribe, toWav };
