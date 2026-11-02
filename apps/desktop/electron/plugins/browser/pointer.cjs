/**
 * On camera, a click sent straight to the page changes it with nothing moving, which
 * looks like a reload. While a screen recording runs, the real mouse pointer glides to
 * the target first, at a person's pace. Off camera the founder's mouse is left alone.
 */

const GLIDE_MS = 500;
const SETTLE_MS = 150;
const STEP_MS = 16;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Screen position of a point in the page; the browser's own bars sit above the page. */
function screenPoint(view, x, y) {
  return {
    x: Math.round(view.screenX + (view.outerWidth - view.innerWidth) / 2 + x),
    y: Math.round(view.screenY + view.outerHeight - view.innerHeight + y),
  };
}

async function glide(robot, to, { glideMs = GLIDE_MS, settleMs = SETTLE_MS } = {}) {
  const from = robot.getMousePos();
  const steps = Math.max(1, Math.round(glideMs / STEP_MS));
  for (let step = 1; step <= steps; step++) {
    const t = step / steps;
    const eased = t * t * (3 - 2 * t);
    robot.moveMouse(
      Math.round(from.x + (to.x - from.x) * eased),
      Math.round(from.y + (to.y - from.y) * eased),
    );
    await pause(STEP_MS);
  }
  await pause(settleMs);
}

/** A failure here must never cost the click: the clip just shows no pointer movement. */
function pointerGlide({ isRecording, loadRobot, options }) {
  return async (page, x, y) => {
    if (!isRecording()) return;
    try {
      const view = await page.evaluate(() => ({
        screenX: window.screenX,
        screenY: window.screenY,
        outerWidth: window.outerWidth,
        outerHeight: window.outerHeight,
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
      }));
      await glide(loadRobot(), screenPoint(view, x, y), options);
    } catch {}
  };
}

/** Text appears key by key on camera; off camera it goes in at once. */
async function typeText(page, text, { isRecording, delay = 55 }) {
  if (isRecording()) await page.keyboard.type(text, { delay });
  else await page.keyboard.insertText(text);
}

module.exports = { glide, pointerGlide, screenPoint, typeText };
