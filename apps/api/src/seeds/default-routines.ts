/**
 * Routines PostOrca ships with. Founder-wide defaults cover all social accounts;
 * the project routine finds content ideas in the founder's actual work. Each is
 * keyed by its core skill so seeding does not recreate deleted defaults or rewrite
 * routines the founder has edited.
 */
import type { WorkType } from "../repositories/routines.js";

export type LinkKind = "x" | "threads" | "instagram" | "facebook" | "linkedin";

export const PLATFORM_BY_KIND: Record<LinkKind, string> = {
  x: "X",
  threads: "Threads",
  instagram: "Instagram",
  facebook: "Facebook",
  linkedin: "LinkedIn",
};

export type DefaultRoutine = {
  kinds: LinkKind[];
  title: string;
  /** Local HH:MM in the founder's time zone. */
  time: string;
  /** ISO weekdays, 1 = Monday … 7 = Sunday. */
  days: number[];
  /** How the task's deliverable is labeled and handled in the app. */
  workType: WorkType;
  /** The core skill it follows; also its key on the link. */
  skill: string;
  instructions: string;
};

// Social growth routines are no longer added by default. Keep existing routines
// and their skills available; founder-wide and project routines remain below.
export const DEFAULT_ROUTINES: DefaultRoutine[] = [];

/** A routine that covers all of the founder's social accounts in one run. */
export type FounderRoutine = Omit<DefaultRoutine, "kinds">;

/**
 * Created once per founder, as soon as they have a social account, with no account
 * or platform of its own; keyed by skill on brand_profiles.seeded_routines.
 */
export const FOUNDER_ROUTINES: FounderRoutine[] = [
  // Early, so the day's other routines read fresh posts from PostOrca.
  {
    title: "Read my posts",
    time: "07:00",
    days: [1, 2, 3, 4, 5, 6, 7],
    workType: "general",
    skill: "sync-my-posts",
    instructions:
      "Read the sync-my-posts skill with read_skill, then follow it for every social account in the brand profile, in this one task.",
  },
  // Before the day's drafts, so they follow what yesterday's edits taught.
  {
    title: "Voice review",
    time: "06:30",
    days: [1, 2, 3, 4, 5, 6, 7],
    workType: "general",
    skill: "review-voice-feedback",
    instructions:
      "Read the review-voice-feedback skill with read_skill, then follow it for the founder's content tasks of the last 24 hours.",
  },
];

/**
 * Added once, when the founder adds their first project folder (brand_projects):
 * content ideas from what they worked on, for their X account if they have one,
 * otherwise their first other social account. Weekday evenings, after the work.
 */
export const WORK_IDEAS_ROUTINE = {
  kinds: ["x", "linkedin", "threads", "instagram", "facebook"] as LinkKind[],
  title: "Ideas from my work",
  time: "18:00",
  days: [1, 2, 3, 4, 5],
  workType: "ideas" as WorkType,
  skill: "work-content-ideas",
  instructions:
    "Read the work-content-ideas skill with read_skill, then follow it for {{account}} ({{url}}).",
};
