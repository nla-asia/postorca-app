import type { z } from "zod";
import type { Database } from "../db.js";
import type { SkillDefinition } from "../skills/load.js";

export type PluginContext = {
  db: Database;
  userId: string;
  taskId: string;
  turnId: string;
  signal?: AbortSignal;
};

/**
 * A tool in a plugin. Its schema is what the model sees (stored in `tools`); `args`
 * validates calls before they run, either here on the server or on the founder's
 * desktop app over its WebSocket (implemented under the same name in the desktop's
 * electron/plugins).
 */
export type PluginToolDefinition = {
  name: string;
  description: string;
  /** JSON Schema of the arguments. */
  parameters: Record<string, unknown>;
  args: z.ZodType;
} & (
  | {
      runsOn: "server";
      run: (context: PluginContext, args: any) => Promise<unknown>;
    }
  | { runsOn: "desktop"; timeoutMs: number }
);

/**
 * A plugin bundles skills with the tools that work needs. Orca sees only its code and
 * description until it activates the plugin for a task.
 */
export type PluginDefinition = {
  /** Identifier Orca activates, e.g. "browser". */
  code: string;
  name: string;
  /** What it is for, so Orca can decide when to activate it. */
  description: string;
  skills: SkillDefinition[];
  tools: PluginToolDefinition[];
};
