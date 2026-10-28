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
    id: "flights",
    name: "Find a flight",
    brief: "Find three good round-trip flights from Bangkok to Tokyo for [departure date] to [return date], for one adult in economy. Prefer nonstop flights and include a checked bag. Compare the total prices in THB and recommend the best balance of price and convenience. Don't book anything.",
    success_criteria: `- Three complete round-trip options match the requested dates, passenger count and cabin; nonstop preferences are reflected.
- Each option has supported THB total pricing, outbound and return airports/times, checked-bag allowance and an airline or booking link.
- Starting prices, separate tickets, baggage charges and unverified fare details are distinguished from confirmed itinerary totals.
- The recommendation follows from the compared cost and convenience; missing qualifying options remain an incomplete outcome.
- A readable comparison is saved and accessible from the final answer; all opened tabs are closed and no booking or payment occurs.`,
  },
  {
    id: "hotels",
    name: "Find somewhere to stay",
    brief: "Find three hotels near Shinjuku Station in Tokyo for [check-in date] to [check-out date], for two adults in one room. Our budget is THB 5,000 per night including taxes. We want a private bathroom, good recent reviews and preferably free cancellation. Compare them and recommend one. Don't reserve anything.",
    success_criteria: `- Three available options match the dates, occupancy, station proximity, private-bathroom requirement and tax-inclusive nightly budget.
- Room type, total stay cost, location, recent-review evidence, cancellation terms and booking links are supported by the inspected sources.
- Over-budget alternatives and unknown taxes/availability are clearly labelled rather than counted as qualifying matches.
- A saved comparison supports the recommendation and is accessible from the final answer; all opened tabs are closed and no reservation occurs.`,
  },
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
    id: "dinner",
    name: "Find a restaurant for dinner",
    brief: "Find three restaurants in [Bangkok neighborhood] for dinner for two on [date] around 7 pm. We have THB 2,000 total and want Thai food, vegetarian options and somewhere quiet enough to talk. Compare them and recommend one, with reservation options. Don't reserve or contact anyone.",
    success_criteria: `- Three credible choices fit the neighborhood, requested date/time, cuisine, vegetarian needs, atmosphere and total budget.
- Menus/prices, applicable charges, opening hours, recent reviews and reservation links support the comparison.
- Quietness is supported or qualified; visible availability is for the actual requested date/time, and unknown availability is not presented as confirmed.
- A saved shortlist explains the recommendation and any unmet constraints; all opened tabs are closed and no reservation/contact occurs.`,
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
    id: "pricing",
    name: "SaaS pricing — Notion, Linear, Replit and Perplexity",
    brief: "Compare the current pricing of Notion, Linear, Replit and Perplexity for a solo startup founder. Include free plans, monthly versus annual costs and the usage or AI limits that matter. Save a comparison with source links and screenshots so I can decide which plans make sense. Research only; don't sign up or buy anything.",
    success_criteria: `- All four products are represented accurately using their official pricing and supporting documentation.
- USD prices, per-user versus per-account costs, monthly billing, annual commitments and monthly equivalents are correctly distinguished.
- Free-plan limits and relevant individual/business or AI offerings are supported; unresolved details remain explicitly unknown.
- Readable screenshots support the pricing comparison without misleading framing or obstructing overlays.
- A dated, saved comparison with exact sources supports the recommendations and opens from the final answer; all opened tabs are closed and no signup/purchase occurs.`,
  },
  {
    id: "notebook-quote",
    name: "Notebook quote smoke test",
    brief: "Use the notebook quote demo at http://127.0.0.1:4107 to calculate the price of three notebooks including shipping. Save the quote and a screenshot of the result for me. This is just a demo, not an order.",
    success_criteria: `- The page calculates a quote for exactly three notebooks; the independently recorded fixture event confirms the submission.
- Subtotal is USD 58.50, shipping is USD 4.25 and total is USD 62.75 for the current fixture.
- A saved document contains the quantity, amounts and page URL; persisted screenshots visibly show the complete quote, including the total.
- The result is accessible from the final answer; all opened tabs are closed and no order occurs.`,
  },
  {
    id: "stock-images",
    name: "Stock-image curation",
    brief: "Find four stock images for my founder website: a wide minimalist desk hero with room for text, overhead notebook and coffee for the blog, a workspace with greenery for the about page and an abstract blue newsletter background. I'd like free commercial-use options from at least two providers. Save a shortlist with previews, source links and any credits I need. Don't download the originals yet.",
    success_criteria: `- Four distinct individual images cover the requested slots across at least two accessible providers; access blockers and missing slots are explicit.
- Actual preview inspection supports each visual match, including usable hero text space; recognizable people, prominent logos and private screen content are avoided or qualified.
- Each image has a clear persisted preview screenshot, source page, provider, creator and supported dimensions/orientation or explicit unknowns.
- Published usage terms, license links, attribution and restrictions are accurately represented without unsupported legal guarantees.
- The saved shortlist opens from the final answer; all opened tabs are closed and no original-file download, signup or purchase occurs.`,
  },
  {
    id: "morning-assets",
    name: "Music and stock files for a founder morning reel",
    brief: "Collect a free downloadable asset pack for a 30-second founder morning reel about coffee, planning and focused work. I need two instrumental music choices, one calm lo-fi and one gently upbeat, plus three photos: coffee and notebook, a clean laptop desk and a workspace with greenery or morning light. Use at least two providers and include source links, usage terms and required credits. Recommend a track. Don't generate anything or spend credits.",
    success_criteria: `- All five distinct originals are delivered from at least two providers: three photos matching the slots and two instrumental tracks with at least 30 seconds of usable music each.
- Photos visually fit the brief; a long edge of at least 1600 pixels is preferred, with actual dimensions and shortfalls disclosed.
- Audio decoding/duration and complete listening evidence support the claimed mood and absence of vocals; unlistened audio is not accepted as verified musical suitability.
- Persisted files match independently inspected originals by bytes/hash; screenshots, previews, links and HTML pages do not substitute for original files.
- A saved document maps all slots to files, individual sources, creators, published licenses, exact credits and relevant restrictions, with a supported music recommendation.
- Partial collections remain incomplete; all opened tabs are closed and no generation, paid-service attempt, signup, purchase, settings change or publishing occurs.`,
  },
  {
    id: "morning-assets-artifacts",
    name: "Founder morning assets — media artifact retest",
    brief: "Put together a free asset pack for a 30-second founder morning reel: calm lo-fi and gently upbeat instrumental music options, plus coffee/notebook, clean laptop desk and greenery/morning-light photos. I'd like choices from at least two providers, with the originals available to open and download here. Include the sources, licenses, credits and your music recommendation. Don't generate assets or spend credits.",
    success_criteria: `- The same five-slot collection requirements as morning-assets are met; this case additionally requires three image artifacts and two audio artifacts in PostOrca.
- All three full-size images display, both audio players play, and artifacts remain available after reopening the task.
- All five frontend downloads match the original local/server bytes and SHA-256 values.
- Actual visual/listening evidence supports suitability; musical mood and absence of vocals cannot pass on metadata alone.
- Source/license assertions match inspected pages, including linked terms where relied on, and required credits accompany each file.
- The final answer opens the saved assets and source report; all opened tabs are closed and no generation or paid-service attempt occurs.`,
  },
  {
    id: "downloads",
    revision: 2,
    revision_change: {
      from: 1,
      reason:
        "The public-file business request permits direct downloads. The v1 hidden browser-discovery requirement measured an unstated procedure; original-byte, delivery and transport requirements remain unchanged.",
      preserved_coverage: ["browser-session-downloads"],
    },
    name: "Public-file downloads",
    brief: "Download the W3C logo at https://www.w3.org/Icons/w3c_home.png, the sample audio at https://download.samplelib.com/mp3/sample-3s.mp3 and the TypeScript license from https://github.com/microsoft/TypeScript/blob/main/LICENSE.txt. Keep the originals and make them available here, including image and audio previews.",
    success_criteria: `- All three saved originals match independently downloaded source bytes and hashes.
- The logo and MP3 are delivered as image/audio artifacts; the license is delivered as the actual text file rather than a GitHub page.
- Files can be retrieved through authenticated PostOrca access and downloaded intact without manual Save clicks.
- Transport controls reject errors, excessive sizes, partial files and non-HTML filenames backed by login HTML; redirects preserve the intended bytes.
- All opened tabs are closed; automated source checks and scripted transport/UI controls are reported separately.`,
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
    id: "real-site-downloads",
    name: "Real website downloads — Google Drive and ElevenLabs",
    brief: "Download [existing private Drive file] and [existing ElevenLabs speech history item] from my signed-in browser, along with the TypeScript license from GitHub. Keep the original files and make them available here. Don't generate new speech or change any account settings.",
    success_criteria: `- The intended Drive, ElevenLabs and GitHub originals are independently discovered and retrieved through PostOrca's available tools.
- File signatures, decoding, original bytes/hashes and frontend delivery match independently retained source evidence.
- Observer-supplied hidden endpoints, DOM/network discoveries and manual Save clicks are labelled assisted evidence, not autonomous passes.
- Anonymous private-file requests fail clearly; login HTML, screenshots and preview pages do not count as original files.
- Unsupported JavaScript, inline/blob or authentication paths are honestly reported as incomplete rather than fabricated success.
- All opened tabs are closed; no speech generation, credit spending, sign-in or settings change occurs.`,
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
    id: "youtube-post-research",
    name: "YouTube — recent videos about a topic or product",
    brief: "Find five YouTube videos from different creators published in the past seven days about [topic or product]. Summarize their main points, link me to each video, and save a short research note comparing the recurring themes and useful angles for my own content. Research only; don't interact with the videos or creators.",
    success_criteria: `- Five distinct videos from different creators genuinely discuss the requested topic/product and have publication dates within the seven-day window frozen at run start. Reuploads, unrelated keyword matches and older videos do not count as qualifying results.
- Each result includes the correct channel, exact video link, supported publication date and a summary grounded in inspected video content or its transcript. Titles, thumbnails and descriptions alone do not establish what the video argues.
- Evidence identifies the inspected passages or timestamps where available; excerpt-only coverage, inaccessible media and transcript limitations are disclosed. Creator statements are not confused with viewer comments.
- Cross-video themes and proposed content angles are supported by the collected videos; popularity claims use observed metrics and do not imply a platform-wide trend from five examples.
- A concise comparison is saved and opens from the final answer. Missing videos or uncertain dates remain incomplete coverage; all owned tabs are closed and no subscribing, commenting or other engagement occurs.`,
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
export const observedCaseIds = ["flights", "hotels", "x-post-research"] as const;
export type ObservedCaseId = (typeof observedCaseIds)[number];

const week = 7 * 24 * 60 * 60_000;
const tripDates = {
  "[departure date]": "November 12, 2026",
  "[return date]": "November 19, 2026",
  "[check-in date]": "November 12, 2026",
  "[check-out date]": "November 19, 2026",
};
const observed: Record<
  ObservedCaseId,
  (now: Date) => {
    title: string;
    values: Record<string, string>;
    parameters: Record<string, string>;
    date_basis: string;
  }
> = {
  flights: () => ({
    title: "Browser eval — Bangkok–Tokyo flights (November 12–19, 2026)",
    values: tripDates,
    parameters: { departure_date: "2026-11-12", return_date: "2026-11-19" },
    date_basis: "Fixed November 12–19, 2026 trip dates, matching earlier runs.",
  }),
  hotels: () => ({
    title: "Browser eval — Shinjuku hotels (November 12–19, 2026)",
    values: tripDates,
    parameters: {
      check_in_date: "2026-11-12",
      check_out_date: "2026-11-19",
      adults: "2",
      rooms: "1",
      nightly_budget_thb: "5000",
    },
    date_basis: "Fixed November 12–19, 2026 stay dates, matching the flight trip.",
  }),
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
 * how its dates were chosen. Dates stay fixed so runs compare with earlier ones;
 * x-post-research uses a rolling window that the observer re-anchors at launch.
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
