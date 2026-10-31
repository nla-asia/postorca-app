import { z } from "zod";
import type { PluginToolDefinition } from "../types.js";

/**
 * Browser tools run on the desktop, in the founder's own browser with their real
 * sign-ins, in tabs Orca opened (the desktop's electron/plugins/browser). On macOS
 * the desktop opens the browser in the background when it is closed.
 */
const object = (properties: Record<string, unknown>, required: string[]) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const tab = {
  type: "string",
  description: "Tab ID returned by browser_open, e.g. t1.",
};
const ref = {
  type: "string",
  description:
    "Element ref from this tab's latest browser_snapshot or labeled browser_screenshot, e.g. e12.",
};
const tabId = z.string().regex(/^t\d{1,6}$/);
const refId = z.string().regex(/^e\d{1,6}$/);

function tool(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[],
  args: z.ZodType,
  timeoutMs = 45_000,
): PluginToolDefinition {
  return {
    name,
    description,
    parameters: object(properties, required),
    args,
    runsOn: "desktop",
    timeoutMs,
  };
}

export const browserTools: PluginToolDefinition[] = [
  tool(
    "browser_fetch_file",
    "Fetch a file URL using the founder's signed-in browser session and stream its bytes to Electron without starting a browser download or showing a Save dialog. Supply an owned tab and exactly one of a current file-link/image ref or an HTTP(S) URL discovered while browsing. Uses applicable browser-managed cookies and credentials; does not automatically reproduce Authorization headers or tokens added by a website's JavaScript. filename is an optional suggested name. Saves the original into Downloads/PostOrca and returns its local path, task attachment, filename, byte count, detected file type, checksum and source URL. Supports images, audio, video, documents and other files up to 200 MB. Redirects are handled by the browser; a final redirect URL is not reported. JavaScript-only buttons, POST-based downloads and streaming-video assembly are unsupported. Fetch only files relevant to the user's request. Does not execute files. Close the tab after completion.",
    { tab, ref, url: { type: "string" }, filename: { type: "string" } },
    ["tab"],
    z
      .object({
        tab: tabId,
        ref: refId.optional(),
        url: z.url({ protocol: /^https?$/ }).optional(),
        filename: z.string().min(1).max(120).optional(),
      })
      .strict()
      .refine(
        (value) => Boolean(value.ref) !== Boolean(value.url),
        "Supply exactly one of ref or url.",
      ),
    240_000,
  ),
  tool(
    "browser_open",
    "Open a web page in a new tab of the founder's own browser. Returns a tab ID for the other browser tools. The tab appears in the founder's browser: close it with browser_close as soon as you are done with it. new_window=true opens it in a window of its own (not focused), so it is that window's front tab: only for recording the page with the screen capture tools; otherwise leave it off.",
    {
      url: { type: "string", description: "HTTP(S) URL." },
      new_window: { type: "boolean" },
    },
    ["url"],
    z.object({ url: z.url({ protocol: /^https?$/ }), new_window: z.boolean().optional() }).strict(),
    75_000,
  ),
  tool(
    "browser_snapshot",
    "Read a tab as an accessibility tree. Actionable elements have refs (e.g. [ref=e12]); an element keeps its ref while it stays on the page, and only elements in the tab's latest snapshot or labeled screenshot can be used. Each result names its observation (e.g. t1:3). The first snapshot of a page returns the full tree (`snapshot`). Later snapshots of the same page with the same interactive_only return only `changes` since the `baseline` (the closest of your last few snapshots of this tab): + added, - removed (large removed sections are summarized), ~ changed or given a new ref, with unchanged lines for context; or they say there are no changes. When changes would be as long as the tree, the full tree is returned (`full_reason` says why). A result longer than 20,000 characters comes in parts: you get part 1, `parts`, and for a full tree an `outline` of the page's large sections and the parts they are in; read others with part=N. Loading a new page starts over with a full tree. full=true returns the complete tree: use it when you no longer have the baseline snapshot in view or cannot follow the changes. interactive_only=true lists just the controls.",
    {
      tab,
      interactive_only: { type: "boolean" },
      full: {
        type: "boolean",
        description:
          "Return the complete current tree instead of changes, and compare later snapshots with it.",
      },
      part: {
        type: "integer",
        minimum: 1,
        description:
          "Read a part (including part 1 again) of this tab's latest long result (it said `parts`). Same observation and refs; the page is not read again and the other options are ignored.",
      },
    },
    ["tab"],
    z
      .object({
        tab: tabId,
        interactive_only: z.boolean().optional(),
        full: z.boolean().optional(),
        part: z.number().int().min(1).max(50).optional(),
      })
      .strict(),
  ),
  tool(
    "browser_screenshot",
    "See the visible part of a tab as an image, for when layout, images, or how something looks matter. Read text with browser_snapshot instead. labels=true (the default) marks clickable elements with refs (e.g. e12), the same refs snapshots use, so you can click what you see; afterwards only the tab's interactive elements are usable until the next snapshot. It does not change the snapshot baseline. The image is visible to you for only a few steps: describe what you observe in text in your next response.",
    { tab, labels: { type: "boolean" } },
    ["tab"],
    z.object({ tab: tabId, labels: z.boolean().optional() }).strict(),
    60_000,
  ),
  tool(
    "browser_click",
    "Click an element by ref. Returns the page afterwards like browser_snapshot (in the mode of your last snapshot of this tab): usually only what changed, so you rarely need a separate snapshot.",
    { tab, ref },
    ["tab", "ref"],
    z.object({ tab: tabId, ref: refId }).strict(),
  ),
  tool(
    "browser_type",
    "Click a text field by ref and type text at the cursor. replace=true replaces what is already in the field (text the browser autofilled, or an earlier value) instead of adding to it: use it whenever the field may not be empty. submit=true presses Enter afterwards: use it for search boxes, never to send or publish. Date and time fields take their value as YYYY-MM-DD (date), HH:MM (time) or YYYY-MM-DDTHH:MM (date and time). Returns the page afterwards like browser_snapshot (in the mode of your last snapshot of this tab): usually only what changed, so you rarely need a separate snapshot.",
    {
      tab,
      ref,
      text: { type: "string" },
      replace: { type: "boolean" },
      submit: { type: "boolean" },
    },
    ["tab", "ref", "text"],
    z
      .object({
        tab: tabId,
        ref: refId,
        text: z.string().min(1).max(10_000),
        replace: z.boolean().optional(),
        submit: z.boolean().optional(),
      })
      .strict(),
  ),
  tool(
    "browser_select",
    "Choose an option in a dropdown (a <select>) by ref, by the option's visible text. Clicking an option in an open dropdown doesn't work, and typing its first letter can land on the wrong one: use this instead. Returns the option now chosen (selected) and the page afterwards like browser_snapshot (in the mode of your last snapshot of this tab): usually only what changed, so you rarely need a separate snapshot.",
    { tab, ref, option: { type: "string" } },
    ["tab", "ref", "option"],
    z
      .object({ tab: tabId, ref: refId, option: z.string().min(1).max(500) })
      .strict(),
  ),
  tool(
    "browser_press",
    "Press a key or shortcut in a tab, e.g. Escape, Enter, Home, PageDown, ControlOrMeta+A. Named keys accept any letter case and common aliases (HOME, Esc, Ctrl, Cmd). ControlOrMeta means Command on macOS and Control on Windows; explicit Control/Meta keep their meaning. Printable letter case is preserved. Returns the page afterwards like browser_snapshot (in the mode of your last snapshot of this tab): usually only what changed, so you rarely need a separate snapshot.",
    { tab, key: { type: "string" } },
    ["tab", "key"],
    z
      .object({ tab: tabId, key: z.string().regex(/^[A-Za-z0-9+]{1,40}$/) })
      .strict(),
  ),
  tool(
    "browser_scroll",
    "Scroll by most of a screen to see more of a page, feed or list. It scrolls what actually scrolls: the page, or in apps that keep the page fixed, the largest panel that scrolls. To scroll a particular panel, list or dialog, pass ref (an element inside it) or, when nothing inside has a ref, text visible inside it. Returns where it is (area page or panel, at_end) and the page afterwards like browser_snapshot (in the mode of your last snapshot of this tab): usually only what changed, so you rarely need a separate snapshot.",
    {
      tab,
      direction: { type: "string", enum: ["down", "up"] },
      ref,
      text: { type: "string" },
    },
    ["tab", "direction"],
    z
      .object({
        tab: tabId,
        direction: z.enum(["down", "up"]),
        ref: refId.optional(),
        text: z.string().min(1).max(200).optional(),
      })
      .strict(),
  ),
  tool(
    "browser_hover",
    "Move the pointer over an element, for what only shows on hover: tooltips, hover menus, row actions, chart values. Give its ref, or for things without one (a table row, a chart bar, a card) text visible in it. Returns the page afterwards like browser_snapshot (in the mode of your last snapshot of this tab): usually only what changed, so you rarely need a separate snapshot.",
    { tab, ref, text: { type: "string" } },
    ["tab"],
    z
      .object({
        tab: tabId,
        ref: refId.optional(),
        text: z.string().min(1).max(200).optional(),
      })
      .strict()
      .refine((args) => !args.ref !== !args.text, "Give a ref or text, not both."),
  ),
  tool(
    "browser_close",
    "Close a tab you opened. Close every tab you opened before you finish the task.",
    { tab },
    ["tab"],
    z.object({ tab: tabId }).strict(),
  ),
];
