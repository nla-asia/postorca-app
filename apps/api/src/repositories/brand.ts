import { transaction, type Database, type Queryable } from "../db.js";
import { HttpError } from "../handlers/errors.js";
import type { BrandLinkInput, ProfileInput } from "../schemas/brand.js";

/** Link kinds that are social accounts; onboarding needs at least one. */
const SOCIAL_KINDS = ["x", "threads", "instagram", "facebook", "linkedin"];
export async function getProfile(db: Database, userId: string) {
  const {
    rows: [profile],
  } = await db.query(
    `SELECT u.name,p.company,p.audience,p.voice,p.topics,p.colors,p.onboarding_status,
      (SELECT coalesce(jsonb_agg(jsonb_build_object('id',l.id,'name',l.name,'url',l.url,
        'kind',l.kind,'publishing_method',l.publishing_method,
        'publishing_instructions',l.publishing_instructions,'access_status',l.access_status) ORDER BY l.name,l.id),'[]'::jsonb)
       FROM brand_profile_links l WHERE l.user_id=u.id) AS links
     FROM users u JOIN brand_profiles p ON p.user_id=u.id WHERE u.id=$1`,
    [userId],
  );
  return profile;
}
export async function saveProfile(
  db: Database,
  userId: string,
  data: ProfileInput,
  options: { saveLinks?: boolean } = {},
) {
  await transaction(db, async (client) => {
    await client.query(
      "SELECT user_id FROM brand_profiles WHERE user_id=$1 FOR UPDATE",
      [userId],
    );
    const saveLinks = options.saveLinks !== false;
    const hasSocialLink = saveLinks
      ? data.links.some((link) => SOCIAL_KINDS.includes(link.kind ?? "other"))
      : !!(
          await client.query(
            "SELECT 1 FROM brand_profile_links WHERE user_id=$1 AND kind=ANY($2) LIMIT 1",
            [userId, SOCIAL_KINDS],
          )
        ).rowCount;
    if (
      data.onboarding_status === "completed" &&
      (!data.company.trim() || !data.topics.trim() || !hasSocialLink)
    )
      throw new HttpError(
        400,
        "Save what you’re building, primary topics, and at least one social account link, such as Instagram, LinkedIn, or X, before completing onboarding.",
      );
    if (saveLinks) {
      const ids = data.links.flatMap((link) => (link.id ? [link.id] : []));
      if (new Set(ids).size !== ids.length)
        throw new HttpError(400, "Each link must have a different ID.");
      const owned = await client.query(
        "SELECT id FROM brand_profile_links WHERE user_id=$1 AND id=ANY($2::uuid[])",
        [userId, ids],
      );
      if (owned.rowCount !== ids.length)
        throw new HttpError(404, "Profile link not found.");
    }
    await client.query("UPDATE users SET name=$2 WHERE id=$1", [
      userId,
      data.name,
    ]);
    await client.query(
      "UPDATE brand_profiles SET company=$2,audience=$3,voice=$4,topics=$5,onboarding_status=$6,colors=$7 WHERE user_id=$1",
      [
        userId,
        data.company,
        data.audience,
        data.voice,
        data.topics,
        data.onboarding_status,
        data.colors,
      ],
    );
    if (saveLinks) {
      const ids = data.links.flatMap((link) => (link.id ? [link.id] : []));
      const { rows: removed } = await client.query(
        "SELECT id FROM brand_profile_links WHERE user_id=$1 AND NOT (id=ANY($2::uuid[]))",
        [userId, ids],
      );
      const removedIds = removed.map((link) => link.id);
      await client.query(
        "DELETE FROM brand_profile_links WHERE id=ANY($1::uuid[])",
        [removedIds],
      );
      for (const link of data.links) await saveLinkRow(client, userId, link);
    }
  });
  return { profile: await getProfile(db, userId), createdRoutines: [] };
}
/** The founder's saved brand colours ({} when none are set). */
export async function brandColors(
  db: Queryable,
  userId: string,
): Promise<Record<string, string>> {
  const {
    rows: [row],
  } = await db.query("SELECT colors FROM brand_profiles WHERE user_id=$1", [
    userId,
  ]);
  return row?.colors ?? {};
}
// Both the dialog's full save and the agent's single-link tool use this writer.
async function saveLinkRow(
  db: Queryable,
  userId: string,
  data: BrandLinkInput,
) {
  const columns =
    "id,name,url,kind,publishing_method,publishing_instructions,access_status";
  if (data.id) {
    const {
      rows: [link],
    } = await db.query(
      `UPDATE brand_profile_links SET name=$3,url=$4,
        kind=COALESCE($5,kind),publishing_method=COALESCE($6,publishing_method),
        publishing_instructions=COALESCE($7,publishing_instructions),
        access_status=CASE WHEN url<>$4 THEN 'not_granted' ELSE COALESCE($8,access_status) END
       WHERE user_id=$1 AND id=$2 RETURNING ${columns}`,
      [
        userId,
        data.id,
        data.name,
        data.url,
        data.kind,
        data.publishing_method,
        data.publishing_instructions,
        data.access_status,
      ],
    );
    if (!link) throw new HttpError(404, "Profile link not found.");
    return link;
  }
  return (
    await db.query(
      `INSERT INTO brand_profile_links(user_id,name,url,kind,publishing_method,publishing_instructions,access_status)
     VALUES ($1,$2,$3,COALESCE($4,'other'),COALESCE($5,''),COALESCE($6,''),COALESCE($7,'not_granted')) RETURNING ${columns}`,
      [
        userId,
        data.name,
        data.url,
        data.kind,
        data.publishing_method,
        data.publishing_instructions,
        data.access_status,
      ],
    )
  ).rows[0];
}
