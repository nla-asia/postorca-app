/**
 * Headful Chromium can stall captureScreenshot for a background tab. Select only
 * the owned tab while capturing, without focusing its window, then restore the
 * prior selection unless the founder selected another tab in the meantime.
 */
export function createScreenshotCapture(api) {
  let queue = Promise.resolve();
  async function capture(tabId, target, params) {
    const tab = await api.tabs.get(tabId);
    const [previous] = await api.tabs.query({ windowId: tab.windowId, active: true });
    const changed = !tab.active;
    try {
      if (changed) await api.tabs.update(tabId, { active: true });
      return await api.debugger.sendCommand(target, "Page.captureScreenshot", params);
    } finally {
      if (changed && previous && previous.id !== tabId) {
        try {
          const [current] = await api.tabs.query({ windowId: tab.windowId, active: true });
          if (current?.id === tabId) await api.tabs.update(previous.id, { active: true });
        } catch {
          // A closed tab/window must not replace the capture's result or error.
        }
      }
    }
  }
  return (tabId, target, params) => {
    const result = queue.then(() => capture(tabId, target, params));
    queue = result.catch(() => {});
    return result;
  };
}
