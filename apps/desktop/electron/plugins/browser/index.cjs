const { founderBrowser } = require("./founder-browser.cjs");

// Desktop side of the browser plugin: tools run in the founder's own browser
// (founder-browser.cjs). Schemas, argument validation, and the skill live on the
// server.

module.exports = {
  name: "browser",
  // Listen for the browser extension early so it is connected before the first call.
  start: () => founderBrowser.start(),
  shutdown: () => founderBrowser.shutdown(),
  status: () => founderBrowser.status(),
  tools: {
    browser_open: {
      run: ({ url, new_window }) => founderBrowser.open(url, new_window === true),
    },
    browser_snapshot: {
      run: ({ tab, interactive_only, full, part }) =>
        founderBrowser.snapshot(
          tab,
          interactive_only ?? false,
          full ?? false,
          part,
        ),
    },
    browser_screenshot: {
      run: async ({ tab, labels }, context) => {
        const { image, ...shot } = await founderBrowser.screenshot(
          tab,
          labels ?? true,
        );
        const file = await context.upload(image, "image/jpeg");
        return {
          ...shot,
          attachments: [{ kind: "screenshot", file, mime_type: "image/jpeg" }],
        };
      },
    },
    browser_click: { run: ({ tab, ref }) => founderBrowser.click(tab, ref) },
    browser_type: {
      run: ({ tab, ref, text, submit, replace }) =>
        founderBrowser.type(tab, ref, text, submit ?? false, replace === true),
    },
    browser_press: { run: ({ tab, key }) => founderBrowser.press(tab, key) },
    browser_fetch_file: { run: ({ tab, ...args }, context) => founderBrowser.fetchFile(tab, args, context) },
    browser_scroll: {
      run: ({ tab, direction }) => founderBrowser.scroll(tab, direction),
    },
    browser_close: { run: ({ tab }) => founderBrowser.close(tab) },
  },
};
