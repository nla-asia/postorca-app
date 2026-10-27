import type { Queryable } from "../db.js";
import { writeCatalog } from "../repositories/plugins.js";
import { coreSkills } from "../skills/index.js";
import { browserPlugin } from "./browser/index.js";
import { gmailPlugin, drivePlugin } from "./google/index.js";
import type { PluginDefinition, PluginToolDefinition } from "./types.js";

export { gmailPlugin, drivePlugin } from "./google/index.js";

/**
 * Plugins defined in code. Code is the source of truth: syncCatalog projects these
 * (and the core skills) into the tools, skills, plugins, plugin_tools and
 * plugin_skills tables on every migrate, and disables rows that are no longer
 * defined. At runtime Orca reads the catalog from the database (service.ts); code
 * supplies argument validation and execution.
 *
 * To add a plugin: create src/plugins/<code>/ with its tools and skill folders
 * (skills/<name>/SKILL.md, see skills/load.ts), export a PluginDefinition, list it
 * here, and implement its desktop tools under the same names in the desktop app's
 * electron/plugins/<code>/.
 */
export const pluginDefinitions: PluginDefinition[] = [browserPlugin];

/** Every plugin tool by name; throws when two plugins define different tools or skills under one name. */
function indexCatalog() {
  const tools = new Map<string, PluginToolDefinition>();
  const skills = new Set(coreSkills.map((skill) => skill.name));
  for (const plugin of pluginDefinitions) {
    for (const tool of plugin.tools) {
      // A plugin may reuse another plugin's tool, but two different tools can't
      // share a name.
      const existing = tools.get(tool.name);
      if (existing && existing !== tool)
        throw new Error(`Tool ${tool.name} is defined by more than one plugin.`);
      tools.set(tool.name, tool);
    }
    for (const skill of plugin.skills) {
      if (skills.has(skill.name))
        throw new Error(`Skill ${skill.name} is defined by more than one plugin.`);
      skills.add(skill.name);
    }
  }
  return tools;
}

/** Code implementation (validation and execution) of a plugin tool. */
export const pluginToolImplementation = (name: string) =>
  indexCatalog().get(name);

/** Writes the code-defined catalog into the database. Runs inside migrate's transaction. */
export async function syncCatalog(db: Queryable) {
  await writeCatalog(db, {
    tools: [...indexCatalog().values()],
    skills: [
      ...coreSkills,
      ...pluginDefinitions.flatMap((plugin) => plugin.skills),
    ],
    plugins: pluginDefinitions,
  });
}

// jsonb doesn't keep key order, so schemas are compared with keys sorted.
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item).sort(([a], [b]) => a.localeCompare(b)),
        )
      : item,
  );

/**
 * How the database catalog differs from the code: tools whose schema or description
 * changed, tools added or removed, and plugins whose tool or skill lists changed.
 * Migrations are run by hand (npm run db:migrate), so the server checks at startup:
 * the model sees the database's schemas, not the code's.
 */
export async function catalogDrift(db: Queryable) {
  const drift: string[] = [];
  const { rows: tools } = await db.query(
    "SELECT name,description,schema FROM tools WHERE enabled",
  );
  const stored = new Map(tools.map((row) => [row.name as string, row]));
  for (const tool of indexCatalog().values()) {
    const row = stored.get(tool.name);
    if (!row) drift.push(`tool ${tool.name} is missing`);
    else if (
      row.description !== tool.description ||
      canonical(row.schema) !== canonical(tool.parameters)
    )
      drift.push(`tool ${tool.name} has changed`);
    stored.delete(tool.name);
  }
  for (const name of stored.keys()) drift.push(`tool ${name} was removed`);
  const { rows: skills } = await db.query(
    "SELECT name FROM skills WHERE enabled ORDER BY name",
  );
  const expected = [
    ...coreSkills,
    ...pluginDefinitions.flatMap((plugin) => plugin.skills),
  ]
    .map((skill) => skill.name)
    .sort();
  if (skills.map((row) => row.name).join(",") !== expected.join(","))
    drift.push("skills have changed");
  const lists = async (table: string, column: string) =>
    (
      await db.query(
        `SELECT plugin_code, array_agg(${column} ORDER BY position) AS names FROM ${table} GROUP BY plugin_code`,
      )
    ).rows.reduce(
      (all, row) => ({ ...all, [row.plugin_code]: row.names.join(",") }),
      {} as Record<string, string>,
    );
  const pluginToolLists = await lists("plugin_tools", "tool_name");
  const pluginSkillLists = await lists("plugin_skills", "skill_name");
  for (const plugin of pluginDefinitions) {
    if (
      (pluginToolLists[plugin.code] ?? "") !==
      plugin.tools.map((tool) => tool.name).join(",")
    )
      drift.push(`plugin ${plugin.code}'s tools have changed`);
    if (
      (pluginSkillLists[plugin.code] ?? "") !==
      plugin.skills.map((skill) => skill.name).join(",")
    )
      drift.push(`plugin ${plugin.code}'s skills have changed`);
  }
  return drift;
}
