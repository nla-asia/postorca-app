/**
 * Ideas (level 3): the idea routines, run as real routines ("Run now") with no one
 * in the chat. Instructions match the default routines; [account] and [account url]
 * are filled from the observer config.
 */
import type { EvalCheck } from "./computer-eval-types.js";

export type IdeasCase = {
  id: string;
  name: string;
  skill: string;
  /** Idea artifacts the skill allows; strategy delivers one document instead. */
  ideas?: [number, number];
  document?: RegExp;
  /** Reads the founder's project folders (needs the work fixture). */
  work?: boolean;
  criteria: string[];
};

const grounded =
  "Nothing is invented: every reference, number, quote and detail traces to something the agent actually opened or read in this run.";
export const ideasCases: IdeasCase[] = [
  {
    id: "content-ideas",
    name: "Daily content ideas routine",
    skill: "find-content-ideas",
    ideas: [1, 5],
    criteria: [
      "Each idea builds on a real, recent post that is clearly working, linked so the founder can open it, and broken down into why it works.",
      "Each idea is turned into a post this founder could make: their angle, their audience, their voice; the ideas differ from each other and from the founder's recent posts.",
      grounded,
    ],
  },
  {
    id: "work-ideas",
    name: "Ideas from your work routine",
    skill: "work-content-ideas",
    ideas: [1, 3],
    work: true,
    criteria: [
      "The ideas come from the fixture's recent work: the timezone streak fix and the weekly recap card, not older history or unrelated files.",
      "The visible recap card is pitched as a product demo first, from the viewer's problem, with steps to capture that match the code.",
      "No code is quoted and nothing beyond the commits, changes and notes is claimed. " +
        grounded,
    ],
  },
  {
    id: "weekly-strategy",
    name: "Weekly strategy research routine",
    skill: "weekly-strategy-research",
    document: /^Strategy\b/,
    criteria: [
      "The report says what is working in the founder's niche this week, backed by specific posts it links, with concrete suggestions the founder can act on.",
      grounded,
    ],
  },
];

export const routineInstructions = (skill: string) =>
  `Read the ${skill} skill with read_skill, then follow it for [account] ([account url]).`;

export function gradeIdeas(
  entry: IdeasCase,
  evidence: { status: string; calls: any[]; artifacts: any[] },
): EvalCheck[] {
  const ok = evidence.calls.filter((c) => !c.failed);
  const ideas = evidence.artifacts.filter((a) => a.kind === "idea");
  const checks: EvalCheck[] = [
    { name: "Run completed", passed: evidence.status === "completed" },
    {
      name: `Followed the ${entry.skill} skill`,
      passed: ok.some(
        (c) => c.name === "read_skill" && c.args?.name === entry.skill,
      ),
    },
  ];
  if (entry.ideas) {
    const [min, max] = entry.ideas;
    checks.push({
      name: `${min}–${max} idea artifacts`,
      passed: ideas.length >= min && ideas.length <= max,
      details: ideas.length,
    });
  }
  if (entry.document)
    checks.push({
      name: "Strategy report delivered as one document",
      passed:
        evidence.artifacts.filter(
          (a) => a.kind === "document" && entry.document!.test(a.title ?? ""),
        ).length === 1,
    });
  if (entry.work)
    checks.push({
      name: "Read the recent work in the project's git history",
      passed: ok.some((c) => c.name === "git_activity"),
    });
  return checks;
}
