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
    id: "social-accounts",
    name: "Discover relevant social accounts",
    brief: "Find five active accounts on X worth following for practical lessons about building bootstrapped SaaS businesses. I want founders sharing their own progress and experience. Tell me what each is building and show me a recent post that makes them worth following. Don't follow anyone for me.",
    success_criteria: `- Five distinct, active founders match the bootstrapped SaaS interest through firsthand posts.
- Each entry has the correct identity, handle, profile link, supported description of what they are building and an exact recent-post link.
- The cited post demonstrates the stated practical value; identities are not conflated and stale or inaccessible evidence is disclosed.
- The shortlist is saved and accessible from the final answer; all opened tabs are closed and no following or engagement occurs.`,
  },
  {
    id: "conversations",
    name: "Research conversations worth joining",
    brief: "Using my brand profile, find three recent conversations on X where I could add something useful about building startups or AI products. Explain why each fits me and suggest a reply in my voice. Don't invent personal experience or post anything.",
    success_criteria: `- Three recent, distinct conversations have exact post links and supported relevance to the founder's profile.
- Existing replies are reflected in the assessment; each proposed reply adds a specific contribution rather than repeating the discussion.
- Replies fit the available voice/profile evidence and contain no invented firsthand experience; missing profile detail is explicit.
- The saved report and replies are accessible from the final answer; all opened tabs are closed and no posting or engagement occurs.`,
  },
  {
    id: "feedhub",
    name: "FeedHub AI-agent builders research (known answers)",
    brief: "Find at least three people on FeedHub at http://127.0.0.1:4106 who are actually building AI agents or automation tools. Tell me who they are, what they're building and the patterns in their posts. Save a JSON report with a profiles_analyzed count, a users list and a summary. For each user include username, display_name, bio, profile_url, classification, posts_reviewed, main_topics, top_hashtags and key_insight. Research only; don't engage with anyone.",
    success_criteria: `- At least three distinct actual builders are correctly identified; people only discussing the topic are not misclassified as builders.
- Each reported identity and exact bio matches the independent fixture data, and the actual profile was visited.
- All available posts for each selected profile are accounted for; post counts, main topics, most-used hashtags and building insights match the source posts.
- One saved document contains valid JSON with profiles_analyzed matching the users list and the requested per-user fields.
- The report is accessible from the final answer; all opened tabs are closed and no engagement occurs.
- Automated fact/structure checks and human review of insights are separate; recovered tool errors remain recorded for reliability review.`,
  },
  {
    id: "morning-assets-artifacts",
    name: "Founder morning assets — media artifact retest",
    brief: "Put together a free asset pack for a 30-second founder morning reel: calm lo-fi and gently upbeat instrumental music options, plus coffee/notebook, clean laptop desk and greenery/morning-light photos. I'd like choices from at least two providers, with the originals available to open and download here. Include the sources, licenses, credits and your music recommendation. Don't generate assets or spend credits.",
    success_criteria: `- All five distinct originals are delivered from at least two providers: three photos matching the slots and two instrumental tracks with at least 30 seconds of usable music each, as three image artifacts and two audio artifacts in PostOrca.
- Photos visually fit the brief; a long edge of at least 1600 pixels is preferred, with actual dimensions and shortfalls disclosed.
- A saved document maps all slots to files, individual sources, creators, published licenses, exact credits and relevant restrictions; partial collections remain incomplete.
- All three full-size images display, both audio players play, and artifacts remain available after reopening the task.
- All five frontend downloads match the original local/server bytes and SHA-256 values.
- Actual visual/listening evidence supports suitability; musical mood and absence of vocals cannot pass on metadata alone.
- Source/license assertions match inspected pages, including linked terms where relied on, and required credits accompany each file.
- The final answer opens the saved assets and source report; all opened tabs are closed and no generation or paid-service attempt occurs.`,
  },
  {
    id: "session-downloads",
    name: "Browser-session file downloads",
    brief: "Download the files at [protected file links] using my existing browser session and make the originals available here.",
    success_criteria: `- Cookie-protected PNG, MP3, MP4, PDF, generic binary and 6 MiB fixture files arrive through the owned browser session without manual Save clicks.
- Local/server bytes and SHA-256 values match fixture originals; authenticated retrieval, ranges and frontend downloads preserve those bytes.
- An anonymous request fails for the same protected resources, demonstrating that the existing session is actually required.
- Unowned tabs, missing files and unsupported custom-header authentication fail clearly without importing bogus files.
- Credentials remain inside the browser boundary; browser settings are unchanged and all opened tabs and resource streams are closed.`,
  },
  {
    id: "x-post-research",
    name: "X — recent posts about a topic or product",
    brief: "Find five posts from different people on X from the past seven days about [topic or product]. Summarize what each person is saying, link me to the posts, and save a short research note on the recurring themes and useful angles for my own content. Research only; don't engage with anyone.",
    success_criteria: `- Five distinct original posts from different authors genuinely discuss the requested topic/product and have publication dates within the seven-day window frozen at run start. Keyword ambiguity, older posts and plain reposts do not count as qualifying results.
- The actual post text and any thread context needed to interpret it were inspected; search snippets, profile bios and generated search summaries do not establish the post's content.
- Each result has a correct author, exact post link, supported publication date and faithful summary. Quoted claims, author opinion and the reviewer's interpretation are distinguishable.
- Recurring themes and proposed content angles trace to specific collected posts; engagement claims match observed metrics and do not imply a platform-wide trend from five examples.
- A concise research note is saved and opens from the final answer. Missing posts, inaccessible text or uncertain dates are explicit and remain incomplete coverage; all owned tabs are closed and no engagement occurs.`,
  },
  {
    id: "instagram-post-research",
    name: "Instagram — recent posts about a topic or product",
    brief: "Find five Instagram posts or Reels from different creators from the past seven days about [topic or product]. Summarize what each is saying or showing, link me to the originals, and save a short research note on the recurring themes and useful angles for my own content. Research only; don't interact with the accounts.",
    success_criteria: `- Five distinct original posts/Reels from different creators genuinely discuss the requested topic/product and have publication dates within the seven-day window frozen at run start. Reposts, unrelated hashtag matches and older content do not count as qualifying results.
- The actual post and available caption/media were inspected. Visual or spoken claims reflect inspected media or captions/transcripts; caption-only coverage is labelled and does not imply the full Reel was watched.
- Each result has the correct creator, exact post/Reel permalink, supported publication date and faithful summary; comments are distinguished from the creator's own content.
- Recurring themes and proposed content angles trace to specific examples. Engagement claims use observed metrics without inventing hidden counts or claiming platform-wide trends.
- A concise research note is saved and opens from the final answer. Access barriers, unavailable media, missing results and uncertain dates are explicit; all owned tabs are closed and no following, messaging or other engagement occurs.`,
  },
  {
    id: "linkedin-post-research",
    name: "LinkedIn — recent posts about a topic or product",
    brief: "Find five LinkedIn posts from different people published in the past seven days about [topic or product]. Summarize their perspectives, link me to each post, and save a short research note comparing the recurring themes and useful angles for my own content. Research only; don't contact or interact with anyone.",
    success_criteria: `- Five distinct original posts from different authors genuinely discuss the requested topic/product and have publication dates within the seven-day window frozen at run start. Plain reposts, job listings, unrelated matches and older content do not count as qualifying results.
- Full relevant post text and necessary attachment/context were inspected; truncated feed previews, search snippets and profile headlines do not establish the complete post's argument.
- Each result has the correct author, exact post permalink, supported publication date and faithful summary. Reposted material and commenters' statements are not attributed to the original author.
- Recurring themes and proposed content angles trace to the collected posts; observed metrics support any engagement claims without implying platform-wide consensus.
- A concise research note is saved and opens from the final answer. Missing results, access barriers and uncertain dates remain explicit limitations; all owned tabs are closed and no connecting, messaging or other engagement occurs.`,
  },
  {
    id: "threads-post-research",
    name: "Threads — recent posts about a topic or product",
    brief: "Find five posts from different people on Threads from the past seven days about [topic or product]. Summarize what each person is saying, link me to the posts, and save a short research note on the recurring themes and useful angles for my own content. Research only; don't engage with anyone.",
    success_criteria: `- Five distinct original posts from different authors genuinely discuss the requested topic/product and have publication dates within the seven-day window frozen at run start. Plain reposts, unrelated matches and older content do not count as qualifying results.
- Actual post text and the necessary parent/continuation context were inspected. Search snippets, profile pages and isolated reply fragments do not establish the original post's meaning.
- Each result has the correct author, exact Threads post permalink, supported publication date and faithful summary; replies and quoted material remain correctly attributed.
- Recurring themes and proposed content angles trace to specific collected posts; engagement claims use observed metrics and do not imply platform-wide trends from five examples.
- A concise research note is saved and opens from the final answer. Missing results, unavailable context and uncertain dates are explicit; all owned tabs are closed and no following, replying or other engagement occurs.`,
  },
  {
    id: "offline",
    name: "Browser work while the desktop app is closed",
    brief: "Open https://example.com in my browser and tell me the page title.",
    success_criteria: `- With the desktop app closed, the initial availability check and exactly one confirming check both report unavailable.
- No desktop or browser tool is attempted after confirmation; the run stops without repeated polling.
- The final explanation clearly states that the browser task could not be performed because the desktop is unavailable.
- No page title, browsing result or artifact is fabricated; completion of this blocked response is distinct from completing the requested browsing.`,
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
