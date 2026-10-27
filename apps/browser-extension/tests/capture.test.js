import assert from "node:assert/strict";
import { test } from "node:test";
import { createScreenshotCapture } from "../capture.js";

async function fixture(command) {
  let active = 10;
  const selected = [];
  const api = {
    tabs: {
      get: async (id) => ({ id, windowId: 1, active: id === active }),
      query: async () => [{ id: active, windowId: 1, active: true }],
      update: async (id, value) => {
        assert.deepEqual(value, { active: true });
        active = id; selected.push(id);
      },
    },
    debugger: { sendCommand: async (target, method, params) => {
      assert.equal(active, target.tabId);
      assert.equal(method, "Page.captureScreenshot");
      return command?.({ target, params, select: (id) => { active = id; } }) ?? { data: "jpeg" };
    } },
  };
  return { capture: createScreenshotCapture(api), selected, active: () => active };
}

test("captures an owned background tab and restores selection without focusing a window", async () => {
  const f = await fixture();
  assert.deepEqual(await f.capture(20, { tabId: 20 }, { format: "jpeg" }), { data: "jpeg" });
  assert.deepEqual(f.selected, [20, 10]);
  assert.equal(f.active(), 10);
});
test("restores selection after a capture failure", async () => {
  const f = await fixture(() => { throw new Error("capture failed"); });
  await assert.rejects(f.capture(20, { tabId: 20 }, {}), /capture failed/);
  assert.equal(f.active(), 10);
});
test("does not override a tab selection made during capture", async () => {
  const f = await fixture(({ select }) => { select(30); return { data: "jpeg" }; });
  await f.capture(20, { tabId: 20 }, {});
  assert.equal(f.active(), 30);
  assert.deepEqual(f.selected, [20]);
});
test("serializes captures so each restores the original tab", async () => {
  const f = await fixture(async () => { await new Promise(r => setTimeout(r, 10)); return { data: "jpeg" }; });
  await Promise.all([f.capture(20, { tabId: 20 }, {}), f.capture(21, { tabId: 21 }, {})]);
  assert.deepEqual(f.selected, [20, 10, 21, 10]);
});
