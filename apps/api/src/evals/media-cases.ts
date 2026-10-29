/**
 * Media tool health (level 1): every media plugin tool in one task, except music,
 * which the provider key has no access to. Speech and transcription check each
 * other: the transcript must match the exact sentence.
 */
import type { EvalCheck } from "./computer-eval-types.js";

export const mediaSentence = "Welcome to Personal Brand Agent.";
export const mediaToolsCase = {
  id: "M1",
  name: "Every media tool: image, edit, voices, speech, sound effect, transcription",
  turns: [
    `This is a temporary check of the media tools. Make each of these and deliver every file here as an artifact:
1. One square flat illustration of a small green sprout in a terracotta pot on a warm cream background, with no text.
2. Speech that says exactly: ${mediaSentence} Pick a warm, friendly voice from the available voices.
3. A short, soft notification chime sound effect.
Don't publish anything or save memory.`,
    "Now revise the image: change only the pot to blue, keeping the sprout, square framing and cream background, and keep the original. Then transcribe the speech you made and show me the transcript. Don't make any of the other files again.",
  ],
  criteria: [
    "The original image shows the green sprout in a terracotta pot on a cream background with no text; the revision changes only the pot to blue and both images remain available.",
    "The speech says the exact sentence clearly in the chosen voice and the sound effect is a soft chime. Both play.",
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

export type MediaProcessCase = {
  id: string;
  name: string;
  brief: string;
  criteria: string[];
};

/** Media processes (level 2) beyond video: an image in two shapes, a checked voiceover. */
export const quoteCardCase: MediaProcessCase = {
  id: "quote-card",
  name: "Quote card in my brand, square and portrait",
  brief: `Make a quote card image with this line from my post: "Shipping fast means deciding fast." Use my brand colours. Make it square for LinkedIn, then a portrait version of the same design for Instagram Stories. Deliver both here. Don't publish anything.`,
  criteria: [
    "Both images use the founder's brand colours and show the quote spelled exactly, large and readable.",
    "The portrait version keeps the same design, rearranged to fit the taller shape rather than cropped or stretched.",
  ],
};
export const voiceoverScript =
  "Last month we went from 120 to 310 weekly founders. Join our live AMA on Friday at 7 pm Bangkok time. Sign up at lu.ma/autopilot-ama.";
export const voiceoverCase: MediaProcessCase = {
  id: "checked-voiceover",
  name: "Voiceover checked by transcription",
  brief: `Record this voiceover for my reel in a voice that fits my brand: "${voiceoverScript}" Read the link the way a person would say it. Before you give it to me, check the recording by transcribing it, and fix anything that was said wrong. Deliver the final voiceover here. Don't publish anything.`,
  criteria: [
    "The voice fits the founder's brand; numbers, the time and the link are spoken naturally (\"lu dot ma slash autopilot AMA\"), with nothing skipped or mispronounced.",
  ],
};
// Matched on the normalized transcript; a transcriber may write numbers in words,
// a time as "7:00 PM" (normalized to "700 pm") and the link run together.
const voiceoverFacts = [
  /\b(120|one hundred (and )?twenty)\b/,
  /\b(310|three hundred (and )?ten)\b/,
  /\bfriday\b/,
  /\b(7|700|seven)\b/,
  /\bbangkok\b/,
  /lu ?(dot )?ma/,
  /autopilot ?ama\b/,
];

const refsOf = (call: any) =>
  new Set([
    call.result?.ref,
    ...(call.result?.attachments ?? []).map((a: any) => a.file),
  ]);
const fileOf = (artifact: any) => {
  try {
    return (
      typeof artifact.content === "string"
        ? JSON.parse(artifact.content)
        : artifact.content
    )?.file;
  } catch {
    return undefined;
  }
};

export function gradeQuoteCard(evidence: {
  calls: any[];
  artifacts: any[];
}): EvalCheck[] {
  const ok = evidence.calls.filter((c) => !c.failed);
  const square = ok.filter(
    (c) =>
      c.name === "media_generate_image" &&
      (c.args.size ?? "1024x1024") === "1024x1024",
  );
  // The portrait may be an edit of the square or a new image of the same design;
  // whether the design matches is for the reviewer, not the method.
  const portrait = ok.filter(
    (c) =>
      ["media_generate_image", "media_edit_image"].includes(c.name) &&
      c.args.size === "1024x1536",
  );
  const delivered = (calls: any[]) => {
    const files = new Set(
      calls.flatMap((c) => (c.result?.attachments ?? []).map((a: any) => a.file)),
    );
    return evidence.artifacts.some(
      (a) => a.kind === "image" && files.has(fileOf(a)),
    );
  };
  return [
    { name: "Square image generated", passed: square.length > 0 },
    { name: "Portrait version made", passed: portrait.length > 0 },
    { name: "Square image delivered", passed: delivered(square) },
    { name: "Portrait image delivered", passed: delivered(portrait) },
  ];
}

export function gradeVoiceover(evidence: {
  calls: any[];
  artifacts: any[];
}): EvalCheck[] {
  const ok = evidence.calls.filter((c) => !c.failed);
  const voices = new Set(
    ok
      .filter((c) => c.name === "media_list_voices")
      .flatMap((c) => (c.result?.voices ?? []).map((v: any) => v.voice_id)),
  );
  const speech = ok.filter((c) => c.name === "media_generate_speech");
  const final = speech.at(-1);
  const finalRefs = final ? refsOf(final) : new Set();
  const check = ok.filter(
    (c) =>
      c.name === "media_transcribe" &&
      finalRefs.has(c.args.file) &&
      evidence.calls.indexOf(c) > evidence.calls.indexOf(final),
  );
  const transcript = normalize(String(check.at(-1)?.result?.text ?? ""));
  return [
    {
      name: "Speech uses a voice from media_list_voices",
      passed: !!final && voices.has(final.args.voice_id),
    },
    {
      name: "Final recording transcribed before delivery",
      passed: check.length > 0,
    },
    {
      name: "Transcript keeps every fact in the script",
      passed: voiceoverFacts.every((fact) => fact.test(transcript)),
      details: transcript,
    },
    {
      name: "Final recording delivered",
      passed: evidence.artifacts.some(
        (a) => a.kind === "audio" && finalRefs.has(fileOf(a)),
      ),
    },
    {
      name: "At most three recordings",
      passed: speech.length <= 3,
      details: speech.length,
    },
  ];
}
