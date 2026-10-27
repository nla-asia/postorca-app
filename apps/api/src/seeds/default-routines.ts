/**
 * Routines PostOrca ships with. When onboarding is completed, each social link whose
 * kind is listed in `kinds` gets its own copy, scheduled in the founder's time zone
 * on that link's platform. Founders edit, pause, or delete them like any routine.
 *
 * Instructions name the core skill (src/skills) that holds the process, with
 * {{account}} (the link's name) and {{url}}; the brand profile itself is already in
 * Orca's context for every run.
 */
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
  instructions: string;
};

export const DEFAULT_ROUTINES: DefaultRoutine[] = [
  {
    kinds: ["x", "threads", "instagram", "facebook", "linkedin"],
    title: "Content ideas",
    time: "09:00",
    days: [1, 2, 3, 4, 5],
    instructions:
      "Read the find-content-ideas skill with read_skill, then follow it for {{account}} ({{url}}).",
  },
  {
    kinds: ["x", "threads", "linkedin"],
    title: "Conversations to join",
    time: "13:00",
    days: [1, 2, 3, 4, 5],
    instructions:
      "Read the conversations-to-join skill with read_skill, then follow it for {{account}} ({{url}}).",
  },
  {
    kinds: ["x", "threads", "instagram", "facebook", "linkedin"],
    title: "Weekly strategy research",
    time: "10:00",
    days: [1],
    instructions:
      "Read the weekly-strategy-research skill with read_skill, then follow it for {{account}} ({{url}}).",
  },
];
