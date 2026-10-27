import type { PluginDefinition } from "../types.js";
import { browserTools } from "./tools.js";
import { loadSkill } from "../../skills/load.js";

export const browserPlugin: PluginDefinition = {
  code: "browser",
  name: "Browser",
  description:
    "Use the founder's own web browser, where they are already signed in to their social accounts: read feeds, profiles, and search results, and find conversations worth joining.",
  skills: [loadSkill(new URL("./skills/browser-use/", import.meta.url))],
  tools: browserTools,
};
