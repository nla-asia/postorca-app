/** Temporary spending envelopes, not final charges. Unknown costs retain their hold.
 * Explicit models prevent a model change silently bypassing allowance enforcement.
 * Actual costs can exceed an envelope and leave a negative balance.
 */
export function requestReservation(
  provider: string,
  model: string,
  operation: string,
  args: Record<string, unknown>,
) {
  const number = (key: string, fallback = 0) => {
    const value = Number(args[key] ?? fallback);
    if (!Number.isFinite(value) || value < 0)
      throw new Error("Invalid request budget.");
    return value;
  };
  let usd: number | undefined;
  if (provider === "openai") {
    if (model === "gpt-6-luna" && operation === "responses")
      usd =
        0.005 +
        (Buffer.byteLength(JSON.stringify(args), "utf8") * 0.25) / 1_000_000 +
        (number("max_output_tokens", 128000) * 0.75) / 1_000_000;
    if (
      model === "gpt-image-2.5-flare" &&
      ["image.generate", "image.edit"].includes(operation)
    )
      usd = operation === "image.edit" ? 0.2 : 0.15;
  }
  if (provider === "meta" && operation === "responses") {
    // Standard-rate input and output USD per million tokens.
    const rates: Record<string, [number, number]> = {
      "muse-wonder-1.0": [4, 20],
      "muse-spark-1.3": [1.25, 4.25],
      "muse-spark-1.2": [1.25, 4.25],
      "muse-spark-1.1": [1.25, 4.25],
      "muse-spark-1.3-contributor": [0.1, 0.2],
      "muse-spark-1.2-contributor": [0.1, 0.2],
    };
    const rate = rates[model];
    if (rate)
      usd =
        0.005 +
        (Buffer.byteLength(JSON.stringify(args), "utf8") * rate[0]) /
          1_000_000 +
        (number("max_output_tokens", 128000) * rate[1]) / 1_000_000;
  }
  if (provider === "elevenlabs") {
    if (
      ["eleven_v3", "eleven_multilingual_v2"].includes(model) &&
      operation === "speech"
    )
      usd = Math.max(
        0.01,
        typeof args.text === "string" ? [...args.text].length * 0.00008 : 0,
      );
    if (
      ["eleven_text_to_sound_v2", "eleven_text_to_sound_v3"].includes(model) &&
      operation === "sound_effect"
    )
      usd = Math.max(0.1, number("duration_seconds", 30) * 0.01);
    if (
      ["music_v1", "music_v2", "music_v2_5"].includes(model) &&
      operation === "music"
    )
      usd = Math.max(0.1, (number("music_length_ms") / 60000) * 0.5);
    if (model === "scribe_v2" && operation === "transcription") usd = 1;
  }
  if (usd === undefined || !Number.isFinite(usd) || usd <= 0)
    throw new Error("No configured credit reservation for this model.");
  return {
    version: "2026-10-27",
    usd: usd.toFixed(12),
    basis: "temporary-spending-envelope",
  };
}
