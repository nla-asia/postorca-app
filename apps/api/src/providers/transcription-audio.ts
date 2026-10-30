import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { HttpError } from "../handlers/errors.js";

const run = promisify(execFile);
const require = createRequire(import.meta.url);
export const MAX_AUDIO_BYTES = 32 * 1024 * 1024;

/** Same packaged FFmpeg binaries as desktop, also installed in the API workspace.
 * Only temporary input/output are converted; saved originals are never changed. */
export async function transcriptionWav(file: Blob, signal: AbortSignal) {
  if (!file.size || file.size > MAX_AUDIO_BYTES)
    throw new HttpError(
      400,
      "Meta transcription needs a nonempty audio file up to 32 MB.",
    );
  signal.throwIfAborted();
  const suffix =
    process.platform === "win32"
      ? "-msvc"
      : process.platform === "linux"
        ? (
            process.report.getReport() as {
              header: { glibcVersionRuntime?: string };
            }
          ).header.glibcVersionRuntime
          ? "-gnu"
          : "-musl"
        : "";
  const directory = dirname(
    require.resolve(
      `@remotion/compositor-${process.platform}-${process.arch}${suffix}/package.json`,
    ),
  );
  const temporary = await mkdtemp(join(tmpdir(), "postorca-transcribe-"));
  try {
    const input = join(temporary, "input"),
      output = join(temporary, "audio.wav");
    await writeFile(input, new Uint8Array(await file.arrayBuffer()), {
      mode: 0o600,
    });
    try {
      await run(
        join(directory, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg"),
        [
          "-nostdin",
          "-v",
          "error",
          "-protocol_whitelist",
          "file,pipe",
          "-format_whitelist",
          "mp3,wav,mov,flac,ogg,matroska,webm,aac",
          "-i",
          input,
          "-map",
          "0:a:0",
          "-vn",
          "-t",
          "601",
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
        { cwd: directory, signal, timeout: 60_000 },
      );
    } catch {
      signal.throwIfAborted();
      throw new HttpError(
        400,
        "The audio could not be converted for Meta transcription. Supply a valid audio recording.",
      );
    }
    const wav = await readFile(output);
    // The bitexact PCM WAV output contains a fmt chunk followed by its data chunk.
    let dataBytes = 0;
    for (let offset = 12; offset + 8 <= wav.length; ) {
      const size = wav.readUInt32LE(offset + 4);
      if (wav.toString("ascii", offset, offset + 4) === "data") {
        dataBytes = size;
        break;
      }
      offset += 8 + size + (size % 2);
    }
    if (!dataBytes || dataBytes > 600 * 24000 * 2)
      throw new HttpError(
        400,
        "Meta transcription supports recordings up to 10 minutes. Supply a shorter recording.",
      );
    return new Blob([new Uint8Array(wav)], { type: "audio/wav" });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
