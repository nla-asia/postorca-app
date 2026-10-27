const assert = require("node:assert/strict");
const { test } = require("node:test");
const { normalizeKey, pressKey } = require("./keyboard.cjs");

for (const platform of ["darwin", "win32"]) {
  test(`${platform}: named keys and aliases reach keyboard.press in Playwright form`, async () => {
    const received = [];
    const page = { keyboard: { press: async key => received.push(key) } };
    for (const key of ["HOME", "end", "PAGEDOWN", "pgup", "ESC", "RETURN", "CTRL+HOME", "shift+arrowleft", "cmd+A", "option+ARROWRIGHT", "f12"])
      await pressKey(page, key, platform);
    assert.deepEqual(received, ["Home", "End", "PageDown", "PageUp", "Escape", "Enter", "Control+Home", "Shift+ArrowLeft", "Meta+A", "Alt+ArrowRight", "F12"]);
  });
  test(`${platform}: portable shortcuts choose the OS modifier without rewriting explicit modifiers`, () => {
    const modifier = platform === "darwin" ? "Meta" : "Control";
    assert.equal(normalizeKey("CONTROLORMETA+A", platform), `${modifier}+A`);
    assert.equal(normalizeKey("mod+SHIFT+z", platform), `${modifier}+Shift+z`);
    assert.equal(normalizeKey("Control+A", platform), "Control+A");
    assert.equal(normalizeKey("Meta+A", platform), "Meta+A");
    for (const key of ["a", "A", "Shift+a", "+", "Control++", "Digit1", "NumpadAdd", "UnknownKey"])
      assert.equal(normalizeKey(key, platform), key);
  });
}

test("keyboard failures propagate to the browser tool", async () => {
  const error = new Error("tab closed");
  await assert.rejects(pressKey({ keyboard: { press: async () => { throw error; } } }, "HOME"), error);
});

for (const channel of process.platform === "win32" ? ["chrome", "msedge"] : ["chrome"]) {
  test(`${channel}: normalized keys dispatch in a real browser and portable select-all edits the field`, async () => {
    const { getChromium } = await import("playwriter/dist/playwright-import.js");
    const browser = await (await getChromium()).launch({ headless: true, channel });
    try {
      const page = await browser.newPage();
      await page.setContent('<input value="original text"><script>window.keys=[];document.addEventListener("keydown",e=>window.keys.push({key:e.key,ctrl:e.ctrlKey,meta:e.metaKey}));</script>');
      await page.locator("input").focus();
      await pressKey(page, "HOME");
      await pressKey(page, "ESC");
      assert.deepEqual((await page.evaluate(() => window.keys)).map(event => event.key), ["Home", "Escape"]);
      // Exercise both OS mappings against the actual Playwright parser/CDP path.
      // Event dispatch can be checked here for macOS; native macOS editing still
      // needs a run on a Mac, rather than inferring it from Windows behavior.
      for (const platform of ["darwin", "win32"]) {
        await page.evaluate(() => { window.keys = []; });
        await pressKey(page, "CONTROLORMETA+a", platform);
        const event = (await page.evaluate(() => window.keys)).at(-1);
        assert.equal(event.key, "a");
        assert.equal(event.ctrl, platform === "win32");
        assert.equal(event.meta, platform === "darwin");
      }
      await pressKey(page, "ControlOrMeta+A");
      await page.keyboard.insertText("replacement");
      assert.equal(await page.locator("input").inputValue(), "replacement");
    } finally {
      await browser.close();
    }
  });
}
