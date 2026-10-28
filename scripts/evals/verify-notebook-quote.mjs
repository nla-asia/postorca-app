/** Independent verifier for browser-notebook-quote.
 * The fixture's observe hook must save its actual submission event as
 * evidence/fixture-observe.json: { quote: { quantity, subtotal, shipping, total } }.
 * This script reads evidence; it never opens the page or submits the form.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
const folder = process.argv[2];
if (!folder) throw new Error("Expected absolute attempt folder");
const read = async (path) =>
  JSON.parse(await readFile(join(folder, path), "utf8"));
const observed = await read("evidence/fixture-observe.json");
const evidence = await read("evidence.json");
const quote = observed.quote;
const expected = { quantity: 3, subtotal: 58.5, shipping: 4.25, total: 62.75 };
const checks = Object.entries(expected).map(([key, value]) => ({
  id: `quote-${key}`,
  verdict: quote?.[key] === value ? "passed" : "failed",
  reason: `Independent fixture event: expected ${key}=${value}; observed ${JSON.stringify(quote?.[key])}`,
  evidence: ["evidence/fixture-observe.json"],
}));
const documents = evidence.task.turns
  .flatMap((t) => t.artifacts ?? [])
  .filter((a) => a.kind === "document");
checks.push({
  id: "quote-document",
  verdict: documents.some(
    (a) =>
      /58\.50?/.test(a.content) &&
      /4\.25/.test(a.content) &&
      /62\.75/.test(a.content),
  )
    ? "passed"
    : "failed",
  reason:
    "A delivered document must contain the actual subtotal, shipping and total.",
  evidence: ["evidence.json#/task/turns"],
});
console.log(JSON.stringify({ checks }));
