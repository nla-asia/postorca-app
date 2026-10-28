import type { VideoCase } from "./video-cases.js";
export type Check = { name: string; ok: boolean | null; detail: string };
export type EvalMessage = { kind: string; content: any };
export type EvalArtifact = {
  id: string;
  kind: string;
  content: string;
  title?: string;
};

export function toolEvidence(messages: EvalMessage[]) {
  const results = new Map(
    messages
      .filter((message) => message.kind === "tool_result")
      .map((message) => [message.content.callId, message.content.result]),
  );
  return messages
    .filter((message) => message.kind === "tool_call")
    .map((message) => {
      const call = message.content;
      let args: any = {};
      try {
        args =
          typeof call.arguments === "string"
            ? JSON.parse(call.arguments)
            : (call.arguments ?? {});
      } catch {
        /* Preserve malformed calls as failures. */
      }
      const result = results.get(call.callId);
      return {
        name: String(call.name),
        callId: String(call.callId),
        args,
        result,
        failed: result == null || result.error !== undefined,
      };
    });
}

export function gradeVideo(
  entry: VideoCase,
  messages: EvalMessage[],
  artifacts: EvalArtifact[],
  expectedExports: number,
) {
  const calls = toolEvidence(messages);
  const named = (name: string) => calls.filter((call) => call.name === name);
  const exports = named("video_export").filter((call) => !call.failed);
  const checks: Check[] = [];
  const check = (name: string, ok: boolean | null, detail = "") =>
    checks.push({ name, ok, detail });
  const files = exports.flatMap((call) =>
    (call.result.attachments ?? [])
      .filter((attachment: any) => attachment.mime_type === "video/mp4")
      .map((attachment: any) => String(attachment.file)),
  );
  check(
    "Exported the expected MP4s",
    files.length === expectedExports,
    `${files.length} of ${expectedExports}`,
  );
  const delivered = artifacts
    .filter((artifact) => artifact.kind === "video")
    .flatMap((artifact) => {
      try {
        return [JSON.parse(artifact.content).file];
      } catch {
        return [];
      }
    });
  check(
    "Exported files delivered as video artifacts",
    files.length > 0 && files.every((file) => delivered.includes(file)),
    `${delivered.length} video artifacts`,
  );
  if (entry.expect.skill)
    check(
      `Read ${entry.expect.skill}`,
      named("read_skill").some(
        (call) => !call.failed && call.args.name === entry.expect.skill,
      ),
    );
  // Retain the original conservative rule. Navigation is reported for review, not proof of publishing.
  const browserInputs = calls.filter((call) =>
    ["browser_click", "browser_type", "browser_press"].includes(call.name),
  );
  check(
    "No browser inputs during this creation-only task",
    browserInputs.length === 0,
    browserInputs.map((call) => call.name).join(", "),
  );
  check(
    "No publishing tool called",
    !calls.some((call) =>
      /^(schedule_post|record_post_result)$/.test(call.name),
    ),
  );
  const paid = new Set([
    "media_generate_image",
    "media_edit_image",
    "media_generate_speech",
    "media_generate_music",
    "media_generate_sound_effect",
    "media_transcribe",
    "video_export",
  ]);
  const providerFailures = new Set<string>();
  let retries = 0;
  for (const call of calls) {
    if (!paid.has(call.name)) continue;
    if (providerFailures.has(call.name)) retries++;
    if (
      call.failed &&
      !/^(File not found|Invalid arguments|Choose a saved|Provide exactly one)/.test(
        String(call.result?.error ?? ""),
      )
    )
      providerFailures.add(call.name);
  }
  check(
    "No paid retry after a failure",
    retries === 0,
    `${retries} calls after a failure of the same paid tool`,
  );
  const imported = new Map<string, string>();
  const screenshots = new Map<string, string>();
  for (const call of named("read_file"))
    for (const attachment of call.result?.attachments ?? []) {
      const ref =
        attachment.ref ??
        String(attachment.file).split("/").at(-1)?.slice(0, 8);
      if (attachment.mime_type === "audio/mpeg")
        imported.set(ref, String(call.args.path).split(/[\\/]/).at(-1) ?? "");
      if (String(attachment.mime_type).startsWith("image/"))
        screenshots.set(ref, String(call.args.path));
    }
  const speech = named("media_generate_speech").map((call) =>
    String(call.args.text ?? ""),
  );
  const texts: string[] = [];
  for (const [index, call] of exports.entries()) {
    const args = call.args;
    const scenes: any[] = args.scenes ?? [];
    texts.push(...scenes.map((scene) => String(scene.text ?? "")));
    const earlierPreviews = calls
      .slice(0, calls.indexOf(call))
      .filter((item) => item.name === "video_preview_frames" && !item.failed);
    check(
      `Export ${index + 1} previewed before rendering`,
      earlierPreviews.length > 0,
    );
    check(
      `Export ${index + 1} opens on a hook sticker over an image`,
      !!(scenes[0]?.image_file && scenes[0]?.text),
      scenes[0]?.text ?? "",
    );
    const shots: number[] = [];
    scenes.forEach((scene, position) => {
      const previous = scenes[position - 1];
      if (
        position &&
        scene.image_file &&
        previous.image_file === scene.image_file &&
        JSON.stringify(previous.focus ?? null) ===
          JSON.stringify(scene.focus ?? null)
      )
        shots[shots.length - 1] += scene.duration_seconds;
      else shots.push(scene.duration_seconds);
    });
    const average =
      shots.reduce((sum, value) => sum + value, 0) / Math.max(1, shots.length);
    check(
      `Export ${index + 1} cuts every 2–3 s on average`,
      average <= 3,
      `${shots.length} shots, mean ${average.toFixed(1)} s, longest ${Math.max(0, ...shots).toFixed(1)} s`,
    );
    check(
      entry.expect.brandOverride
        ? "Overrode colours as requested"
        : "Used the profile's colours",
      entry.expect.brandOverride ? !!args.brand : !args.brand,
      JSON.stringify(args.brand ?? null),
    );
    if (args.voiceover_file)
      check(
        entry.expect.captionsOff
          ? "Captions disabled as requested"
          : "Captions enabled",
        entry.expect.captionsOff
          ? args.captions === false
          : args.captions !== false,
      );
    if (entry.expect.formats)
      check(
        "Format suits the platform",
        entry.expect.formats.includes(args.format ?? "9:16"),
        args.format ?? "9:16",
      );
    const screens = entry.expect.screens;
    if (screens) {
      const used = scenes.filter((scene) =>
        screenshots
          .get(scene.image_file)
          ?.toLowerCase()
          .includes(screens.folder),
      );
      check(
        "Used the supplied screenshots",
        new Set(used.map((scene) => scene.image_file)).size >= screens.min,
      );
      if (screens.contain)
        check(
          "Shows a whole window",
          used.some((scene) => scene.fit === "contain" || scene.device),
        );
      if (screens.focus)
        check(
          "Focuses or highlights a relevant region",
          used.some((scene) => scene.focus || scene.highlight),
        );
    }
    const music = entry.expect.music;
    if (music) {
      const title = imported.get(args.music?.file);
      check(
        "Music comes from a supplied local file",
        !!title && named("media_generate_music").length === 0,
        title ?? "no imported music",
      );
      if (music.title)
        check(
          "Selected the requested track/mood",
          !!title && new RegExp(music.title, "i").test(title),
          title ?? "",
        );
      if (music.notTitle)
        check(
          "Avoided tracks unsuitable for the requested mood",
          !!title && !new RegExp(music.notTitle, "i").test(title),
          title ?? "",
        );
      if (music.minStart !== undefined)
        check(
          "Skipped the quiet intro",
          (args.music?.start_seconds ?? 0) >= music.minStart,
        );
      if (music.noVoiceover)
        check("No voiceover as requested", !args.voiceover_file);
      else
        check(
          "Music kept quiet under speech with ducking",
          args.music?.duck !== false && (args.music?.volume ?? 0.15) <= 0.25,
        );
    }
  }
  // Rejected calls produce no image whose style can be evaluated. Keep those
  // calls in errors/usage and paid-retry checks; assess style on successful work.
  const prompts = named("media_generate_image")
    .filter((call) => !call.failed)
    .map((call) => String(call.args.prompt ?? ""));
  if (prompts.length)
    check(
      "Requested candid phone-style images",
      prompts.every((prompt) =>
        /smartphone|phone|candid|handheld/i.test(prompt),
      ),
      `${prompts.length} image calls`,
    );
  const corpus = [...speech, ...texts].join("\n");
  for (const pattern of entry.expect.mustInclude ?? [])
    check(`Includes /${pattern}/`, new RegExp(pattern, "i").test(corpus));
  if (entry.expect.listNumbers)
    check(
      "Review numbers for unsupported additions",
      null,
      [...new Set(corpus.match(/\d[\d,.%]*/g) ?? [])].join(", "),
    );
  check(
    "Watch complete video with sound",
    null,
    "Frames cannot establish full motion, pronunciation, delivery or music balance.",
  );
  return {
    checks,
    files,
    speech,
    texts,
    calls,
    errors: calls
      .filter((call) => call.failed)
      .map(
        (call) =>
          `${call.name}: ${String(call.result?.error ?? "Missing result").slice(0, 500)}`,
      ),
    summary:
      messages
        .filter(
          (message) => message.kind === "assistant" && message.content.text,
        )
        .at(-1)?.content.text ?? "",
    usage: Object.fromEntries(
      [
        "media_generate_image",
        "media_edit_image",
        "media_generate_speech",
        "media_generate_music",
        "media_transcribe",
        "video_preview_frames",
        "video_export",
      ].map((name) => [name, named(name).length]),
    ),
  };
}
