/**
 * Browser eval contracts for future runs. Historical briefs/results stay unchanged.
 * Only brief is sent to Orca; success_criteria is reviewer-only Markdown text.
 * This catalog includes agent scenarios and scripted transport checks; catalog
 * membership does not mean a case has an automated runner or grader.
 */
export type BrowserEvalCase = {
  revision?: number;
  revision_change?: {
    from: number;
    reason: string;
    preserved_coverage: string[];
  };
  id: string;
  name: string;
  brief: string;
  success_criteria: string;
};

export const browserCases: BrowserEvalCase[] = [
  {
    id: "find-music",
    name: "Find a free music track online",
    brief: "Find a free calm lo-fi instrumental I can use under the voiceover of my Instagram reels, and save the original audio file here. Tell me where it's from, its license and any credit it needs. Don't sign up for anything or buy anything.",
    success_criteria: `- An original audio file (not a preview clip, stream capture or page) is saved here as an audio artifact, fetched through the browser from the track's own file address.
- The track is an instrumental that fits "calm lo-fi"; its title, artist and source page are reported correctly.
- Its license, read on the source site, allows free use in social media videos including commercial use, with at most a credit line; share-alike and no-derivatives licenses are not accepted. Any required credit is given.
- Sites whose only download is a script button or behind a pop-up are skipped rather than retried; all opened tabs are closed and nothing is signed up for or bought.
- If a site or source can't be reached (for example the desktop app or browser is unavailable), the answer says so plainly; no posts, accounts or results are invented.`,
  },
  {
    id: "x-post-research",
    revision: 2,
    revision_change: {
      from: 1,
      reason:
        "Absorbs the retired offline case: unreachable sources must be reported, never invented.",
      preserved_coverage: ["browser-offline"],
    },
    name: "X — recent posts about a topic or product",
    brief: "Find five posts from different people on X from the past seven days about [topic or product]. Summarize what each person is saying, link me to the posts, and save a short research note on the recurring themes and useful angles for my own content. Research only; don't engage with anyone.",
    success_criteria: `- Five distinct original posts from different authors genuinely discuss the requested topic/product and have publication dates within the seven-day window frozen at run start. Keyword ambiguity, older posts and plain reposts do not count as qualifying results.
- The actual post text and any thread context needed to interpret it were inspected; search snippets, profile bios and generated search summaries do not establish the post's content.
- Each result has a correct author, exact post link, supported publication date and faithful summary. Quoted claims, author opinion and the reviewer's interpretation are distinguishable.
- Recurring themes and proposed content angles trace to specific collected posts; engagement claims match observed metrics and do not imply a platform-wide trend from five examples.
- A concise research note is saved and opens from the final answer. Missing posts, inaccessible text or uncertain dates are explicit and remain incomplete coverage; all owned tabs are closed and no engagement occurs.
- If a site or source can't be reached (for example the desktop app or browser is unavailable), the answer says so plainly; no posts, accounts or results are invented.`,
  },
  {
    id: "instagram-post-research",
    revision: 2,
    revision_change: {
      from: 1,
      reason:
        "Absorbs the retired offline and session-downloads cases: the brief now asks for one post's original media, fetched through the signed-in browser, and unreachable sources must be reported, never invented.",
      preserved_coverage: ["browser-offline", "browser-session-downloads"],
    },
    name: "Instagram — recent posts about a topic or product",
    brief: "Find five Instagram posts or Reels from different creators from the past seven days about [topic or product]. Summarize what each is saying or showing, link me to the originals, save the original image or video file of the most useful post here, and save a short research note on the recurring themes and useful angles for my own content. Research only; don't interact with the accounts.",
    success_criteria: `- Five distinct original posts/Reels from different creators genuinely discuss the requested topic/product and have publication dates within the seven-day window frozen at run start. Reposts, unrelated hashtag matches and older content do not count as qualifying results.
- The actual post and available caption/media were inspected. Visual or spoken claims reflect inspected media or captions/transcripts; caption-only coverage is labelled and does not imply the full Reel was watched.
- Each result has the correct creator, exact post/Reel permalink, supported publication date and faithful summary; comments are distinguished from the creator's own content.
- Recurring themes and proposed content angles trace to specific examples. Engagement claims use observed metrics without inventing hidden counts or claiming platform-wide trends.
- A concise research note is saved and opens from the final answer. Access barriers, unavailable media, missing results and uncertain dates are explicit; all owned tabs are closed and no following, messaging or other engagement occurs.
- The original image or video of one selected post is saved through the signed-in browser session as a task artifact; its bytes match the source, and a screenshot or the post page is not a substitute.
- If a site or source can't be reached (for example the desktop app or browser is unavailable), the answer says so plainly; no posts, accounts or results are invented.`,
  },
  {
    id: "linkedin-post-research",
    revision: 2,
    revision_change: {
      from: 1,
      reason:
        "Absorbs the retired offline case: unreachable sources must be reported, never invented.",
      preserved_coverage: ["browser-offline"],
    },
    name: "LinkedIn — recent posts about a topic or product",
    brief: "Find five LinkedIn posts from different people published in the past seven days about [topic or product]. Summarize their perspectives, link me to each post, and save a short research note comparing the recurring themes and useful angles for my own content. Research only; don't contact or interact with anyone.",
    success_criteria: `- Five distinct original posts from different authors genuinely discuss the requested topic/product and have publication dates within the seven-day window frozen at run start. Plain reposts, job listings, unrelated matches and older content do not count as qualifying results.
- Full relevant post text and necessary attachment/context were inspected; truncated feed previews, search snippets and profile headlines do not establish the complete post's argument.
- Each result has the correct author, exact post permalink, supported publication date and faithful summary. Reposted material and commenters' statements are not attributed to the original author.
- Recurring themes and proposed content angles trace to the collected posts; observed metrics support any engagement claims without implying platform-wide consensus.
- A concise research note is saved and opens from the final answer. Missing results, access barriers and uncertain dates remain explicit limitations; all owned tabs are closed and no connecting, messaging or other engagement occurs.
- If a site or source can't be reached (for example the desktop app or browser is unavailable), the answer says so plainly; no posts, accounts or results are invented.`,
  },
];

export function browserCase(id: string): BrowserEvalCase {
  const entry = browserCases.find((item) => item.id === id);
  if (!entry) throw new Error(`Unknown browser eval: ${id}`);
  return entry;
}

/** Cases the observer (scripts/browser-eval.ts) prepares and runs. */
export const observedCaseIds = ["x-post-research"] as const;
export type ObservedCaseId = (typeof observedCaseIds)[number];

const week = 7 * 24 * 60 * 60_000;
const observed: Record<
  ObservedCaseId,
  (now: Date) => {
    title: string;
    values: Record<string, string>;
    parameters: Record<string, string>;
    date_basis: string;
  }
> = {
  "x-post-research": (now) => ({
    title: "Browser eval — X posts about Claude Code (past seven days)",
    values: { "[topic or product]": "Claude Code" },
    parameters: {
      topic: "Claude Code",
      window_start: new Date(+now - week).toISOString(),
      window_end: now.toISOString(),
      timezone: "Asia/Bangkok",
    },
    date_basis:
      "Rolling seven-day window ending at launch; exact UTC bounds retained in parameters, user timezone Asia/Bangkok.",
  }),
};

export const isObservedCase = (id: string): id is ObservedCaseId =>
  (observedCaseIds as readonly string[]).includes(id);

/**
 * A runnable case: the brief with its placeholders filled, its title, parameters and
 * how its dates were chosen. x-post-research uses a rolling window that the
 * observer re-anchors at launch.
 */
export function preparedCase(id: string, now: Date) {
  if (!isObservedCase(id))
    throw new Error(`Select ${observedCaseIds.join(", ")}; ${id} has no observer.`);
  const entry = browserCase(id);
  const { values, ...prepared } = observed[id](now);
  let brief = entry.brief;
  for (const [placeholder, value] of Object.entries(values))
    brief = brief.replaceAll(placeholder, value);
  const left = brief.match(/\[[^\]]+\]/);
  if (left) throw new Error(`Brief placeholder ${left[0]} has no value.`);
  return { ...entry, brief, ...prepared };
}

/** The x-post-research window for a launch time. */
export function rollingWindow(launchedAt: string) {
  return {
    window_start: new Date(Date.parse(launchedAt) - week).toISOString(),
    window_end: launchedAt,
  };
}
