export interface UsageData {
  meters: Record<string, number>;
  providerUsage?: unknown;
}

/** Keep all numeric provider usage and expose explicitly named, non-estimated meters. */
export function openAIUsage(value: unknown): UsageData {
  const usage = value as Record<string, unknown> | undefined;
  const meters: Record<string, number> = {};
  const copy = (name: string, v: unknown) => {
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) meters[name] = v;
  };
  for (const name of ["input_tokens", "output_tokens", "total_tokens"])
    copy(name, usage?.[name]);
  const input = (usage?.input_tokens_details ?? usage?.input_token_details) as
    | Record<string, unknown>
    | undefined;
  const output = usage?.output_tokens_details as
    | Record<string, unknown>
    | undefined;
  copy("billed_audio_seconds", usage?.seconds);
  copy("cached_input_tokens", input?.cached_tokens);
  copy("cache_write_tokens", input?.cache_write_tokens);
  copy("input_text_tokens", input?.text_tokens);
  copy("input_image_tokens", input?.image_tokens);
  copy("input_audio_tokens", input?.audio_tokens);
  copy("output_text_tokens", output?.text_tokens);
  copy("output_image_tokens", output?.image_tokens);
  copy("output_audio_tokens", output?.audio_tokens);
  copy("reasoning_tokens", output?.reasoning_tokens);
  if (
    meters.input_tokens !== undefined &&
    meters.cached_input_tokens !== undefined &&
    meters.cached_input_tokens <= meters.input_tokens
  )
    meters.uncached_input_tokens =
      meters.input_tokens - meters.cached_input_tokens;
  if (
    meters.uncached_input_tokens !== undefined &&
    meters.cache_write_tokens !== undefined &&
    meters.cache_write_tokens <= meters.uncached_input_tokens
  )
    meters.ordinary_input_tokens =
      meters.uncached_input_tokens - meters.cache_write_tokens;
  // A reported zero total cache is sufficient to know both cached modality counts.
  if (meters.cached_input_tokens === 0) {
    for (const modality of ["text", "image"]) {
      const total = meters[`input_${modality}_tokens`];
      if (total !== undefined) {
        meters[`cached_input_${modality}_tokens`] = 0;
        meters[`ordinary_input_${modality}_tokens`] = total;
      }
    }
  }
  return { meters, providerUsage: usage };
}
