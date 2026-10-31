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
