/**
 * Media tool health (level 1): every media plugin tool in one task. Speech and
 * transcription check each other: the transcript must match the exact sentence.
 */
import type { EvalCheck } from "./computer-eval-types.js";

export const mediaSentence = "Welcome to Personal Brand Agent.";
export const mediaToolsCase = {
  id: "M1",
  name: "Every media tool: image, edit, voices, speech, music, sound effect, transcription",
  turns: [
    `This is a temporary check of the media tools. Make each of these and deliver every file here as an artifact:
1. One square flat illustration of a small green sprout in a terracotta pot on a warm cream background, with no text.
2. Speech that says exactly: ${mediaSentence} Pick a warm, friendly voice from the available voices.
3. About 10 seconds of calm instrumental background music.
4. A short, soft notification chime sound effect.
Don't publish anything or save memory.`,
    "Now revise the image: change only the pot to blue, keeping the sprout, square framing and cream background, and keep the original. Then transcribe the speech you made and show me the transcript. Don't make any of the other files again.",
  ],
  criteria: [
    "The original image shows the green sprout in a terracotta pot on a cream background with no text; the revision changes only the pot to blue and both images remain available.",
    "The speech says the exact sentence clearly in the chosen voice; the music is calm and instrumental; the sound effect is a soft chime. All play.",
  ],
};

const normalize = (text: string) =>
  text.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();

export function gradeMediaTools(evidence: {
  turns: any[];
  calls: any[];
}): EvalCheck[] {
  const [first, second] = evidence.turns;
  const inTurn = (turn: any, name: string) =>
    evidence.calls.filter(
      (c) => c.turn_id === turn?.id && c.name === name && !c.failed,
    );
  const kinds = (turn: any) =>
    new Set((turn?.artifacts ?? []).map((a: any) => a.kind));
  const voices = new Set(
    inTurn(first, "media_list_voices").flatMap((c) =>
      (c.result?.voices ?? []).map((v: any) => v.voice_id),
    ),
  );
  const speech = inTurn(first, "media_generate_speech");
  const transcripts = inTurn(second, "media_transcribe").map((c) =>
    String(c.result?.text ?? ""),
  );
  const repeated = [
    "media_generate_image",
    "media_generate_speech",
    "media_generate_music",
    "media_generate_sound_effect",
  ].filter((name) => inTurn(second, name).length);
  return [
    {
      name: "Image generated",
      passed: inTurn(first, "media_generate_image").length > 0,
    },
    {
      name: "Speech uses a voice from media_list_voices",
      passed: speech.some((c) => voices.has(c.args.voice_id)),
    },
    {
      name: "Speech says the exact sentence",
      passed: speech.some(
        (c) => normalize(c.args.text ?? "") === normalize(mediaSentence),
      ),
    },
    {
      name: "Music generated",
      passed: inTurn(first, "media_generate_music").length > 0,
    },
    {
      name: "Sound effect generated",
      passed: inTurn(first, "media_generate_sound_effect").length > 0,
    },
    {
      name: "Image and audio delivered as artifacts",
      passed: kinds(first).has("image") && kinds(first).has("audio"),
    },
    {
      name: "Image edited, not regenerated",
      passed: inTurn(second, "media_edit_image").length > 0,
    },
    {
      name: "Transcript matches the spoken sentence",
      passed: transcripts.some(
        (text) => normalize(text) === normalize(mediaSentence),
      ),
      details: transcripts,
    },
    {
      name: "Nothing else made again in the revision",
      passed: !repeated.length,
      details: repeated,
    },
  ];
}
