import { Fragment, type ReactNode } from "react";

/** Returns how to open an artifact Orca linked as `artifact:<id>`, or null if it is not available here. */
export type ArtifactLink = (id: string) => (() => void) | null;

// Minimal, safe Markdown for agent output: builds React elements, never HTML.
// Supports paragraphs, line breaks, headings, nested -/* and 1. lists, > quotes,
// ``` code blocks, --- dividers, | tables |, **bold**, *italic*, ~~strike~~,
// `code`, http(s) [links](url), bare http(s) URLs, and [links](artifact:<id>)
// to artifacts in the same work. Other link targets render as plain text.
const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const artifactTarget = new RegExp(`^artifact:(?://)?(${uuid})$`, "i");
function inline(
  text: string,
  key: string,
  artifact?: ArtifactLink,
): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern =
    /(\*\*([^*]+)\*\*|~~([^~]+)~~|`([^`]+)`|\[([^\]]+)\]\(([^\s)]+)\)|(https?:\/\/[^\s<>()]*[^\s<>().,;:!?'"])|(^|[^*])\*([^*\s][^*]*)\*)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = pattern.exec(text))) {
    let start = match.index;
    if (match[8] !== undefined) start += match[8].length;
    if (start > last) out.push(text.slice(last, start));
    const k = `${key}-${i++}`;
    if (match[2] !== undefined)
      out.push(<strong key={k}>{inline(match[2], k, artifact)}</strong>);
    else if (match[3] !== undefined)
      out.push(<del key={k}>{inline(match[3], k, artifact)}</del>);
    else if (match[4] !== undefined) out.push(<code key={k}>{match[4]}</code>);
    else if (match[5] !== undefined) {
      const label = inline(match[5], k, artifact);
      const id = match[6].match(artifactTarget)?.[1];
      const open = id ? artifact?.(id.toLowerCase()) : null;
      if (/^https?:\/\//.test(match[6]))
        out.push(
          <a key={k} href={match[6]} target="_blank" rel="noreferrer">
            {label}
          </a>,
        );
      else if (open)
        out.push(
          <button
            key={k}
            type="button"
            className="artifact-link"
            onClick={open}
          >
            {label}
          </button>,
        );
      else out.push(<Fragment key={k}>{label}</Fragment>);
    } else if (match[7] !== undefined)
      out.push(
        <a key={k} href={match[7]} target="_blank" rel="noreferrer">
          {match[7]}
        </a>,
      );
    else out.push(<em key={k}>{inline(match[9], k, artifact)}</em>);
    last = pattern.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
function lines(text: string, key: string, artifact?: ArtifactLink) {
  return text.split("\n").map((line, index, all) => (
    <Fragment key={`${key}-${index}`}>
      {inline(line, `${key}-${index}`, artifact)}
      {index < all.length - 1 && <br />}
    </Fragment>
  ));
}

type Item = { text: string; children: List | null };
type List = { type: "ul" | "ol"; start: number; items: Item[] };
type Block =
  | { type: "p"; text: string }
  | { type: "h"; level: number; text: string }
  | { type: "hr" }
  | { type: "code"; text: string }
  | { type: "quote"; text: string }
  | { type: "table"; align: string[]; head: string[]; rows: string[][] }
  | List;
const bullet = /^(\s*)[-*•]\s+(.*)$/;
const numbered = /^(\s*)(\d+)[.)]\s+(.*)$/;
const heading = /^(#{1,6})\s+(.*)$/;
const rule = /^\s*([-*_])(\s*\1){2,}\s*$/;
const fence = /^\s*(```|~~~)/;
const quote = /^\s*>\s?/;
const tableDivider = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const cells = (row: string) =>
  row
    .trim()
    .replace(/^\|/, "")
    .replace(/(?<!\\)\|$/, "")
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim().replace(/\\\|/g, "|"));
const isTable = (rows: string[], at: number) =>
  rows[at]?.includes("|") &&
  tableDivider.test(rows[at + 1] ?? "") &&
  rows[at + 1].includes("-") &&
  rows[at + 1].includes("|");
const listItem = (row: string) => {
  const b = row.match(bullet);
  if (b && !rule.test(row))
    return { indent: b[1].length, type: "ul" as const, start: 1, text: b[2] };
  const n = row.match(numbered);
  if (n)
    return {
      indent: n[1].length,
      type: "ol" as const,
      start: Number(n[2]),
      text: n[3],
    };
  return null;
};
const startsBlock = (rows: string[], at: number) =>
  !rows[at].trim() ||
  heading.test(rows[at]) ||
  rule.test(rows[at]) ||
  fence.test(rows[at]) ||
  quote.test(rows[at]) ||
  !!listItem(rows[at]) ||
  isTable(rows, at);

/** Builds a list from consecutive items; deeper-indented items nest under the previous one. */
function list(rows: string[], at: number): [List, number] {
  const first = listItem(rows[at])!;
  const result: List = { type: first.type, start: first.start, items: [] };
  let i = at;
  while (i < rows.length) {
    const item = listItem(rows[i]);
    if (!item) {
      // An indented line continues the previous item.
      const last = result.items.at(-1);
      if (
        last &&
        rows[i].trim() &&
        /^\s{2,}/.test(rows[i]) &&
        !startsBlock(rows, i)
      ) {
        last.text += `\n${rows[i].trim()}`;
        i++;
        continue;
      }
      break;
    }
    if (item.indent > first.indent && result.items.length) {
      const [child, next] = list(rows, i);
      result.items.at(-1)!.children = child;
      i = next;
      continue;
    }
    if (item.indent < first.indent || item.type !== first.type) break;
    result.items.push({ text: item.text, children: null });
    i++;
  }
  return [result, i];
}

export function blocks(text: string): Block[] {
  const rows = text.replace(/\r\n/g, "\n").trim().split("\n");
  const result: Block[] = [];
  let i = 0;
  while (i < rows.length) {
    const row = rows[i];
    if (!row.trim()) {
      i++;
    } else if (fence.test(row)) {
      const marker = row.match(fence)![1];
      const body: string[] = [];
      i++;
      while (i < rows.length && !rows[i].trim().startsWith(marker))
        body.push(rows[i++]);
      i++;
      result.push({ type: "code", text: body.join("\n") });
    } else if (heading.test(row)) {
      const [, marks, title] = row.match(heading)!;
      result.push({
        type: "h",
        level: marks.length,
        text: title.replace(/\s#+\s*$/, ""),
      });
      i++;
    } else if (rule.test(row)) {
      result.push({ type: "hr" });
      i++;
    } else if (quote.test(row)) {
      const body: string[] = [];
      while (i < rows.length && quote.test(rows[i]))
        body.push(rows[i++].replace(quote, ""));
      result.push({ type: "quote", text: body.join("\n") });
    } else if (isTable(rows, i)) {
      const head = cells(row);
      const align = cells(rows[i + 1]).map((cell) =>
        cell.endsWith(":") ? (cell.startsWith(":") ? "center" : "right") : "",
      );
      const body: string[][] = [];
      i += 2;
      while (i < rows.length && rows[i].includes("|") && rows[i].trim())
        body.push(cells(rows[i++]));
      result.push({ type: "table", align, head, rows: body });
    } else if (listItem(row)) {
      const [value, next] = list(rows, i);
      result.push(value);
      i = next;
    } else {
      const body: string[] = [row];
      i++;
      while (i < rows.length && !startsBlock(rows, i)) body.push(rows[i++]);
      result.push({ type: "p", text: body.join("\n") });
    }
  }
  return result;
}

function renderList(
  value: List,
  key: string,
  artifact?: ArtifactLink,
): ReactNode {
  const items = value.items.map((item, r) => (
    <li key={r}>
      {lines(item.text, `${key}-${r}`, artifact)}
      {item.children && renderList(item.children, `${key}-${r}-l`, artifact)}
    </li>
  ));
  return value.type === "ol" ? (
    <ol key={key} start={value.start !== 1 ? value.start : undefined}>
      {items}
    </ol>
  ) : (
    <ul key={key}>{items}</ul>
  );
}

function render(
  text: string,
  prefix: string,
  artifact?: ArtifactLink,
): ReactNode[] {
  return blocks(text).map((block, b) => {
    const key = `${prefix}${b}`;
    switch (block.type) {
      case "h": {
        const Heading = (["h3", "h4", "h5"] as const)[
          Math.min(block.level, 3) - 1
        ];
        return <Heading key={key}>{inline(block.text, key, artifact)}</Heading>;
      }
      case "hr":
        return <hr key={key} />;
      case "code":
        return (
          <pre key={key}>
            <code>{block.text}</code>
          </pre>
        );
      case "quote":
        return (
          <blockquote key={key}>
            {render(block.text, `${key}-`, artifact)}
          </blockquote>
        );
      case "table":
        return (
          <div key={key} className="markdown-table">
            <table>
              <thead>
                <tr>
                  {block.head.map((cell, c) => (
                    <th
                      key={c}
                      style={
                        block.align[c]
                          ? { textAlign: block.align[c] as "left" }
                          : undefined
                      }
                    >
                      {inline(cell, `${key}-h${c}`, artifact)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, r) => (
                  <tr key={r}>
                    {block.head.map((_, c) => (
                      <td
                        key={c}
                        style={
                          block.align[c]
                            ? { textAlign: block.align[c] as "left" }
                            : undefined
                        }
                      >
                        {inline(row[c] ?? "", `${key}-${r}-${c}`, artifact)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      case "p":
        return <p key={key}>{lines(block.text, key, artifact)}</p>;
      default:
        return renderList(block, key, artifact);
    }
  });
}

export default function Markdown({
  text,
  artifact,
}: {
  text: string;
  /** Lets `artifact:<id>` links open artifacts from the same work. */
  artifact?: ArtifactLink;
}) {
  return <div className="markdown">{render(text, "", artifact)}</div>;
}
