export type VideoExpectation = {
  exports: number | number[];
  seconds?: [number, number];
  skill?: string;
  mustInclude?: string[];
  captionsOff?: boolean;
  brandOverride?: boolean;
  noProfileColors?: boolean;
  listNumbers?: boolean;
  formats?: string[];
  screens?: { folder: string; min: number; contain?: boolean; focus?: boolean };
  music?: {
    /** "web": the agent finds and downloads a free track itself. */
    source?: "web";
    title?: string;
    notTitle?: string;
    minStart?: number;
    noVoiceover?: boolean;
  };
};
export type VideoCase = {
  id: string;
  revision?: number;
  revision_change?: {
    from: number;
    reason: string;
    preserved_coverage: string[];
  };
  name: string;
  start: { brief: string } | { of: string; messages: string[] };
  expect: VideoExpectation;
};
const deliver =
  "Check it before exporting, then deliver the final MP4. Don't publish anything.";

// The original scenario IDs, facts, timing ranges and follow-up requests are retained.
export const videoCases: VideoCase[] = [
  {
    id: "B2",
    name: "Lesson in my voice",
    start: {
      brief: `Make a 30-second UGC-style vertical reel for LinkedIn, in my voice, about the biggest lesson from getting Autopilot Startup's first users: my launch post brought 3 signups, but replying to people complaining about weekly reporting brought 7 of our first 10 users. Lesson: go where people already describe the problem. Voiceover and captions. ${deliver}`,
    },
    expect: {
      exports: 1,
      seconds: [20, 50],
      skill: "video-lesson",
      mustInclude: ["\\b(3|three)\\b", "\\b(7|seven)\\b", "\\b(10|ten)\\b"],
      listNumbers: true,
    },
  },
  {
    id: "B3",
    name: "Product update as a founder story",
    start: {
      brief: `Make a 20-second UGC-style reel for LinkedIn and Instagram where I tell people why I built our new Weekly Founder Digest: every Monday it summarizes what your startup's agents did last week and lists the decisions waiting for you. It's live now at autopilotstartup.com. ${deliver}`,
    },
    expect: {
      exports: 1,
      seconds: [15, 32],
      skill: "video-product-update",
      mustInclude: ["Weekly Founder Digest", "autopilotstartup\\.com"],
    },
  },
  {
    id: "B4",
    name: "Post said out loud",
    start: {
      brief: `Turn this LinkedIn post of mine into a 20–30 second UGC-style reel, keeping my words (trim if needed, add nothing):\n\n"I used to think shipping fast meant working late. It doesn't. It means deciding fast. Every Friday I write down the three decisions I've been avoiding and make them before lunch. Most weeks that unblocks more than any feature I ship."\n\nVoiceover and captions. ${deliver}`,
    },
    expect: {
      exports: 1,
      seconds: [15, 35],
      skill: "video-post-to-video",
      mustInclude: ["deciding fast", "three decisions|3 decisions"],
    },
  },
  {
    id: "B5",
    name: "Build log with exact numbers",
    start: {
      brief: `Make a 20-second build-in-public update reel for X: this month Autopilot Startup went from 120 to 310 weekly active founders, shipped the Weekly Founder Digest, and cut onboarding from 9 minutes to 4. Voiceover and captions. ${deliver}`,
    },
    expect: {
      exports: 1,
      seconds: [15, 32],
      skill: "video-build-log",
      mustInclude: [
        "\\b120\\b",
        "\\b310\\b",
        "\\b(9|nine)\\b",
        "\\b(4|four)\\b",
      ],
      listNumbers: true,
    },
  },
  {
    id: "B6",
    name: "Event invite with exact details",
    start: {
      brief: `Make a 15-second UGC-style reel inviting people to my live AMA on building with AI agents: Friday, November 6, 2026 at 7 pm Bangkok time, on LinkedIn Live. Put "lu.ma/autopilot-ama" on screen at the end. ${deliver}`,
    },
    expect: {
      exports: 1,
      seconds: [12, 25],
      skill: "video-event-invite",
      mustInclude: [
        "nov(ember)?\\.? 6",
        "\\b7\\s?(pm|p\\.m\\.)|7:00",
        "lu\\.ma/autopilot-ama",
      ],
    },
  },
  {
    id: "B7",
    name: "Revise, then vary the hook (Follow Up on B5)",
    start: {
      of: "B5",
      messages: [
        "Too salesy. Make the hook more personal and cut it to 15 seconds.",
        "Give me 2 alternative hooks for this video, each as its own MP4.",
      ],
    },
    expect: { exports: [1, 2], seconds: [10, 20] },
  },
  {
    id: "B8",
    name: "One story, two platforms",
    start: {
      brief: `Make one UGC-style version for Instagram Reels and one for LinkedIn, each fitting its platform, of this story: for a year I rewrote every LinkedIn post five times and posted twice a month. In March I switched to a short daily build log. Now I post five days a week and get about three times the replies. ${deliver}`,
    },
    expect: { exports: 2, seconds: [12, 60] },
  },
  {
    id: "B11",
    name: "Product demo walkthrough",
    start: {
      brief: `Make a 20–25 second UGC-style product demo reel, "here's how I actually use it": every Monday at 8 am the Weekly Founder Digest lands in my inbox. Top: what my agents did last week. Middle: the decisions waiting for me, each with an approve button. Bottom: this week's metrics. I clear it with my coffee in under 10 minutes. End on "autopilotstartup.com". Voiceover and captions. ${deliver}`,
    },
    expect: {
      exports: 1,
      seconds: [15, 32],
      skill: "video-product-demo",
      mustInclude: ["Weekly Founder Digest|digest", "autopilotstartup\\.com"],
    },
  },
  {
    id: "B12",
    name: "POV storytime",
    start: {
      brief: `Make a 20–30 second POV storytime reel for TikTok and Reels: POV, it's 1 am the night before launch and Stripe payments keep failing. After two hours I find it: a trailing space in the API key. We launched at 9 am on two hours of sleep, and the first payment came in at 9:14. Voiceover and captions. ${deliver}`,
    },
    expect: {
      exports: 1,
      seconds: [15, 35],
      skill: "video-pov-storytime",
      mustInclude: ["\\bpov\\b", "9:14"],
    },
  },
  {
    id: "B13",
    name: "Product demo from screenshots: desktop app",
    start: {
      brief:
        "demo vid for cold turkey blocker for linkedin\n- blocks distracting sites + apps\n- can lock it so u cant cheat\n- stats\nscreenshots in screenshots/cold-turkey-screenshots\nsite getcoldturkey.com",
    },
    expect: {
      exports: 1,
      seconds: [15, 32],
      skill: "video-product-demo",
      mustInclude: ["Cold Turkey", "getcoldturkey\\.com"],
      screens: { folder: "cold-turkey", min: 3, contain: true, focus: true },
      formats: ["16:9", "1:1", "4:5"],
    },
  },
  {
    id: "B14",
    name: "Product demo from screenshots: phone app",
    start: {
      brief:
        'quick reel showing google keep (notes app i use on my phone). free. notes, checklists, pin stuff. screens are in "screenshots/google keep screenshots"',
    },
    expect: {
      exports: 1,
      seconds: [12, 25],
      skill: "video-product-demo",
      mustInclude: ["Google Keep|Keep"],
      screens: { folder: "google keep", min: 2 },
    },
  },
  {
    id: "F2",
    name: "Captions off",
    start: {
      brief: `Make a 15-second UGC-style reel with a voiceover about why I post every weekday: it makes me think in public, 3 of my last 5 customers found me through a post, and it only takes 20 minutes because I keep a running notes file. No captions: I'll add my own subtitles in the app. ${deliver}`,
    },
    expect: { exports: 1, seconds: [10, 25], captionsOff: true },
  },
  {
    id: "F3",
    revision: 2,
    revision_change: {
      from: 1,
      reason:
        "Absorbs the retired morning-assets-artifacts case: the agent now finds and downloads a free lo-fi track itself instead of using the project music folder.",
      preserved_coverage: ["browser-morning-assets-artifacts"],
    },
    name: "Music under a voiceover",
    start: {
      brief: `Make a 15-second UGC-style reel of my morning before any calls: coffee at 6, inbox cleared by 7, then one hour on the product. Voiceover and captions, with soft lo-fi music underneath. Find a free track online that I'm allowed to use, and tell me where it's from and any credit it needs. ${deliver}`,
    },
    expect: {
      exports: 1,
      seconds: [10, 25],
      skill: "video-music",
      music: { source: "web" },
    },
  },
  {
    id: "F4",
    name: "Music without a voiceover",
    start: {
      brief: `Make a 12-second UGC-style reel with no voiceover, only on-screen text and upbeat music from the music folder in my project folder: "3 tools I open every day" — Linear, Notion, Autopilot Startup. ${deliver}`,
    },
    expect: {
      exports: 1,
      seconds: [8, 20],
      skill: "video-music",
      mustInclude: ["Linear", "Notion", "Autopilot Startup"],
      music: {
        notTitle:
          "lo-?fi|Pray For You|Someone Like You|Psychology|Focus On|ပရိတ်",
        noVoiceover: true,
      },
    },
  },
  {
    id: "F9",
    name: "Music chosen by mood: calm",
    start: {
      brief: `Make a 12-second UGC-style reel with no voiceover, only on-screen text and music from the music folder in my project folder: "Some nights the work is just showing up. Laptop open at 11 pm. One more commit." ${deliver}`,
    },
    expect: {
      exports: 1,
      seconds: [8, 20],
      skill: "video-music",
      music: {
        title: "lo-?fi|Pray For You|Someone Like You",
        noVoiceover: true,
      },
    },
  },
  {
    id: "F11",
    name: "Music chosen by mood: celebration",
    start: {
      brief: `Make a 10-second UGC-style reel with no voiceover, only on-screen text and music from the music folder in my project folder: "1,000 founders on Autopilot Startup. Thank you." ${deliver}`,
    },
    expect: {
      exports: 1,
      seconds: [7, 18],
      skill: "video-music",
      mustInclude: ["1,000"],
      music: {
        notTitle:
          "lo-?fi|Pray For You|Someone Like You|Psychology|Focus On|ပရိတ်",
        noVoiceover: true,
      },
    },
  },
  {
    id: "F10",
    name: "Music: skip a quiet intro",
    start: {
      brief: `Make a 15-second UGC-style reel with a voiceover about launch week: we shipped 3 features in 5 days and slept a lot less. Use the INNA – Heaven track from the music folder in my project folder; skip its slow 29-second intro. ${deliver}`,
    },
    expect: {
      exports: 1,
      seconds: [10, 25],
      skill: "video-music",
      mustInclude: ["\\b(3|three)\\b", "\\b(5|five)\\b"],
      music: { title: "Heaven", minStart: 25 },
    },
  },
  {
    id: "F5",
    name: "Colours overridden for one video",
    start: {
      brief: `Make a 15-second UGC-style holiday reel thanking our first 500 users and wishing them happy holidays from the Autopilot Startup team. For this one only, use holiday colours: background #8B1E2D, text #FFFFFF, highlight #3FA34D. ${deliver}`,
    },
    expect: {
      exports: 1,
      seconds: [10, 25],
      brandOverride: true,
      mustInclude: ["\\b500\\b"],
    },
  },
  {
    id: "F6",
    name: "No brand colours saved",
    start: {
      brief: `Make a 15-second UGC-style reel about the one habit that keeps me posting consistently: before I close my laptop each night, I spend 10 minutes writing tomorrow's post, so every morning starts with something ready. ${deliver}`,
    },
    expect: { exports: 1, seconds: [10, 25], noProfileColors: true },
  },
  {
    id: "F7",
    name: "Long explainer near the limit",
    start: {
      brief: `Make a 75-second UGC-style explainer reel: "how I run my startup's week with AI agents". Monday: a planning agent drafts the week's priorities from last week's metrics. Tuesday: a research agent summarizes 20 competitor updates. Wednesday: a content agent drafts 5 posts and I edit them. Thursday: an outreach agent drafts 30 personal emails and I approve them. All week: a support agent answers about 80% of tickets. Friday: a 30-minute review of a metrics dashboard. Voiceover and captions. ${deliver}`,
    },
    expect: {
      exports: 1,
      seconds: [55, 90],
      mustInclude: ["\\b20\\b", "\\b30\\b", "80"],
      listNumbers: true,
    },
  },
];

// App-level counterpart of the original README's image/speech and revision smoke prompts.
export const mediaAgentCase: VideoCase = {
  id: "M1",
  name: "Media generation and image revision",
  start: {
    brief:
      "Generate one square flat illustration of a small green sprout in a terracotta pot on a warm cream background, with no text. Also say exactly: Welcome to Personal Brand Agent. Deliver the finished image and speech as artifacts here. Do not publish anything or save memory from this temporary media check.",
  },
  expect: { exports: 0 },
};
