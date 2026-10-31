const { test } = require("node:test");
const assert = require("node:assert/strict");
const { snapRegion } = require("./framing.cjs");

// A light picture with a dark window at x 20–180, y 30–110, in a 200 × 120 frame.
function picture() {
  const width = 200,
    height = 120,
    gray = Buffer.alloc(width * height, 240);
  for (let y = 30; y < 110; y++)
    for (let x = 20; x < 180; x++) gray[y * width + x] = 30;
  return { gray, width, height };
}

test("a focus a little off the window snaps onto its edges", () => {
  const { gray, width, height } = picture();
  const region = snapRegion(gray, width, height, {
    x: 26 / 200,
    y: 25 / 120,
    width: 150 / 200,
    height: 88 / 120,
  });
  assert.deepEqual(region, { x: 0.1, y: 0.25, width: 0.8, height: 0.6667 });
});

test("a focus with no edge nearby stays where it is", () => {
  const width = 200,
    height = 120,
    gray = Buffer.alloc(width * height, 200);
  const focus = { x: 0.1, y: 0.2, width: 0.5, height: 0.5 };
  assert.deepEqual(snapRegion(gray, width, height, focus), focus);
});

test("a close-up finds the named text and frames it with room, never as a sliver", () => {
  const { textBox, closeUp } = require("./framing.cjs");
  const lines = [
    { text: "Total", x: 0.53, y: 0.57, width: 0.04, height: 0.03 },
    { text: "$3,000.00", x: 0.66, y: 0.57, width: 0.08, height: 0.03 },
    { text: "Record payment", x: 0.83, y: 0.19, width: 0.09, height: 0.03 },
  ];
  assert.deepEqual(textBox(lines, ["total", "Missing thing"]), { missing: ["Missing thing"] });
  const { box } = textBox(lines, ["Total", "$3,000"]);
  assert.deepEqual(
    [box.x, box.y, box.width, box.height].map((v) => +v.toFixed(3)),
    [0.53, 0.57, 0.21, 0.03],
  );
  const region = closeUp(box, 1.6, 2.35);
  // Contains the total with room, at least a third wide, about the frame's shape.
  assert.ok(region.x < 0.53 && region.x + region.width > 0.74);
  assert.ok(region.y < 0.57 && region.y + region.height > 0.6);
  assert.ok(region.width >= 1 / 3 - 1e-9);
  // Never a sliver: a single row gets height around it, within the frame's shape.
  assert.ok(region.height >= 0.2 - 1e-9, String(region.height));
  const shape = (region.width * 1.6) / region.height;
  assert.ok(shape >= 2.35 * 0.75 - 1e-6 && shape <= 2.35 * 1.5 + 1e-6, String(shape));
  const narrow = closeUp({ x: 0.8, y: 0.2, width: 0.05, height: 0.3 }, 1.6, 2.35);
  assert.ok((narrow.width * 1.6) / narrow.height >= 2.35 * 0.75 - 1e-6);
  // Below the browser's bars.
  assert.ok(closeUp({ x: 0.2, y: 0.15, width: 0.1, height: 0.03 }, 1.6, 2.35, 0.14).y >= 0.14);
});

test("a close-up's edges never cut a word", () => {
  const { wholeWords } = require("./framing.cjs");
  const issued = { text: "Issued Oct 31, 2026", x: 0.64, y: 0.31, width: 0.09, height: 0.02 };
  const sent = { text: "Sent", x: 0.7, y: 0.28, width: 0.02, height: 0.015 };
  // Mostly inside: taken in whole.
  const taken = wholeWords({ x: 0.66, y: 0.15, width: 0.3, height: 0.25 }, [issued, sent]);
  assert.ok(taken.x <= 0.64 && taken.x + taken.width >= 0.95);
  // Barely inside: left out.
  const left = wholeWords({ x: 0.72, y: 0.15, width: 0.25, height: 0.25 }, [issued]);
  assert.ok(left.x >= 0.73);
  // A word that is fully inside, or fully outside, changes nothing.
  const box = { x: 0.6, y: 0.2, width: 0.3, height: 0.2 };
  assert.deepEqual(wholeWords(box, [sent]), box);
});

test("a close-up never zooms in past about twice the whole app", () => {
  const { closeUp, notTooTight } = require("./framing.cjs");
  const button = closeUp({ x: 0.83, y: 0.19, width: 0.09, height: 0.03 }, 1.6, 2.35, 0.14);
  assert.ok(button.width >= 0.55 - 1e-9 && button.height >= 0.35 - 1e-9);
  assert.ok(button.x <= 0.83 && button.x + button.width >= 0.92 && button.y >= 0.14);
  const drawn = notTooTight({ x: 0.4, y: 0.4, width: 0.2, height: 0.1 });
  assert.ok(drawn.width >= 0.55 - 1e-9 && drawn.height >= 0.35 - 1e-9);
  const wide = { x: 0, y: 0.1, width: 0.9, height: 0.8 };
  assert.deepEqual(notTooTight(wide), wide);
});
