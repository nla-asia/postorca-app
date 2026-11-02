// How the billing panel tells that a payment made in Stripe has arrived.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

let vite, billing;
before(async () => {
  vite = await createServer({
    configFile: false,
    root: fileURLToPath(new URL("../../", import.meta.url)),
    logLevel: "silent",
    appType: "custom",
    server: { middlewareMode: true, hmr: false },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  billing = await vite.ssrLoadModule("/src/lib/billing.ts");
});
after(async () => {
  await vite?.close();
});

const packages = {
  builder: { name: "Builder", credits: 500 },
  influencer: { name: "Influencer", credits: 1500 },
  extra: { name: "Extra credits", credits: 200 },
};
const state = (status, plan, entries = []) => ({
  status,
  plan,
  packages,
  credits: { entries },
});
const welcome = { id: "w", amount: 250 };

test("a new subscription lands once it is paid for on the chosen plan", () => {
  const before = billing.baselineOf(state("none", null, [welcome]));
  assert.equal(
    billing.paymentLanded("builder", before, state("none", null, [welcome])),
    null,
  );
  // Stripe can report the subscription before the first invoice is paid.
  assert.equal(
    billing.paymentLanded("builder", before, state("incomplete", "builder")),
    null,
  );
  assert.equal(
    billing.paymentLanded("builder", before, state("active", "builder")),
    "Payment received. You're on the Builder plan.",
  );
});

test("resubscribing after a cancellation lands on the same plan", () => {
  const before = billing.baselineOf(state("canceled", "builder"));
  assert.equal(
    billing.paymentLanded("builder", before, state("canceled", "builder")),
    null,
  );
  assert.ok(billing.paymentLanded("builder", before, state("active", "builder")));
});

test("extra credits land with a new grant, not with older ones or usage", () => {
  const before = billing.baselineOf(state("active", "builder", [welcome]));
  assert.equal(
    billing.paymentLanded(
      "extra",
      before,
      state("active", "builder", [{ id: "u", amount: -3 }, welcome]),
    ),
    null,
  );
  assert.equal(
    billing.paymentLanded(
      "extra",
      before,
      state("active", "builder", [{ id: "x", amount: 200 }, welcome]),
    ),
    "Payment received. 200 credits were added to your balance.",
  );
});

test("the customer portal reports any change to the subscription", () => {
  const before = billing.baselineOf(state("active", "builder"));
  assert.equal(
    billing.paymentLanded("portal", before, state("active", "builder")),
    null,
  );
  assert.equal(
    billing.paymentLanded("portal", before, state("canceled", "builder")),
    "Your subscription changes are saved.",
  );
});
