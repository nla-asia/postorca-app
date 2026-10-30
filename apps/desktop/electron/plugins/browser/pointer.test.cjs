const assert = require("node:assert/strict");
const { test } = require("node:test");
const { glide, pointerGlide, screenPoint } = require("./pointer.cjs");

const view = {
  screenX: 10,
  screenY: 20,
  outerWidth: 800,
  outerHeight: 700,
  innerWidth: 800,
  innerHeight: 600,
};
const page = { evaluate: async () => view };

test("a page point maps to the screen below the browser's bars", () => {
  assert.deepEqual(screenPoint(view, 5, 6), { x: 15, y: 126 });
});

test("the pointer glides in steps and ends on the target", async () => {
  const moves = [];
  const robot = {
    getMousePos: () => ({ x: 0, y: 0 }),
    moveMouse: (x, y) => moves.push([x, y]),
  };
  await glide(robot, { x: 100, y: 50 }, { glideMs: 64, settleMs: 0 });
  assert.equal(moves.length, 4);
  assert.deepEqual(moves.at(-1), [100, 50]);
  assert.ok(moves[0][0] < 100);
});

test("the founder's mouse is left alone unless a recording is running", async () => {
  let loaded = 0;
  const move = pointerGlide({
    isRecording: () => false,
    loadRobot: () => loaded++,
  });
  await move(page, 1, 1);
  assert.equal(loaded, 0);
});

test("a pointer failure never costs the click", async () => {
  const move = pointerGlide({
    isRecording: () => true,
    loadRobot: () => {
      throw new Error("no accessibility");
    },
  });
  await move(page, 1, 1);
});
