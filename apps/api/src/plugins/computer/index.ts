import { z } from "zod";
import type { PluginDefinition, PluginToolDefinition } from "../types.js";
import { loadSkill } from "../../skills/load.js";

const windowId = z.string().min(1).max(100);
const observation = z.string().regex(/^o[1-9]\d{0,8}_[0-9a-f]{6}$/);
const coordinate = z.number().int().min(0).max(100_000);
const windowArgs = { window: windowId };
function tool(
  name: string,
  description: string,
  args: z.ZodObject<any>,
): PluginToolDefinition {
  return {
    name,
    description,
    args,
    parameters: z.toJSONSchema(args),
    runsOn: "desktop",
    timeoutMs: 60_000,
  };
}
export const computerPlugin: PluginDefinition = {
  code: "computer",
  name: "Computer Use",
  description:
    "Open and operate desktop apps such as Claude and Codex, read visible conversations, and capture screenshots on Windows and macOS.",
  skills: [loadSkill(new URL("./skills/computer-use/", import.meta.url))],
  tools: [
    tool(
      "computer_list_apps",
      "List discoverable installed apps and running app windows. Use returned app IDs and window IDs; never invent them.",
      z.object({}).strict(),
    ),
    tool(
      "computer_open",
      "Open or activate an app using an app ID from computer_list_apps. Returns its windows. Observe one before interacting.",
      z.object({ app_id: z.string().min(1).max(2000) }).strict(),
    ),
    tool(
      "computer_observe",
      "Focus a returned window and capture its visible screen region. Returns an observation ID, screenshot pixel dimensions, and optional bounded accessibility text. Occluded/offscreen content is not captured. Coordinates for clicks and scrolls refer to this screenshot. Optional wait_ms (0–10000) waits before focusing and capturing, for slow boot, rendering, and native export previews.",
      z
        .object({
          ...windowArgs,
          accessibility: z.boolean().optional(),
          wait_ms: z.number().int().min(0).max(10000).optional(),
        })
        .strict(),
    ),
    tool(
      "computer_click",
      "Click screenshot coordinates and return a fresh screenshot. On macOS, alternatively pass menu_path from the latest accessibility observation to press an app menu item, e.g. [File, Record Screen]; returns fresh app/window discovery and requires another observation. Do not combine menu_path with coordinates/button/clicks. Rejects stale observations and unknown or disabled menus.",
      z
        .object({
          ...windowArgs,
          observation,
          x: coordinate.optional(),
          y: coordinate.optional(),
          menu_path: z
            .array(z.string().min(1).max(200))
            .min(2)
            .max(4)
            .optional(),
          button: z.enum(["left", "right"]).optional(),
          clicks: z.number().int().min(1).max(2).optional(),
        })
        .strict(),
    ),
    tool(
      "computer_type",
      "Insert literal text into the focused control of an observed window and return a fresh screenshot. Does not press Enter. Uses clipboard paste for Unicode text and preserves the previous clipboard if it remains unchanged. On macOS Simulator, short letters/digits/spaces/basic punctuation use hardware keys to avoid asynchronous pasteboard races.",
      z
        .object({
          ...windowArgs,
          observation,
          text: z.string().min(1).max(20_000),
        })
        .strict(),
    ),
    tool(
      "computer_press",
      "Press a key or shortcut in the observed window, then capture the result. Modifiers are control, command, alt, shift. Keys include enter, tab, escape, backspace, delete, home, end, pageup, pagedown and arrow keys.",
      z
        .object({
          ...windowArgs,
          observation,
          key: z.enum([
            "enter",
            "tab",
            "escape",
            "backspace",
            "delete",
            "home",
            "end",
            "pageup",
            "pagedown",
            "up",
            "down",
            "left",
            "right",
            ..."abcdefghijklmnopqrstuvwxyz0123456789",
          ] as [string, ...string[]]),
          modifiers: z
            .array(z.enum(["control", "command", "alt", "shift"]))
            .max(4)
            .optional(),
        })
        .strict(),
    ),
    tool(
      "computer_scroll",
      "Scroll at a point in the latest screenshot, then return a fresh screenshot. mode=bottom repeats downward scrolling at most max_steps (default 12, maximum 20), stopping after three unchanged captures. This is a bounded attempt, not proof that all content was loaded or read; inspect the result.",
      z
        .object({
          ...windowArgs,
          observation,
          x: coordinate,
          y: coordinate,
          direction: z.enum(["up", "down"]).optional(),
          mode: z.enum(["step", "bottom"]).optional(),
          max_steps: z.number().int().min(1).max(20).optional(),
        })
        .strict(),
    ),
  ],
};
