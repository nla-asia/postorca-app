import { transaction, type Database } from "../db.js";
import { HttpError } from "../handlers/errors.js";
import type { ProjectInput } from "../schemas/brand.js";
import { seedWorkIdeasRoutine } from "./routines.js";

const MAX_PROJECTS = 20;
const columns = "id, name, path, description";

/** The founder's project folders, oldest first. */
export async function listProjects(db: Database, userId: string) {
  const { rows } = await db.query<{
    id: string;
    name: string;
    path: string;
    description: string;
  }>(
    `SELECT ${columns} FROM brand_projects WHERE user_id=$1 ORDER BY created_at, id`,
    [userId],
  );
  return rows;
}

/**
 * Adds a project folder. The first one also adds the "Ideas from my work" routine
 * (returned as createdRoutine) when the founder doesn't have it yet.
 */
export async function addProject(
  db: Database,
  userId: string,
  data: ProjectInput,
) {
  return transaction(db, async (client) => {
    await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [userId]);
    const {
      rows: [{ count }],
    } = await client.query(
      "SELECT count(*)::int AS count FROM brand_projects WHERE user_id=$1",
      [userId],
    );
    if (count >= MAX_PROJECTS)
      throw new HttpError(400, `You can add up to ${MAX_PROJECTS} projects.`);
    const {
      rows: [project],
    } = await client.query(
      `INSERT INTO brand_projects(user_id, name, path, description) VALUES ($1,$2,$3,$4)
       ON CONFLICT (user_id, path) DO NOTHING RETURNING ${columns}`,
      [userId, data.name, data.path, data.description],
    );
    if (!project) throw new HttpError(409, "This folder is already a project.");
    return {
      project,
      createdRoutine: await seedWorkIdeasRoutine(client, userId),
    };
  });
}

/** Renames a project or changes its description; the folder stays the same. */
export async function updateProject(
  db: Database,
  userId: string,
  id: string,
  data: Pick<ProjectInput, "name" | "description">,
) {
  const {
    rows: [project],
  } = await db.query(
    `UPDATE brand_projects SET name=$3, description=$4 WHERE id=$1 AND user_id=$2 RETURNING ${columns}`,
    [id, userId, data.name, data.description],
  );
  if (!project) throw new HttpError(404, "Project not found.");
  return project;
}

export async function deleteProject(db: Database, userId: string, id: string) {
  const { rowCount } = await db.query(
    "DELETE FROM brand_projects WHERE id=$1 AND user_id=$2",
    [id, userId],
  );
  if (!rowCount) throw new HttpError(404, "Project not found.");
}
