import assert from "node:assert/strict";
import { test } from "node:test";
import {
  loadRates,
  matchRate,
  estimateCost,
} from "../src/api-usage/pricing.js";

const base = {
  provider: "elevenlabs",
  startedAt: new Date("2026-10-28T00:00:00Z"),
  settings: {},
};
test("speech and music prices use their own billing units, not subscription credits or prompt length", async () => {
  const rates = await loadRates();
  for (const model of ["eleven_multilingual_v2", "eleven_v3"]) {
    const rate = matchRate(rates, { ...base, model, operation: "speech" })!;
    assert.ok(rate);
    assert.equal(
      estimateCost(rate, { billed_characters: 1000 }),
      "0.080000000000",
    );
    assert.equal(estimateCost(rate, { accepted_characters: 1000 }), null);
  }
  for (const model of ["music_v1", "music_v2", "music_v2_5"]) {
    const rate = matchRate(rates, { ...base, model, operation: "music" })!;
    assert.ok(rate);
    assert.equal(
      estimateCost(rate, {
        accepted_audio_seconds: 30,
        billed_characters: 999999,
      }),
      "0.075000000000",
    );
    assert.equal(estimateCost(rate, { requested_audio_seconds: 30 }), null);
  }
});
test("Scribe's hourly price requires billed audio duration and does not infer it from words", async () => {
  const rates = await loadRates();
  const rate = matchRate(rates, {
    ...base,
    model: "scribe_v2",
    operation: "transcription",
  })!;
  assert.ok(rate);
  assert.equal(
    estimateCost(rate, { billed_audio_seconds: 3600 }),
    "0.220000000000",
  );
  assert.equal(estimateCost(rate, {}), null);
  assert.equal(
    matchRate(rates, {
      ...base,
      model: "scribe_v2_realtime",
      operation: "transcription",
    }),
    undefined,
  );
  assert.equal(
    matchRate(rates, {
      ...base,
      model: "scribe_v2",
      operation: "transcription",
      startedAt: new Date("2026-10-26T00:00:00Z"),
    }),
    undefined,
  );
});
