import { z } from "zod";
import type { Queryable } from "../db.js";
import { callDesktop } from "../desktop/calls.js";
import { desktopConnections } from "../desktop/connections.js";
import { HttpError } from "../handlers/errors.js";
import type { ToolDefinition } from "../providers/types.js";
import {
  activePluginCode,
  coreSkills,
  enabledPlugins,
  getSkill,
  pluginSkills,
  pluginTools,
  setActivePlugin,
  type PluginRow,
  type PluginToolRow,
  type SkillRow,
} from "../repositories/plugins.js";
import { readSkillFile } from "../skills/load.js";
import { pluginToolImplementation } from "./catalog.js";
import type { PluginContext } from "./types.js";

/**
 * Runtime side of plugins (catalog.ts defines them). A task has at most one active
 * plugin, tasks.active_plugin. Orca sees the enabled plugins' codes and descriptions;
 * activate_plugin sets the task's active plugin (replacing any previous one), and
 * from the next model response its tools are offered and its skills can be read with
 * read_skill. Tools and skills outside the active plugin are rejected. Core skills
 * (src/skills) belong to no plugin and are readable in every task.
 */
export type PluginState = {
  available: PluginRow[];
  active: PluginRow | null;
  tools: PluginToolRow[];
  skills: SkillRow[];
  coreSkills: SkillRow[];
};

/** The task's plugin state, read fresh from the database for each model response. */
export async function loadPluginState(
  db: Queryable,
  taskId: string,
): Promise<PluginState> {
  const [available, activeCode, core] = await Promise.all([
    enabledPlugins(db),
    activePluginCode(db, taskId),
    coreSkills(db),
  ]);
  const active = available.find((plugin) => plugin.code === activeCode) ?? null;
  if (!active)
    return { available, active: null, tools: [], skills: [], coreSkills: core };
  const [tools, skills] = await Promise.all([
    pluginTools(db, active.code),
    pluginSkills(db, active.code),
  ]);
  return { available, active, tools, skills, coreSkills: core };
}

/** System-prompt section listing core skills and the active and available plugins. */
export function pluginPrompt(state: PluginState) {
  const core = state.coreSkills.length
    ? `\nSkills: when a task names a skill, or its work matches one, read it with read_skill first and follow it.
${state.coreSkills.map((skill) => `- ${skill.name}: ${skill.description}`).join("\n")}`
    : "";
  if (!state.available.length) return core;
  const active = state.active
    ? `${state.active.name} (${state.active.code})`
    : "none";
  return `\nPlugins: activate the plugin whose domain matches the work with activate_plugin before doing that work. Activation replaces the active plugin; its tools are available from your next step and its skills explain how to use them (read them with read_skill first). activate_plugin with null returns to default tools.
Active plugin: ${active}
Available:
${state.available.map((plugin) => `- ${plugin.code}: ${plugin.description}`).join("\n")}${
    state.skills.length
      ? `\nSkills of the active plugin:\n${state.skills.map((skill) => `- ${skill.name}: ${skill.description}`).join("\n")}`
      : ""
  }${core}`;
}

/** Plugin tools offered to the model: activation, skill reading, and the active plugin's tools. */
export function pluginToolDefinitions(state: PluginState): ToolDefinition[] {
  const skills = [...state.coreSkills, ...state.skills];
  const readSkill: ToolDefinition[] = skills.length
    ? [
        {
          name: "read_skill",
          description:
            "Read a skill: instructions for doing a kind of work. Core skills are always readable; plugin skills need their plugin active. Returns its SKILL.md and lists any other files in the skill, which you can read with file.",
          parameters: {
            type: "object",
            additionalProperties: false,
            required: ["name"],
            properties: {
              name: {
                type: "string",
                enum: skills.map((skill) => skill.name),
              },
              file: {
                type: "string",
                description:
                  "A file listed by the skill, e.g. references/examples.md. Omit for SKILL.md.",
              },
            },
          },
        },
      ]
    : [];
  if (!state.available.length) return readSkill;
  return [
    {
      name: "activate_plugin",
      description:
        "Activate the plugin whose domain matches the work before doing it. Replaces the active plugin; its tools are available from your next step. Pass null to return to default tools.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["code"],
        properties: {
          code: {
            type: ["string", "null"],
            enum: [...state.available.map((plugin) => plugin.code), null],
          },
        },
      },
    },
    ...readSkill,
    ...state.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.schema,
    })),
  ];
}

export const isPluginRuntimeTool = (name: string) =>
  name === "activate_plugin" ||
  name === "read_skill" ||
  !!pluginToolImplementation(name);

const computerTurns = new Map<string, string>();
async function activateComputer(context: PluginContext) {
  const deviceId =
    computerTurns.get(context.turnId) ??
    desktopConnections.online(context.userId).at(-1);
  if (!deviceId) throw new HttpError(503, "The desktop app is not connected.");
  computerTurns.set(context.turnId, deviceId);
  await callDesktop(
    context,
    "desktop_computer_session",
    { timeoutMs: 20_000, deviceId },
    { active: true },
  );
}
/** Best-effort release; the desktop also expires leases and clears them on disconnect. */
export async function releaseComputer(context: PluginContext) {
  const deviceId = computerTurns.get(context.turnId);
  if (!deviceId) return;
  computerTurns.delete(context.turnId);
  await callDesktop(
    { ...context, signal: undefined },
    "desktop_computer_session",
    { timeoutMs: 5_000, deviceId },
    { active: false },
  ).catch(() => {});
}

export async function executePluginTool(
  context: PluginContext,
  state: PluginState,
  name: string,
  rawArgs: unknown,
) {
  if (name === "activate_plugin") {
    const { code } = z
      .object({ code: z.string().nullable() })
      .strict()
      .parse(rawArgs);
    const plugin =
      code === null
        ? null
        : state.available.find((candidate) => candidate.code === code);
    if (plugin === undefined)
      throw new HttpError(400, `Plugin ${code} is not available.`);
    if (plugin?.code === "computer") await activateComputer(context);
    else await releaseComputer(context);
    await setActivePlugin(context.db, context.taskId, plugin?.code ?? null);
    if (!plugin)
      return {
        active_plugin: null,
        message: "Plugin deactivated. Default tools remain available.",
      };
    const skills = await pluginSkills(context.db, plugin.code);
    return {
      active_plugin: plugin.code,
      message: `Activated ${plugin.name}. Its tools are available from your next step.${
        skills.length
          ? " Read the skills that fit the work with read_skill before using them."
          : ""
      }`,
      skills,
    };
  }
  if (name === "read_skill") {
    const { name: skill, file } = z
      .object({ name: z.string(), file: z.string().min(1).optional() })
      .strict()
      .parse(rawArgs);
    if (
      ![...state.coreSkills, ...state.skills].some(
        (candidate) => candidate.name === skill,
      )
    )
      throw new HttpError(
        400,
        `Skill ${skill} is not a core skill or part of the active plugin.`,
      );
    const row = await getSkill(context.db, skill);
    if (!row?.dir) throw new HttpError(404, `Skill ${skill} is not available.`);
    return readSkillFile(row, file);
  }
  const tool = state.tools.find((candidate) => candidate.name === name);
  if (!tool)
    throw new HttpError(
      400,
      `${name} belongs to a plugin that is not active. Activate it with activate_plugin first.`,
    );
  const implementation = pluginToolImplementation(name)!;
  const args = implementation.args.parse(rawArgs);
  if (state.active?.code === "computer") {
    if ((await activePluginCode(context.db, context.taskId)) !== "computer")
      throw new HttpError(400, "The computer plugin is no longer active.");
    await activateComputer(context);
  }
  if (implementation.runsOn === "server")
    return implementation.run(context, args);
  return callDesktop(
    context,
    name,
    {
      timeoutMs: tool.timeout_ms ?? implementation.timeoutMs,
      deviceId:
        state.active?.code === "computer"
          ? computerTurns.get(context.turnId)
          : undefined,
    },
    args,
  );
}
