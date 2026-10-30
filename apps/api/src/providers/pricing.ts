/** Central provider prices.
 * All amounts are decimal USD strings; these are standard-rate estimates, not invoices.
 * Edit here for future requests. Existing requests retain their own price snapshots.
 * For price changes, close the old effectiveTo and add a new dated card.
 * Disable unverified cards; never represent an unknown price as zero.
 */
const source = "https://developers.openai.com/api/docs/pricing";
const perMillion = (meter: string, amount: string) => ({
  meter,
  amount,
  perUnits: 1_000_000,
});
export const PROVIDER_PRICING = [
  {
    enabled: true,
    id: "meta-muse-voice-transcribe-1.0-2026-10-30",
    source: "https://dev.meta.ai/docs/pricing-rate-limits",
    provider: "meta",
    model: "muse-voice-transcribe-1.0",
    operation: "transcription",
    currency: "USD",
    effectiveFrom: "2026-10-30T00:00:00Z",
    // Meta rounds processed audio down to whole seconds.
    prices: [{ meter: "billed_audio_seconds", amount: "0.18", perUnits: 3600 }],
  },
  ...[false, true].map((long) => ({
    enabled: true,
    id: `openai-luna-${long ? "long" : "short"}-2026-10-27`,
    source,
    provider: "openai",
    model: "gpt-6-luna",
    operation: "responses",
    currency: "USD",
    effectiveFrom: "2026-10-27T00:00:00Z",
    settings: { actual_service_tier: "default", cache_retention: "in-memory" },
    meterRanges: {
      input_tokens: long ? { min: 272_001 } : { min: 0, max: 272_000 },
    },
    prices: [
      perMillion("ordinary_input_tokens", long ? "0.20" : "0.10"),
      perMillion("cached_input_tokens", long ? "0.02" : "0.01"),
      perMillion("cache_write_tokens", long ? "0.25" : "0.125"),
      perMillion("output_tokens", long ? "0.75" : "0.50"),
    ],
  })),
  // Meta reports cached input but no cache writes; there is no long-context tier.
  ...(
    [
      ["muse-wonder-1.0", "4.00", "0.20", "20.00"],
      ["muse-spark-1.3", "1.25", "0.15", "4.25"],
    ] as const
  ).map(([model, input, cached, output]) => ({
    enabled: true,
    id: `meta-${model}-2026-10-28`,
    source: "https://dev.meta.ai/docs/pricing-rate-limits",
    provider: "meta",
    model,
    operation: "responses",
    currency: "USD",
    effectiveFrom: "2026-10-28T00:00:00Z",
    settings: { cache_retention: "in-memory" },
    prices: [
      perMillion("uncached_input_tokens", input),
      perMillion("cached_input_tokens", cached),
      perMillion("output_tokens", output),
    ],
  })),
  ...["image.generate", "image.edit"].map((operation) => ({
    enabled: true,
    id: `meta-muse-image-1.0-${operation}-2026-10-28`,
    source: "https://dev.meta.ai/docs/pricing-rate-limits",
    provider: "meta",
    model: "muse-image-1.0",
    operation,
    currency: "USD",
    effectiveFrom: "2026-10-28T00:00:00Z",
    // Failed or safety-filtered images are not billed.
    prices: [{ meter: "generated_images", amount: "0.01", perUnits: 1 }],
  })),
  ...["image.generate", "image.edit"].map((operation) => ({
    enabled: true,
    id: `openai-flare-${operation}-2026-10-27`,
    source,
    provider: "openai",
    model: "gpt-image-2.5-flare",
    operation,
    currency: "USD",
    effectiveFrom: "2026-10-27T00:00:00Z",
    // Direct Images API has no cached-input discount for this model.
    prices: [
      perMillion("input_text_tokens", "5"),
      perMillion("input_image_tokens", "8"),
      perMillion("output_tokens", "30"),
    ],
  })),
  ...["eleven_text_to_sound_v2", "eleven_text_to_sound_v3"].map((model) => ({
    enabled: true,
    id: `elevenlabs-${model}-2026-10-27`,
    source: "https://elevenlabs.io/pricing/api",
    provider: "elevenlabs",
    model,
    operation: "sound_effect",
    currency: "USD",
    effectiveFrom: "2026-10-27T00:00:00Z",
    prices: [{ meter: "accepted_audio_seconds", amount: "0.12", perUnits: 60 }],
  })),
  ...["eleven_multilingual_v2", "eleven_v3"].map((model) => ({
    enabled: true,
    id: `elevenlabs-${model}-speech-standard-2026-10-27`,
    source: "https://elevenlabs.io/pricing/api",
    provider: "elevenlabs",
    model,
    operation: "speech",
    currency: "USD",
    effectiveFrom: "2026-10-27T00:00:00Z",
    // Prefer provider character-cost; accepted Unicode character count is a tagged
    // standard-rate estimate when absent. Reconcile custom-voice/account variations.
    prices: [{ meter: "billed_characters", amount: "0.08", perUnits: 1000 }],
  })),
  ...["music_v1", "music_v2", "music_v2_5"].map((model) => ({
    enabled: true,
    id: `elevenlabs-${model}-music-standard-2026-10-27`,
    source: "https://elevenlabs.io/pricing/api",
    provider: "elevenlabs",
    model,
    operation: "music",
    currency: "USD",
    effectiveFrom: "2026-10-27T00:00:00Z",
    // Accepted explicit duration, not prompt characters or subscription credits.
    prices: [{ meter: "accepted_audio_seconds", amount: "0.15", perUnits: 60 }],
  })),
  {
    enabled: true,
    id: "elevenlabs-scribe-v2-transcription-standard-2026-10-27",
    source: "https://elevenlabs.io/pricing/api",
    provider: "elevenlabs",
    model: "scribe_v2",
    operation: "transcription",
    currency: "USD",
    effectiveFrom: "2026-10-27T00:00:00Z",
    // Requires known billed audio duration; word timestamps omit silence.
    // Current requests do not enable paid editing/keyterm/multichannel add-ons.
    prices: [{ meter: "billed_audio_seconds", amount: "0.22", perUnits: 3600 }],
  },
] as const;
