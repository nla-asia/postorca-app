/**
 * Routines PostOrca ships with. When onboarding is completed, each social link whose
 * kind is listed in `kinds` gets its own copy, scheduled in the founder's time zone
 * on that link's platform. Founders edit, pause, or delete them like any routine.
 *
 * Each is keyed by its core skill (src/skills), recorded on the link when created, so
 * a default added here later also reaches links seeded before it. Instructions name
 * that skill, which holds the process, with
 * {{account}} (the link's name) and {{url}}; the brand profile itself is already in
 * Orca's context for every run.
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

export const DEFAULT_ROUTINES: DefaultRoutine[] = [
  {
    kinds: ["x", "threads", "instagram", "facebook", "linkedin"],
    title: "Content ideas",
    time: "09:00",
    days: [1, 2, 3, 4, 5],
    workType: "ideas",
    skill: "find-content-ideas",
    instructions:
      "Read the find-content-ideas skill with read_skill, then follow it for {{account}} ({{url}}).",
  },
  {
    kinds: ["x", "threads", "linkedin"],
    title: "Conversations to join",
    time: "13:00",
    days: [1, 2, 3, 4, 5],
    workType: "conversations",
    skill: "conversations-to-join",
    instructions:
      "Read the conversations-to-join skill with read_skill, then follow it for {{account}} ({{url}}).",
  },
  {
    kinds: ["x", "threads", "instagram", "facebook", "linkedin"],
    title: "Weekly strategy research",
    time: "10:00",
    days: [1],
    workType: "strategy",
    skill: "weekly-strategy-research",
    instructions:
      "Read the weekly-strategy-research skill with read_skill, then follow it for {{account}} ({{url}}).",
  },
  // Growth for small accounts: people asking to connect, and a weekly post inviting
  // them. Bigger accounts are told once that they can pause these.
  {
    kinds: ["x", "threads", "linkedin"],
    title: "People to connect",
    time: "11:00",
    days: [1, 2, 3, 4, 5],
    workType: "conversations",
    skill: "people-to-connect",
    instructions:
      "Read the people-to-connect skill with read_skill, then follow it for {{account}} ({{url}}).",
  },
  {
    kinds: ["x", "threads", "linkedin"],
    title: "Connect post",
    time: "10:00",
    days: [3],
    workType: "content",
    skill: "connect-post",
    instructions:
      "Read the connect-post skill with read_skill, then follow it for {{account}} ({{url}}).",
  },
  // A fallback that keeps the account active: it skips days the founder already posted.
  {
    kinds: ["x", "threads", "instagram", "facebook", "linkedin"],
    title: "Daily quote",
    time: "18:00",
    days: [1, 2, 3, 4, 5, 6, 7],
    workType: "content",
    skill: "daily-quote",
    instructions:
      "Read the daily-quote skill with read_skill, then follow it for {{account}} ({{url}}).",
  },
];

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
