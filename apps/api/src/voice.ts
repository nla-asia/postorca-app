import type { Database } from "./db.js";
import { readMemory, writeMemory } from "./memory.js";

/**
 * The founder's voice: one memory file, voice.md, whose layout is in
 * agent/prompts/voice.md. Its content goes into Orca's prompt on every turn, so
 * everything written in the founder's name follows it.
 */
export const VOICE_PATH = "voice.md";

/** voice.md's content, or "" before it exists. */
export async function readVoice(userId: string) {
  return readMemory(userId, VOICE_PATH).then(
    (file) => file.content,
    () => "",
  );
}

/**
 * Moves a voice typed into the brand profile's old voice field into voice.md, once,
 * so voice.md stays the only place the voice is kept.
 */
export async function moveProfileVoice(db: Database, userId: string) {
  const {
    rows: [profile],
  } = await db.query<{ voice: string }>(
    "SELECT voice FROM brand_profiles WHERE user_id=$1 AND voice<>''",
    [userId],
  );
  if (!profile) return;
  const note = `From the brand profile (${new Date().toISOString().slice(0, 10)}): ${profile.voice.trim()}`;
  const current = await readVoice(userId);
  await writeMemory(
    userId,
    VOICE_PATH,
    !current
      ? `---\ndescription: The founder's voice: picks, habits per variable, rules from their edits\n---\n# Voice\n\n## Picks\n${note}\n`
      : current.includes("## Picks\n")
        ? current.replace("## Picks\n", `## Picks\n${note}\n`)
        : `${current.trimEnd()}\n\n${note}\n`,
  );
  await db.query("UPDATE brand_profiles SET voice='' WHERE user_id=$1", [
    userId,
  ]);
}
