// Playwright key names are case-sensitive, but model-generated named keys need
// not be. Preserve printable characters: "a" and "A" are different key presses.
const namedKeys = [
  "Home", "End", "PageUp", "PageDown", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
  "Enter", "Escape", "Tab", "Space", "Backspace", "Delete", "Insert", "Clear",
  "Shift", "Control", "Alt", "Meta", "CapsLock", "NumLock", "ScrollLock",
  "Pause", "PrintScreen", "ContextMenu",
  ...Array.from({ length: 24 }, (_, i) => `F${i + 1}`),
];
const aliases = new Map(namedKeys.map(key => [key.toLowerCase(), key]));
for (const [alias, key] of Object.entries({
  esc: "Escape", return: "Enter", spacebar: "Space", del: "Delete", ins: "Insert",
  pgup: "PageUp", pgdn: "PageDown", up: "ArrowUp", down: "ArrowDown",
  left: "ArrowLeft", right: "ArrowRight", ctrl: "Control", cmd: "Meta",
  command: "Meta", option: "Alt", win: "Meta", windows: "Meta",
})) aliases.set(alias, key);

function normalizeKey(key, platform = process.platform) {
  // Splitting and joining preserves literal + (including Control++).
  return key.split("+").map(part => {
    if (part.length <= 1) return part;
    const lower = part.toLowerCase();
    if (lower === "controlormeta" || lower === "mod")
      return platform === "darwin" ? "Meta" : "Control";
    return aliases.get(lower) ?? part;
  }).join("+");
}

async function pressKey(page, key, platform = process.platform) {
  await page.keyboard.press(normalizeKey(key, platform));
}

module.exports = { normalizeKey, pressKey };
