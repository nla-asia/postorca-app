import "../env.js";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createImageProviderFromEnv } from "../providers/meta-image.js";
import { createElevenLabsProviderFromEnv } from "../providers/elevenlabs.js";

/** Explicit paid check, matching the original: one draft image, short speech, transcription. */
export async function runMediaSmoke() {
  const images = createImageProviderFromEnv();
  const audio = createElevenLabsProviderFromEnv();
  if (!images || !audio)
    throw new Error(
      "Set the image model's key and ELEVENLABS_API_KEY in apps/api/.env.",
    );
  const started = new Date().toISOString();
  const directory = fileURLToPath(
    new URL(
      `../../.data/media-smoke/${started.replace(/[:.]/g, "-")}/`,
      import.meta.url,
    ),
  );
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const script = "Welcome to Personal Brand Agent.";
  const results = await Promise.allSettled([
    (async () => {
      const image = await images.generateImage({
        prompt:
          "A simple flat illustration of a small green sprout in a terracotta pot, warm cream background, centered, no text.",
        size: "1024x1024",
        quality: "low",
      });
      const path = join(directory, "image.png");
      await writeFile(path, image.data);
      const width = image.data.readUInt32BE(16),
        height = image.data.readUInt32BE(20);
      // Muse Image treats size as an aspect ratio, so only squareness is checked.
      if (width !== height || width < 1024)
        throw new Error("The generated image has unexpected dimensions.");
      console.log(`Image saved: ${path}`);
      return {
        test: "image",
        status: "passed",
        path,
        bytes: image.data.length,
        width,
        height,
        requestId: image.requestId,
        usage: image.usage,
      };
    })(),
    (async () => {
      const voices = await audio.listVoices({ pageSize: 10 });
      const voice = voices.voices[0];
      if (!voice) throw new Error("No available ElevenLabs voices.");
      const speech = await audio.generateSpeech({
        text: script,
        voiceId: voice.voice_id,
        modelId: "eleven_multilingual_v2",
      });
      const path = join(directory, "speech.mp3");
      await writeFile(path, speech.data);
      console.log(`Speech saved: ${path}`);
      const transcript = await audio.transcribe({
        file: new Blob([new Uint8Array(speech.data)], {
          type: speech.mimeType,
        }),
        filename: "speech.mp3",
        modelId: "scribe_v2",
      });
      await writeFile(
        join(directory, "transcript.json"),
        JSON.stringify(transcript, null, 2),
      );
      if (!/welcome to personal brand agent/i.test(transcript.text))
        throw new Error("Transcript did not match the spoken script.");
      console.log("Speech transcription matches the script.");
      return {
        test: "speech_and_transcription",
        status: "passed",
        path,
        bytes: speech.data.length,
        voiceId: voice.voice_id,
        transcript: transcript.text,
      };
    })(),
  ]);
  const checks = results.map((result, index) =>
    result.status === "fulfilled"
      ? result.value
      : {
          test: index === 0 ? "image" : "speech_and_transcription",
          status: "failed",
          // Provider error messages/bodies may contain secrets or scripts. Keep only diagnostic metadata.
          error: result.reason?.name ?? "Error",
          http_status: result.reason?.status ?? null,
          code: result.reason?.code ?? null,
        },
  );
  const report = {
    started,
    finished: new Date().toISOString(),
    passed: results.every((result) => result.status === "fulfilled"),
    checks,
    acceptance: { imageVisualReview: "pending", speechListening: "pending" },
  };
  await writeFile(
    join(directory, "report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
  console.log(`Report: ${join(directory, "report.json")}`);
  return report;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runMediaSmoke().then(
    (report) => {
      if (!report.passed) process.exitCode = 1;
    },
    (error) => {
      console.error(
        error instanceof Error ? error.message : "Media smoke setup failed.",
      );
      process.exitCode = 1;
    },
  );
}
