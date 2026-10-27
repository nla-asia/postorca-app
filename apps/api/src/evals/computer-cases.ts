import type {
  EvalCall,
  EvalCheck,
  EvalEvidence,
} from "./computer-eval-types.js";
export type {
  EvalCall,
  EvalCheck,
  EvalEvidence,
} from "./computer-eval-types.js";
export const computerCaseOrder = [
  "calculator",
  "notepad",
  "chatgpt",
  "edge-google",
] as const;
export type ComputerCaseId = (typeof computerCaseOrder)[number];
export type ComputerCase = {
  id: ComputerCaseId;
  name: string;
  brief: string;
  expected: Record<string, any>;
  criteria: string[];
  manualReview: boolean;
};
const shared = [
  "The internal agent checks desktop availability, activates computer use, and reads its skill.",
  "It discovers and opens/selects the correct real app, observes before input, and retains screenshot evidence.",
  "The outcome is independently read from the real app after the turn; a plausible final answer alone cannot pass.",
  "No tool errors, substitute browser/file/network workflows, unrelated edits, or cross-task memory writes occur.",
];
export function computerCase(
  id: ComputerCaseId,
  attempt: number,
  nonce: string,
): ComputerCase {
  if (id === "calculator") {
    const [a, b, adjustment] = [
      [37, 24, 19],
      [58, 17, -23],
      [46, 29, 31],
    ][(attempt - 1) % 3];
    return {
      id,
      name: "Calculator use",
      manualReview: false,
      brief: `Use the desktop Calculator app to multiply ${a} by ${b}, then ${adjustment < 0 ? "subtract" : "add"} ${Math.abs(adjustment)}. Work it out in the actual app, report the final number, and leave Calculator showing that result. Include a screenshot of the result here. This is a temporary desktop check: don't use a browser, files, or another calculation method as a substitute, and don't save cross-task memory from it.`,
      expected: { result: a * b + adjustment, app: "Calculator" },
      criteria: [
        ...shared,
        "Successful mouse or keyboard input reaches Calculator; independent accessibility readback and the agent's answer agree on the exact result.",
        "The requested screenshot is delivered as an artifact.",
      ],
    };
  }
  if (id === "notepad") {
    const text = [
      `PostOrca desktop evaluation ${nonce}`,
      "Unicode: สวัสดี 👋 — café",
      ...Array.from(
        { length: 45 },
        (_, i) => `Line ${String(i + 1).padStart(2, "0")}: check ${nonce}.`,
      ),
      `END ${nonce}`,
    ].join("\n");
    return {
      id,
      name: "Notepad use",
      manualReview: false,
      brief: `Open desktop Notepad and create a new tab for the exact document below, preserving any existing tabs. Enter it as plain text, check the heading at the beginning, then use mouse-wheel scrolling down until the final line is visible. Leave the new tab open without saving over any file, and include a screenshot of its ending here. Don't use files, a browser, or cross-task memory as a substitute.\n\n${text}`,
      expected: {
        text,
        heading: `PostOrca desktop evaluation ${nonce}`,
        ending: `END ${nonce}`,
        app: "Notepad",
      },
      criteria: [
        ...shared,
        "A fresh tab is created before document input; existing tabs are not edited or closed.",
        "Independent accessibility readback matches all supplied Unicode text after normalizing line endings.",
        "The agent navigates to the beginning and scrolls to the ending; independent visible-text readback contains the final marker.",
        "The requested screenshot is delivered as an artifact.",
      ],
    };
  }
  if (id === "edge-google") {
    const query = [
      "James Webb Space Telescope",
      "Hubble Space Telescope",
      "International Space Station",
    ][(attempt - 1) % 3];
    return {
      id,
      name: "Edge Google search using computer use",
      manualReview: true,
      brief: `Use only the computer-use plugin to open Microsoft Edge, create a new tab while preserving existing tabs, and go to https://www.google.com. From the Google page, search for the exact phrase "${query}". Check that the results page actually loaded, report the search phrase and the first two ordinary web-result titles you can see, and include a screenshot of the results here. Leave the results tab open. This specifically tests general desktop control: do not activate the browser plugin or use browser automation, search/network tools, files, scripts, or cross-task memory as a substitute. If Google presents a consent dialog or a bot/access challenge, report what you see; do not change browser settings or attempt to bypass a challenge.`,
      expected: { app: "Microsoft Edge", query },
      criteria: [
        ...shared,
        "All app input targets Microsoft Edge; a fresh tab preserves existing tabs.",
        "The agent visits the Google homepage before entering and submitting the exact query through that page.",
        "Independent Edge readback shows a Google search URL with the exact decoded q parameter, rather than an address-bar suggestion or another search engine.",
        "Independent observer checks the homepage-to-results screenshots, two reported web-result titles and the delivered results image; a consent/challenge page is not a pass.",
      ],
    };
  }
  return {
    id,
    name: "ChatGPT/Codex use",
    manualReview: true,
    brief: `In the ChatGPT/Codex desktop app, find the existing conversation titled "Review production quality checklist". Read the recent discussion and summarize the latest decisions about: (1) which browser-eval use cases should take priority, (2) the platform-specific post-research evals that were added and their requirements, and (3) the first concrete research topic and how far its run actually got. Account for later corrections to earlier suggestions. Save a concise document with the decisions and evidence screenshots, and clearly state any reading limits. Do not send messages, change settings, modify conversations, use browser/file tools as a substitute, or save cross-task memory from this temporary check.`,
    expected: {
      app: "ChatGPT",
      title: "Review production quality checklist",
      topics: [
        "Social-content research and asset discovery take priority over generic flight/hotel regressions",
        "Five platform-specific research evals: X, YouTube, Instagram, LinkedIn, Threads; five examples from different people in past seven days, original links, summaries, recurring themes/content angles; 20 evals total",
        "First concrete topic: X posts about Claude Code; no engagement; readiness checks saw X feed errors and retry, interrupted by usage limit; no completed research results verified",
      ],
    },
    criteria: [
      ...shared,
      "The agent finds the named conversation and reads its real content rather than relying on memory.",
      "The summary captures current decisions and later corrections, with no invented verification claims.",
      "A saved document and evidence screenshots are delivered; bounded/partial reading is disclosed.",
      "Independent observer reviews the summary and screenshots before the run can pass.",
    ],
  };
}

export function gradeComputer(
  entry: ComputerCase,
  evidence: EvalEvidence,
): EvalCheck[] {
  const { calls, observed } = evidence;
  const successful = (name: string) =>
    calls.filter((c) => c.name === name && !c.result?.error);
  const input = calls.filter((c) =>
    [
      "computer_click",
      "computer_type",
      "computer_press",
      "computer_scroll",
    ].includes(c.name),
  );
  const errors = calls.filter((c) => !c.result || c.result.error);
  const forbidden = calls.filter((c) =>
    /^(browser_|media_|download_|upload_|read_file$|list_dir$|save_memory$|delete_memory$|update_brand_|save_brand_|delete_brand_|start_task$)/.test(
      c.name,
    ),
  );
  const activation =
    successful("activate_plugin").findIndex(
      (c) => c.args.code === "computer",
    ) >= 0;
  const screenshots = calls
    .flatMap((c) => c.result?.attachments ?? [])
    .filter((a) => a.kind === "screenshot");
  const screenshotFiles = new Set(screenshots.map((s) => s.file));
  const delivered = evidence.artifacts.filter((a) => {
    if (a.kind !== "image") return false;
    try {
      return screenshotFiles.has(
        (typeof a.content === "string" ? JSON.parse(a.content) : a.content)
          ?.file,
      );
    } catch {
      return false;
    }
  });
  const nodes = observed?.accessibility?.nodes ?? [];
  const text = nodes.map((n: any) => n.text ?? "").join("\n");
  const checks: EvalCheck[] = [
    { name: "Turn completed", passed: evidence.status === "completed" },
    {
      name: "Desktop checked, plugin activated and skill read",
      passed:
        !!successful("desktop_status").length &&
        activation &&
        successful("read_skill").some((c) => c.args.name === "computer-use"),
    },
    {
      name: "App discovered and opened",
      passed:
        !!successful("computer_list_apps").length &&
        !!successful("computer_open").length,
    },
    {
      name: "Real app input and screenshot evidence",
      passed:
        input.some((c) => c.result?.input_sent) &&
        screenshots.length > 0 &&
        !!observed?.attachments?.length,
    },
    {
      name: "No tool errors or substitute workflows",
      passed: errors.length === 0 && forbidden.length === 0,
      details: {
        errors: errors.map((c) => ({ name: c.name, error: c.result?.error })),
        forbidden: forbidden.map((c) => c.name),
      },
    },
    {
      name: "Control released when turn finished",
      passed: evidence.controlReleased,
    },
    {
      name: "Screenshot delivered as an artifact",
      passed: delivered.length > 0,
    },
  ];
  if (entry.id === "calculator") {
    checks.push({
      name: "Independent Calculator result matches",
      passed:
        observed?.title === "Calculator" &&
        nodes.some(
          (n: any) =>
            /^Display is /.test(n.text) &&
            n.text.replace(/^Display is /, "").replace(/[,\s]/g, "") ===
              String(entry.expected.result),
        ),
      details: {
        expected: entry.expected.result,
        display: nodes
          .filter((n: any) => /^Display is /.test(n.text))
          .map((n: any) => n.text),
      },
    });
    checks.push({
      name: "Final answer reports the same result",
      passed: new RegExp(`\\b${entry.expected.result}\\b`).test(
        evidence.final.replace(/,/g, ""),
      ),
    });
    checks.push({
      name: "All input targeted Calculator",
      passed: input
        .filter((c) => c.result?.input_sent)
        .every((c) => c.result?.title === "Calculator"),
    });
  } else if (entry.id === "notepad") {
    const normalize = (s: string) => s.replace(/\r\n|\r/g, "\n");
    const firstType = calls.findIndex((c) => c.name === "computer_type");
    const newTab = calls.findIndex(
      (c) =>
        !c.result?.error &&
        ((c.name === "computer_press" &&
          ["t", "n"].includes(c.args.key) &&
          c.args.modifiers?.some((m: string) =>
            ["control", "command"].includes(m),
          )) ||
          (c.name === "computer_click" &&
            /^Untitled(?: - Notepad)?$/.test(c.result?.title ?? ""))),
    );
    checks.push({
      name: "Fresh tab before typing",
      passed: newTab >= 0 && firstType > newTab,
    });
    checks.push({
      name: "Exact document readback",
      passed: nodes.some(
        (n: any) =>
          normalize(n.text)
            .replace(/^Text editor\n/, "")
            .replace(/\n$/, "") === normalize(entry.expected.text),
      ),
    });
    checks.push({
      name: "Beginning visited and document scrolled",
      passed:
        successful("computer_press").some(
          (c) => c.args.key === "home" && c.args.modifiers?.length,
        ) && !!successful("computer_scroll").length,
    });
    checks.push({
      name: "Ending independently visible",
      passed: nodes.some((n: any) =>
        (n.visible_text ?? "").includes(entry.expected.ending),
      ),
    });
    checks.push({
      name: "Input confined to Notepad",
      passed: input
        .filter((c) => c.result?.input_sent)
        .every((c) => /Notepad/.test(c.result?.title ?? "")),
    });
  } else if (entry.id === "edge-google") {
    const edgeTitle = (title: string) =>
      /Microsoft\s+Edge/i.test(
        title.replace(/[\u200b-\u200f\u2060\ufeff]/g, ""),
      );
    const matchesQuery = (value: unknown) =>
      value === entry.expected.query || value === `"${entry.expected.query}"`;
    const homepage = calls.findIndex(
      (c) =>
        c.name === "computer_type" &&
        !c.result?.error &&
        /^https?:\/\/(?:www\.)?google\.com\/?$/i.test(
          c.args.text?.trim() ?? "",
        ),
    );
    const queryInput = calls.findIndex(
      (c, i) =>
        i > homepage &&
        c.name === "computer_type" &&
        !c.result?.error &&
        matchesQuery(c.args.text),
    );
    const enterBetween = (from: number, to: number) =>
      calls
        .slice(from + 1, to)
        .some(
          (c) =>
            c.name === "computer_press" &&
            !c.result?.error &&
            ["enter", "return"].includes(c.args.key),
        );
    const newTab = calls.findIndex(
      (c) =>
        !c.result?.error &&
        ((c.name === "computer_press" &&
          ["t", "n"].includes(c.args.key) &&
          c.args.modifiers?.includes("control")) ||
          (c.name === "computer_click" &&
            /New tab/i.test(c.result?.title ?? ""))),
    );
    const searchUrls = nodes
      .filter(
        (n: any) =>
          n.role === "ControlType.Edit" &&
          /^Address and search bar\n/.test(n.text ?? ""),
      )
      .flatMap((n: any) => (n.text ?? "").split(/\s+/))
      .filter((part: string) => {
        try {
          const url = new URL(
            /^https?:\/\//i.test(part) ? part : `https://${part}`,
          );
          return (
            ["google.com", "www.google.com"].includes(url.hostname) &&
            url.pathname === "/search" &&
            matchesQuery(url.searchParams.get("q"))
          );
        } catch {
          return false;
        }
      });
    const allowed = new Set([
      "desktop_status",
      "activate_plugin",
      "read_skill",
      "computer_list_apps",
      "computer_open",
      "computer_observe",
      "computer_click",
      "computer_type",
      "computer_press",
      "computer_scroll",
      "create_artifact",
    ]);
    checks.push(
      {
        name: "Fresh Edge tab before navigation",
        passed: newTab >= 0 && homepage > newTab,
      },
      {
        name: "Google homepage then exact query submitted",
        passed:
          homepage >= 0 &&
          queryInput > homepage &&
          enterBetween(homepage, queryInput) &&
          enterBetween(queryInput, calls.length),
      },
      {
        name: "Independent Edge Google results URL matches query",
        passed: edgeTitle(observed?.title ?? "") && searchUrls.length > 0,
        details: {
          query: entry.expected.query,
          urls: searchUrls.map((url: string) => {
            const parsed = new URL(
              /^https?:\/\//i.test(url) ? url : `https://${url}`,
            );
            return `${parsed.origin}${parsed.pathname}?q=${encodeURIComponent(parsed.searchParams.get("q") ?? "")}`;
          }),
        },
      },
      {
        name: "Input confined to Microsoft Edge",
        passed: input
          .filter((c) => c.result?.input_sent)
          .every((c) => edgeTitle(c.result?.title ?? "")),
      },
      {
        name: "Computer use only",
        passed: calls.every(
          (c) =>
            allowed.has(c.name) &&
            (c.name !== "activate_plugin" || c.args.code === "computer"),
        ),
      },
      {
        name: "Final answer names the actual search",
        passed: evidence.final
          .toLowerCase()
          .includes(entry.expected.query.toLowerCase()),
      },
    );
  } else {
    checks.push({
      name: "Correct conversation observed",
      passed:
        /ChatGPT|Codex/.test(observed?.title ?? "") &&
        text.includes(entry.expected.title),
    });
    checks.push({
      name: "Summary document delivered",
      passed: evidence.artifacts.some((a) => a.kind === "document"),
    });
    checks.push({
      name: "Conversation reading and navigation evidenced",
      passed:
        !!successful("computer_scroll").length &&
        successful("computer_observe").some((c) =>
          c.result?.attachments?.some((a: any) => a.kind === "screenshot"),
        ),
    });
  }
  return checks;
}
