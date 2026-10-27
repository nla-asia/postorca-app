import type { Queryable } from "../db.js";
import type {
  PluginDefinition,
  PluginToolDefinition,
} from "../plugins/types.js";
import type { SkillDefinition } from "../skills/load.js";

export type PluginRow = { code: string; name: string; description: string };
export type PluginToolRow = {
  name: string;
  runs_on: "server" | "desktop";
  description: string;
  schema: Record<string, unknown>;
  timeout_ms: number | null;
};
export type SkillRow = { name: string; description: string };

export async function enabledPlugins(db: Queryable): Promise<PluginRow[]> {
  return (
    await db.query(
      "SELECT code,name,description FROM plugins WHERE enabled ORDER BY code",
    )
  ).rows;
}

export async function activePluginCode(
  db: Queryable,
  taskId: string,
): Promise<string | null> {
  const {
    rows: [task],
  } = await db.query("SELECT active_plugin FROM tasks WHERE id=$1", [taskId]);
  return task?.active_plugin ?? null;
}

export async function setActivePlugin(
  db: Queryable,
  taskId: string,
  code: string | null,
) {
  await db.query("UPDATE tasks SET active_plugin=$2 WHERE id=$1", [
    taskId,
    code,
  ]);
}

/** A plugin's enabled tools, in definition order. */
export async function pluginTools(
  db: Queryable,
  code: string,
): Promise<PluginToolRow[]> {
  return (
    await db.query(
      `SELECT t.name,t.runs_on,t.description,t.schema,t.timeout_ms FROM plugin_tools p
       JOIN tools t ON t.name=p.tool_name WHERE p.plugin_code=$1 AND t.enabled ORDER BY p.position`,
      [code],
    )
  ).rows;
}

/** A plugin's enabled skills (without content), in definition order. */
export async function pluginSkills(
  db: Queryable,
  code: string,
): Promise<SkillRow[]> {
  return (
    await db.query(
      `SELECT s.name,s.description FROM plugin_skills p
       JOIN skills s ON s.name=p.skill_name WHERE p.plugin_code=$1 AND s.enabled ORDER BY p.position`,
      [code],
    )
  ).rows;
}

/** Enabled skills that belong to no plugin, readable in any task. */
export async function coreSkills(db: Queryable): Promise<SkillRow[]> {
  return (
    await db.query(
      `SELECT s.name,s.description FROM skills s WHERE s.enabled
       AND NOT EXISTS (SELECT 1 FROM plugin_skills p WHERE p.skill_name=s.name)
       ORDER BY s.name`,
    )
  ).rows;
}

export async function getSkill(
  db: Queryable,
  name: string,
): Promise<{ name: string; dir: string } | undefined> {
  return (await db.query("SELECT name,dir FROM skills WHERE name=$1", [name]))
    .rows[0];
}

/**
 * Projects the code-defined catalog into the tools, skills, plugins, plugin_tools,
 * and plugin_skills tables. Retired definitions stay as rows (tasks may reference
 * them) but are disabled.
 */
export async function writeCatalog(
  db: Queryable,
  catalog: {
    tools: PluginToolDefinition[];
    skills: SkillDefinition[];
    plugins: PluginDefinition[];
  },
) {
  for (const tool of catalog.tools)
    await db.query(
      `INSERT INTO tools(name,runs_on,description,schema,timeout_ms,enabled) VALUES ($1,$2,$3,$4,$5,true)
       ON CONFLICT (name) DO UPDATE SET runs_on=$2,description=$3,schema=$4,timeout_ms=$5,enabled=true`,
      [
        tool.name,
        tool.runsOn,
        tool.description,
        JSON.stringify(tool.parameters),
        tool.runsOn === "desktop" ? tool.timeoutMs : null,
      ],
    );
  for (const skill of catalog.skills)
    await db.query(
      `INSERT INTO skills(name,description,dir,enabled) VALUES ($1,$2,$3,true)
       ON CONFLICT (name) DO UPDATE SET description=$2,dir=$3,enabled=true`,
      [skill.name, skill.description, skill.dir],
    );
  for (const plugin of catalog.plugins) {
    await db.query(
      `INSERT INTO plugins(code,name,description,enabled) VALUES ($1,$2,$3,true)
       ON CONFLICT (code) DO UPDATE SET name=$2,description=$3,enabled=true`,
      [plugin.code, plugin.name, plugin.description],
    );
    await db.query("DELETE FROM plugin_tools WHERE plugin_code=$1", [
      plugin.code,
    ]);
    await db.query("DELETE FROM plugin_skills WHERE plugin_code=$1", [
      plugin.code,
    ]);
    for (const [position, tool] of plugin.tools.entries())
      await db.query(
        "INSERT INTO plugin_tools(plugin_code,tool_name,position) VALUES ($1,$2,$3)",
        [plugin.code, tool.name, position],
      );
    for (const [position, skill] of plugin.skills.entries())
      await db.query(
        "INSERT INTO plugin_skills(plugin_code,skill_name,position) VALUES ($1,$2,$3)",
        [plugin.code, skill.name, position],
      );
  }
  await db.query("UPDATE tools SET enabled=false WHERE NOT (name = ANY($1))", [
    catalog.tools.map((tool) => tool.name),
  ]);
  await db.query("UPDATE skills SET enabled=false WHERE NOT (name = ANY($1))", [
    catalog.skills.map((skill) => skill.name),
  ]);
  await db.query(
    "UPDATE plugins SET enabled=false WHERE NOT (code = ANY($1))",
    [catalog.plugins.map((plugin) => plugin.code)],
  );
}
