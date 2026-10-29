import assert from "node:assert/strict";
import { test } from "node:test";
import { requestReservation } from "../src/billing/reservations.js";

test("response envelopes price images separately from encoded transport for both providers", () => {
  for (const [provider, model] of [
    ["openai", "gpt-6-luna"],
    ["meta", "muse-spark-1.3"],
    ["meta", "muse-wonder-1.0"],
  ]) {
    const args = (url: string, count = 1) => ({
      model,
      input: [
        {
          role: "user",
          content: Array.from({ length: count }, () => ({
            type: "input_image",
            image_url: url,
            detail: "auto",
          })),
        },
      ],
    });
    const budget = (body: Record<string, unknown>) =>
      Number(requestReservation(provider, model, "responses", body).usd);
    const small = args("data:image/png;base64,AA==");
    const large = args(`data:image/png;base64,${"A".repeat(4_000_000)}`);
    const original = JSON.stringify(large);
    assert.equal(budget(small), budget(large));
    assert.equal(budget(small), budget(args("https://example.test/image.png")));
    assert.ok(budget(args("data:image/png;base64,AA==", 2)) > budget(small));
    assert.ok(budget(small) > budget({ model, input: [] }));
    assert.ok(
      budget({
        model,
        input: [{ role: "user", content: "A".repeat(4_000_000) }],
      }) > budget(large),
    );
    assert.equal(
      JSON.stringify(large),
      original,
      "reservation must not alter the provider request",
    );
  }
});
