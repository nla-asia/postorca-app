/**
 * What the agent has seen of one tab: the refs it can act on and the recent snapshots
 * that change-aware snapshots compare against. Snapshots and labeled screenshots share
 * the ref assignment, so an element keeps its ref across observations for as long as
 * it stays in the same document. A repeated snapshot returns only what changed since
 * the closest of the last few snapshots (with enough surrounding lines to place each
 * change), "no changes", or the full tree when there is no usable baseline or the
 * changes would not be shorter.
 */

/**
 * Longest text one result carries. A longer snapshot (or list of changes) is split
 * into parts at line boundaries; the result is part 1 plus how to read the others.
 */
const PART_CHARS = 20_000;
/** Sections at least this large are listed in a long snapshot's outline. */
const OUTLINE_MIN_CHARS = 1_000;
const OUTLINE_MAX_ENTRIES = 30;
/** A baseline older than this is too old to compare against: the agent has moved on. */
const BASELINE_TTL_MS = 10 * 60_000;
/**
 * Recent snapshots kept as baselines, per mode (full tree / interactive_only): the
 * two modes are different trees, so each compares only with its own, and switching
 * between them loses neither. More than one per mode, because dialogs hide the rest
 * of the page: after a dialog closes, the snapshot from before it is the close match.
 */
const BASELINES = 3;
/** Changes are worth sending only while this much shorter than the full tree. */
const MAX_CHANGES_RATIO = 0.5;
/** Larger line comparisons are not worth computing; the full tree is sent instead. */
const MAX_DIFF_CELLS = 4_000_000;
/** Removed sections with at least this many lines inside are shown as one line. */
const COLLAPSE_INSIDE = 4;
/** Removed siblings shown before the rest of the run is only counted. */
const RUN_SHOWN = 3;
const LEGEND =
  '"+ " lines were added, "- " lines removed, and "~ " lines are elements that changed or got a new ref (shown as they are now); other lines are unchanged and show where.';

class TabObservations {
  constructor(tabId) {
    this.tabId = tabId;
    this.identities = new Map(); // element identity → ref
    this.nextRef = 1; // never reused within a tab, so a stale ref cannot hit a new element
    this.refs = new Map(); // ref → {selector, backendNodeId, label}: actionable now
    this.snapshots = 0;
    this.baselines = []; // recent snapshots, newest last, BASELINES per mode: {id, lines, interactiveOnly, at}
    this.pages = null; // the latest long result, split: {observation, field, parts}
  }

  /** A new document (navigation): its elements are new and the old tree no longer applies. */
  reset() {
    this.identities.clear();
    this.refs.clear();
    this.baselines = [];
    this.pages = null;
  }

  /**
   * Renders an accessibility tree with stable refs and makes exactly its elements
   * actionable; elements no longer present lose their refs. Returns the lines and the
   * link lines (for link targets).
   */
  render(tree) {
    const refs = new Map();
    const lines = [];
    const links = [];
    const visit = (nodes, depth) => {
      for (const node of nodes) {
        let line = `${"  ".repeat(depth)}- ${node.role}`;
        if (node.name) line += ` "${clean(node.name, 300)}"`;
        if (node.locator) {
          // DOM node identity lasts as long as the element; locators can shift
          // to another element (nth=) when content is inserted above.
          const identity = node.backendNodeId ?? `locator:${node.locator}`;
          let ref = this.identities.get(identity);
          if (!ref || refs.has(ref)) {
            ref = `e${this.nextRef++}`;
            this.identities.set(identity, ref);
          }
          refs.set(ref, {
            selector: node.locator,
            backendNodeId: node.backendNodeId,
            label: `${node.role}${node.name ? ` "${clean(node.name, 80)}"` : ""}`,
          });
          line += ` [ref=${ref}]`;
          if (node.role === "link")
            links.push({ line: lines.length, selector: node.locator });
        }
        lines.push(line);
        visit(node.children ?? [], depth + 1);
      }
    };
    visit(withoutRepetition(tree), 0);
    this.refs = refs;
    return { lines, links };
  }

  /**
   * The snapshot result for freshly rendered lines: changes since the closest recent
   * snapshot of this tab, or the full tree. These lines then join the baselines.
   */
  snapshot(lines, { interactiveOnly = false, full = false, now = Date.now() } = {}) {
    const id = `${this.tabId}:${++this.snapshots}`;
    const sameMode = this.baselines.filter((b) => b.interactiveOnly === interactiveOnly);
    const otherMode = this.baselines.filter((b) => b.interactiveOnly !== interactiveOnly);
    const current = { id, lines, interactiveOnly, at: now };
    // full=true makes this tree its mode's only baseline: the agent has just seen all of it.
    this.baselines = [...otherMode, ...(full ? [] : sameMode.slice(1 - BASELINES)), current];
    const text = lines.join("\n");
    this.pages = null;
    const fullResult = (reason) => ({
      observation: id,
      full_reason: reason,
      ...this.paged(id, "snapshot", lines),
    });
    if (full) return fullResult("requested");
    if (!sameMode.length)
      return fullResult(
        interactiveOnly
          ? "first interactive_only snapshot of this page"
          : "first snapshot of this page",
      );
    const fresh = sameMode.filter((b) => now - b.at <= BASELINE_TTL_MS);
    if (!fresh.length) return fullResult("previous snapshot expired");
    let best = null;
    for (const baseline of fresh.reverse()) {
      const changes = describeChanges(baseline.lines, lines);
      if (changes !== null && (best === null || changes.length < best.changes.length))
        best = { baseline, changes };
    }
    if (best?.changes === "")
      return { observation: id, baseline: best.baseline.id, changes: `No changes since ${best.baseline.id}.` };
    if (!best || best.changes.length > MAX_CHANGES_RATIO * text.length)
      return fullResult("too many changes");
    return {
      observation: id,
      baseline: best.baseline.id,
      ...this.paged(id, "changes", `Changes since ${best.baseline.id}. ${LEGEND}\n${best.changes}`.split("\n")),
    };
  }

  /**
   * A result's text, whole when it fits; otherwise part 1, how many parts there are,
   * and (for a snapshot) an outline of the page's large sections with the parts they
   * are in. The parts are kept so later part reads show this same observation.
   */
  paged(observation, field, lines) {
    const text = lines.join("\n");
    if (text.length <= PART_CHARS) return { [field]: text };
    const parts = [];
    const partOfLine = [];
    let current = [];
    let size = 0;
    for (const line of lines) {
      if (current.length && size + line.length + 1 > PART_CHARS) {
        parts.push(current.join("\n"));
        current = [];
        size = 0;
      }
      current.push(line);
      size += line.length + 1;
      partOfLine.push(parts.length + 1);
    }
    parts.push(current.join("\n"));
    this.pages = { observation, field, parts };
    return {
      [field]: parts[0],
      part: 1,
      parts: parts.length,
      ...(field === "snapshot" ? { outline: outline(lines, partOfLine) } : {}),
      more: `Part 1 of ${parts.length}. Read any part (1 to ${parts.length}) with browser_snapshot and part=N: they are this same observation (${observation}), with the same refs.`,
    };
  }

  /** Another part of the latest long result, without reading the page again. */
  part(n) {
    if (!this.pages)
      throw new Error("The latest snapshot of this tab was not split into parts. Take a snapshot.");
    const { observation, field, parts } = this.pages;
    if (n < 1 || n > parts.length)
      throw new Error(`Observation ${observation} has parts 1 to ${parts.length}.`);
    return { observation, part: n, parts: parts.length, [field]: parts[n - 1] };
  }
}

function clean(text, max) {
  return text.replace(/\s+/g, " ").slice(0, max);
}
/**
 * The large top-level sections of a long snapshot (and the large sections directly
 * inside them), with their size and the parts they span, so the agent can go to the
 * part it needs.
 */
function outline(lines, partOfLine) {
  const depthOf = (line) => (line.length - line.trimStart().length) / 2;
  const label = (line) => clean(line.trim().replace(/^- /, "").replace(/ → .*$/, ""), 90);
  const entries = [];
  for (let i = 0; i < lines.length; i++) {
    const depth = depthOf(lines[i]);
    if (depth > 1) continue;
    let end = i + 1;
    while (end < lines.length && depthOf(lines[end]) > depth) end++;
    const size = lines.slice(i, end).reduce((sum, line) => sum + line.length + 1, 0);
    if (size < OUTLINE_MIN_CHARS) continue;
    const [first, last] = [partOfLine[i], partOfLine[end - 1]];
    entries.push(
      `${"  ".repeat(depth)}- ${label(lines[i])}: ${size.toLocaleString("en-US")} chars, ${first === last ? `part ${first}` : `parts ${first}–${last}`}`,
    );
  }
  return entries.slice(0, OUTLINE_MAX_ENTRIES).join("\n");
}

/** Lowercased words (letters and digits), for comparing what text says. */
const words = (text) => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
const normalized = (text) => words(text).join(" ");

/**
 * The tree without text that only repeats other text, which pages produce a lot of:
 * table rows named with all their cells, labels repeated by wrappers inside a button.
 * search results whose details repeat the result link's name. Elements with refs are
 * always kept with their names, and no shown text is lost:
 * - an unreferenced node's name goes when its descendants say all of it between them;
 * - an unreferenced node's name goes when an ancestor's or earlier sibling's shown
 *   name already contains it;
 * - unnamed generic wrappers are replaced by their children, and empty leaves go.
 */
function withoutRepetition(nodes, ancestors = []) {
  const result = [];
  const covering = [...ancestors];
  for (const node of nodes) {
    const children = node.children ?? [];
    let name = node.name ?? "";
    if (name && !node.locator) {
      const own = normalized(name);
      if (own && covering.some((text) => text.includes(own))) name = "";
      else if (own && aggregates(own, children)) name = "";
    }
    // Names are shown cut to 300 characters; only shown text can stand in for others.
    const shown = name ? normalized(clean(name, 300)) : "";
    const kept = withoutRepetition(children, shown ? [...ancestors, shown] : ancestors);
    if (shown) covering.push(shown);
    if (!node.locator && !name) {
      if (!kept.length) continue;
      if (node.role === "generic" || node.role === "none") {
        result.push(...kept);
        continue;
      }
    }
    result.push({ ...node, name, children: kept });
  }
  return result;
}
/** True when a name is made of its descendants' names (no single one says it all). */
function aggregates(name, children) {
  const names = [];
  const collect = (nodes) => {
    for (const node of nodes) {
      if (node.name) names.push(normalized(node.name));
      collect(node.children ?? []);
    }
  };
  collect(children);
  if (names.length < 2 || names.some((other) => other.includes(name))) return false;
  const available = new Set(names.flatMap((other) => other.split(" ")));
  return name.split(" ").every((word) => available.has(word));
}

/** Line operations turning a into b: [{op: "=" | "-" | "+", a?, b?}], or null when too large. */
function diffLines(a, b) {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const n = endA - start;
  const m = endB - start;
  if (n * m > MAX_DIFF_CELLS) return null;
  // Longest common subsequence of the differing middle, from the end.
  const width = m + 1;
  const lcs = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      lcs[i * width + j] =
        a[start + i] === b[start + j]
          ? lcs[(i + 1) * width + j + 1] + 1
          : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1]);
  const ops = [];
  for (let k = 0; k < start; k++) ops.push({ op: "=", a: k, b: k });
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[start + i] === b[start + j]) {
      ops.push({ op: "=", a: start + i++, b: start + j++ });
    } else if (j < m && (i === n || lcs[i * width + j + 1] >= lcs[(i + 1) * width + j])) {
      ops.push({ op: "+", b: start + j++ });
    } else {
      ops.push({ op: "-", a: start + i++ });
    }
  }
  for (let k = 0; endA + k < a.length; k++) ops.push({ op: "=", a: endA + k, b: endB + k });
  slideBlocks(ops, "+", "b", b);
  slideBlocks(ops, "-", "a", a);
  return ops;
}

/**
 * A block of added (or removed) lines can often sit at several equally valid places,
 * e.g. a new post above an old one with the same structure. Like git's indent
 * heuristic, move each block to where it starts at its shallowest line, so it reads
 * as whole elements instead of the tail of one and the head of the next.
 */
function slideBlocks(ops, kind, side, lines) {
  const other = side === "a" ? "b" : "a";
  const indent = (index) => lines[index].length - lines[index].trimStart().length;
  for (let s = 0; s < ops.length; s++) {
    if (ops[s].op !== kind) continue;
    let e = s;
    while (e < ops.length && ops[e].op === kind) e++;
    const p = ops[s][side];
    const k = e - s;
    // How far the block can move while the lines it passes equal those it uncovers.
    let up = 0;
    while (s - up - 1 >= 0 && ops[s - up - 1].op === "=" && lines[p - up - 1] === lines[p + k - up - 1]) up++;
    let down = 0;
    while (e + down < ops.length && ops[e + down].op === "=" && lines[p + k + down] === lines[p + down]) down++;
    let best = p;
    for (let q = p - up; q <= p + down; q++) if (indent(q) < indent(best)) best = q;
    if (best !== p) {
      // Rebuild the window: same unchanged lines (in order), block at its new place.
      const window = ops.slice(s - up, e + down);
      const others = window.filter(({ op }) => op === "=").map((op) => op[other]);
      const start = p - up;
      const rebuilt = [];
      for (let i = start; i < start + window.length; i++)
        rebuilt.push(
          i >= best && i < best + k
            ? { op: kind, [side]: i }
            : { op: "=", [side]: i, [other]: others.shift() },
        );
      ops.splice(s - up, window.length, ...rebuilt);
    }
    s = s - up + (best - (p - up)) + k - 1;
  }
}

/** Index of each line's parent (the nearest earlier line indented less), or -1. */
function parents(lines) {
  const result = [];
  const stack = []; // [indent, index]
  lines.forEach((line, index) => {
    const indent = line.length - line.trimStart().length;
    while (stack.length && stack[stack.length - 1][0] >= indent) stack.pop();
    result.push(stack.length ? stack[stack.length - 1][1] : -1);
    stack.push([indent, index]);
  });
  return result;
}

/**
 * The changed lines, each preceded by its not-yet-shown ancestors as context. "" when
 * nothing changed; null when the comparison is too large to compute.
 */
function describeChanges(before, after) {
  const ops = diffLines(before, after);
  if (!ops) return null;
  if (ops.every(({ op }) => op === "=")) return "";
  const parentBefore = parents(before);
  const parentAfter = parents(after);
  // Unchanged lines are keyed by their position in the new tree, so context shared by
  // removed and added lines is shown once.
  const newIndexOf = new Map();
  for (const { op, a, b } of ops) if (op === "=") newIndexOf.set(a, b);
  const keyBefore = (index) =>
    newIndexOf.has(index) ? `b${newIndexOf.get(index)}` : `a${index}`;
  const shown = new Set();
  const out = [];
  const showContext = (index, parentOf, lines, key) => {
    const chain = [];
    for (let p = parentOf[index]; p !== -1 && !shown.has(key(p)); p = parentOf[p])
      chain.unshift(p);
    for (const p of chain) {
      shown.add(key(p));
      // Context from the old tree is shown as it is now when the element is still there.
      const now = lines === before && newIndexOf.has(p) ? newIndexOf.get(p) : null;
      out.push(now === null ? `  ${lines[p]}` : addedLine(now) ?? `  ${after[now]}`);
    }
  };
  /** The "~" line for an added line that is a changed or rebuilt element, else null. */
  const addedLine = (b) =>
    rebuiltFrom.has(b)
      ? `~ ${after[b]} (was ${refOf(before[rebuiltFrom.get(b)])})`
      : changedRefs.has(refOf(after[b]))
        ? `~ ${after[b]}`
        : null;
  // An element (same ref) that was removed and added again changed: show it once, as now.
  const refOf = (line) => line.match(/\[ref=(e\d+)\]/)?.[1];
  const removedRefs = new Set(ops.filter(({ op }) => op === "-").map(({ a }) => refOf(before[a])).filter(Boolean));
  const changedRefs = new Set(ops.filter(({ op, b }) => op === "+" && removedRefs.has(refOf(after[b]))).map(({ b }) => refOf(after[b])));
  // Pages often rebuild unchanged elements, which then get new refs. An added line
  // equal to a removed one apart from its ref, under an equal parent, is that element:
  // show it once, with the ref it had.
  const withoutRef = (line) => line.replace(/ \[ref=e\d+\]/, "");
  const placeOf = (lines, parentOf, index) =>
    `${parentOf[index] === -1 ? "" : withoutRef(lines[parentOf[index]])}\n${withoutRef(lines[index])}`;
  const rebuiltFrom = new Map(); // added line index → removed line index
  const unmatched = new Map(); // line without ref → removed indexes
  for (const { op, a } of ops)
    if (op === "-" && refOf(before[a]) && !changedRefs.has(refOf(before[a])))
      unmatched.set(placeOf(before, parentBefore, a), [...(unmatched.get(placeOf(before, parentBefore, a)) ?? []), a]);
  for (const { op, b } of ops) {
    if (op !== "+" || !refOf(after[b]) || changedRefs.has(refOf(after[b]))) continue;
    const from = unmatched.get(placeOf(after, parentAfter, b))?.shift();
    if (from !== undefined) rebuiltFrom.set(b, from);
  }
  const rebuilt = new Set(rebuiltFrom.values());
  // Changed and rebuilt elements are shown as they are now, so removed lines inside
  // them use the current line as context.
  for (const [b, a] of rebuiltFrom) newIndexOf.set(a, b);
  const changedAt = new Map();
  for (const { op, b } of ops) if (op === "+" && changedRefs.has(refOf(after[b]))) changedAt.set(refOf(after[b]), b);
  for (const { op, a } of ops)
    if (op === "-" && changedAt.has(refOf(before[a]))) newIndexOf.set(a, changedAt.get(refOf(before[a])));
  // Removals are summarized: a removed section is its top line with a count of the
  // lines inside it, and long runs of removed siblings show the first few and a count.
  // (A dialog hides the whole page behind it; the agent needs to know that, not every
  // hidden line.) Additions are always shown in full.
  const removed = new Set();
  for (const { op, a } of ops)
    if (op === "-" && !changedRefs.has(refOf(before[a])) && !rebuilt.has(a)) removed.add(a);
  const topOf = (a) => {
    let top = a;
    while (removed.has(parentBefore[top])) top = parentBefore[top];
    return top;
  };
  const inside = new Map(); // top removed line → count of removed lines under it
  for (const a of removed) {
    const top = topOf(a);
    if (top !== a) inside.set(top, (inside.get(top) ?? 0) + 1);
  }
  // Small removed sections are shown whole, so each removed element can be identified.
  const collapsed = (top) => (inside.get(top) ?? 0) >= COLLAPSE_INSIDE;
  const firstNamed = (top) =>
    before.slice(top + 1, top + 1 + inside.get(top)).find((line) => /"/.test(line))?.trim().replace(/^- /, "");
  let run = null; // {parent, shownCount, hidden, indent}
  const counted = new Set(); // removed sections only counted in a run's "… and N more"
  const endRun = () => {
    if (run?.hidden)
      out.push(`- ${run.indent}… and ${run.hidden} more removed lines like these`);
    run = null;
  };
  for (const { op, a, b } of ops) {
    if (op === "+") {
      endRun();
      if (shown.has(`b${b}`)) continue; // already shown as context of a removed line
      showContext(b, parentAfter, after, (p) => `b${p}`);
      shown.add(`b${b}`);
      out.push(addedLine(b) ?? `+ ${after[b]}`);
    } else if (op === "-" && removed.has(a) && removed.has(parentBefore[a])) {
      if (collapsed(topOf(a)) || counted.has(topOf(a))) continue;
      showContext(a, parentBefore, before, keyBefore);
      shown.add(`a${a}`);
      out.push(`- ${before[a]}`);
    } else if (op === "-" && removed.has(a) && !removed.has(parentBefore[a])) {
      const line = before[a];
      if (run?.parent === parentBefore[a] && run.shownCount >= RUN_SHOWN) {
        run.hidden += 1 + (inside.get(a) ?? 0);
        counted.add(a);
        continue;
      }
      if (run?.parent !== parentBefore[a]) {
        endRun();
        run = { parent: parentBefore[a], shownCount: 0, hidden: 0, indent: line.slice(0, line.length - line.trimStart().length) };
      }
      run.shownCount++;
      showContext(a, parentBefore, before, keyBefore);
      shown.add(`a${a}`);
      if (!collapsed(a)) {
        out.push(`- ${line}`);
        continue;
      }
      const first = firstNamed(a);
      out.push(
        `- ${line} (and the ${inside.get(a)} lines inside it${first ? `, starting with ${clean(first, 100)}` : ""})`,
      );
    }
  }
  endRun();
  return out.join("\n");
}

/** Query parameters that only track the visitor or campaign. */
const TRACKING_PARAM = /^(utm_\w+|aid|label|sid|srpvid|fbclid|gclid|gbraid|wbraid|msclkid|mc_[ce]id|ref_?src|_ga|_gl|igshid|si)$/i;
/** Longer values are opaque blobs (session state, signed redirects), not readable data. */
const MAX_PARAM_VALUE = 40;
const MAX_TARGET = 100;

/**
 * A link's target as shown after the link (→ /path or the full URL off-site), so the
 * agent can cite and open pages without clicking through them. Tracking parameters,
 * empty values, and long opaque values are left out; the link itself can still be
 * clicked by ref.
 */
function linkTarget(href, pageUrl) {
  if (href.startsWith("javascript:") || href === "#") return null;
  let url;
  try {
    url = new URL(href, pageUrl);
  } catch {
    return null;
  }
  for (const [key, value] of [...url.searchParams])
    if (
      TRACKING_PARAM.test(key) ||
      value.length > MAX_PARAM_VALUE ||
      ["", "null", "undefined"].includes(value)
    )
      url.searchParams.delete(key);
  const target =
    url.origin === new URL(pageUrl).origin ? url.pathname + url.search + url.hash : url.href;
  return target.length > MAX_TARGET ? `${target.slice(0, MAX_TARGET)}…` : target;
}

module.exports = { TabObservations, describeChanges, linkTarget, PART_CHARS };
