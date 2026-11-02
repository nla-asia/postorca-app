/**
 * Browser tool health (level 1): every browser tool on a stable public page.
 */
import type { EvalCheck } from "./computer-eval-types.js";

export const browserToolsCase = {
  id: "tools",
  name: "Every browser tool: open, read, type, click, scroll, screenshot, fetch a file, close",
  brief:
    "This is a temporary check of the browser tools. In my browser, open https://en.wikipedia.org/wiki/Main_Page and search for Grand Palace with the page's search box. On the Grand Palace article, scroll down a little, then click the link to Bangkok. On the Bangkok article, take a screenshot of the page and save the article's main image file here. Deliver the screenshot and the image as artifacts, tell me the Bangkok article's title, and close every tab you opened. Don't sign in, edit anything or save memory.",
  criteria: [
    "The screenshot shows the Bangkok Wikipedia article, and the saved image is that article's main image (not a page screenshot or an icon).",
  ],
};

const parse = (content: any) => {
  try {
    return typeof content === "string" ? JSON.parse(content) : content;
  } catch {
    return undefined;
  }
};

export function gradeBrowserTools(evidence: {
  status: string;
  calls: any[];
  artifacts: any[];
  final: string;
}): EvalCheck[] {
  const ok = evidence.calls.filter((c) => !c.failed);
  const used = (name: string) => ok.filter((c) => c.name === name);
  const files = (name: string, mime: RegExp) =>
    new Set(
      used(name)
        .flatMap((c) => c.result?.attachments ?? [])
        .filter((a: any) => mime.test(String(a.mime_type ?? "image/")))
        .map((a: any) => a.file),
    );
  const delivered = (made: Set<string>) =>
    evidence.artifacts.some(
      (a) => a.kind === "image" && made.has(parse(a.content)?.file),
    );
  const opened = used("browser_open").map((c) => c.result?.tab);
  const closed = new Set(used("browser_close").map((c) => c.args?.tab));
  return [
    { name: "Turn completed", passed: evidence.status === "completed" },
    { name: "Opened a tab", passed: opened.length > 0 },
    { name: "Read the page", passed: used("browser_snapshot").length > 0 },
    {
      name: "Typed the search",
      passed: used("browser_type").some((c) =>
        /grand palace/i.test(c.args?.text ?? ""),
      ),
    },
    { name: "Scrolled", passed: used("browser_scroll").length > 0 },
    { name: "Clicked a link", passed: used("browser_click").length > 0 },
    {
      name: "Screenshot delivered",
      passed: delivered(files("browser_screenshot", /^image\//)),
    },
    {
      name: "Image file fetched and delivered",
      passed: delivered(files("browser_fetch_file", /^image\//)),
    },
    {
      name: "Reports the Bangkok article",
      passed: /\bBangkok\b/.test(evidence.final),
    },
    {
      name: "Closed every tab it opened",
      passed: opened.length > 0 && opened.every((tab) => closed.has(tab)),
    },
  ];
}
