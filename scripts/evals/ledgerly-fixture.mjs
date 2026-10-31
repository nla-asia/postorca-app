/** Ledgerly fixture for the product introduction evals: a small invoicing SaaS in a git
 * repository at ~/PostOrca Evals/ledgerly, with four weeks of commit history.
 *
 * Far from a todo list: sign in, a dashboard with a revenue chart, invoices with line
 * items and live totals, status changes from draft to paid, printing, a status filter
 * and an "Add client" modal. Demoing it means dropdowns, dynamic form rows, a date
 * field, modals and a sign-in that doesn't carry across tabs. notes/pilot.md holds
 * pilot feedback, background a product introduction should leave out.
 * Add that folder to the founder's Brand Profile projects once; prepare rebuilds it.
 *
 *   node ledgerly-fixture.mjs prepare <attempt>  rebuild the repo, start the app on :4130
 *   node ledgerly-fixture.mjs observe <attempt>  report whether the agent changed the repo
 *   node ledgerly-fixture.mjs cleanup <attempt>  stop the app this attempt started
 *   node ledgerly-fixture.mjs serve <nonce>      (internal) the app's static server
 */
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const folder = join(homedir(), "PostOrca Evals", "ledgerly");
const port = 4130;
const base = `http://127.0.0.1:${port}`;
const marker = ".postorca-eval-fixture";
const [mode, arg] = process.argv.slice(2);

const readme = `# Ledgerly

Invoicing for freelancers and small studios: send an invoice in a minute and see who owes you what.

Open http://127.0.0.1:${port} while the dev server runs. Open /?reset to restore the sample data.

Local demo login: demo@ledgerly.test / ledgerly-demo
`;
const pilotNotes = `# Pilot notes

- 4 freelancers and 2 small studios in the pilot.
- New invoice is the most used screen; most invoices have 2-4 line items.
- 3 of 6 asked to see who hasn't paid at a glance.
`;
const centNotes = `${pilotNotes}- One studio's invoice total was off by a cent (3 x $33.35). Totals now add up in whole cents.
`;
const allNotes = `${centNotes}- Added overdue: a sent invoice past its due date shows as Overdue, on the dashboard too.
`;

const style = String.raw`:root {
  --ink: #141a2b; --soft: #5f6b80; --line: #e4e8f0; --page: #f5f7fb; --card: #fff;
  --accent: #4f46e5; --accent-soft: #eef0ff; --side: #111827;
  --draft: #6b7280; --sent: #2563eb; --paid: #15803d; --overdue: #dc2626;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--page); color: var(--ink); font: 16px/1.45 -apple-system, "Segoe UI", system-ui, sans-serif; }
#app { min-height: 100vh; }
.shell { display: grid; grid-template-columns: 232px 1fr; min-height: 100vh; }
aside { background: var(--side); color: #cbd2e1; padding: 28px 18px; display: flex; flex-direction: column; gap: 4px; }
.logo { color: #fff; font-size: 22px; font-weight: 700; letter-spacing: -0.02em; margin: 0 10px 26px; }
.logo span { color: #a5b4fc; }
aside a { color: inherit; text-decoration: none; padding: 9px 12px; border-radius: 9px; font-weight: 500; }
aside a.on { background: #1f2937; color: #fff; }
aside .out { margin-top: auto; font-size: 14px; color: #8b95a8; }
main { padding: 36px 44px; max-width: 1180px; width: 100%; }
.head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px; gap: 16px; }
h1 { font-size: 28px; letter-spacing: -0.02em; margin: 0; }
button, .btn { font: inherit; font-weight: 600; border-radius: 9px; padding: 9px 16px; border: 1px solid var(--line); background: var(--card); color: var(--ink); cursor: pointer; }
button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
button.link { border: 0; background: none; color: var(--accent); padding: 6px 0; }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 22px; }
.kpis { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 20px; }
.kpi .label { color: var(--soft); font-size: 14px; font-weight: 600; }
.kpi .value { font-size: 30px; font-weight: 700; letter-spacing: -0.02em; margin-top: 6px; }
.kpi .sub { color: var(--soft); font-size: 14px; }
.kpi.alert .value { color: var(--overdue); }
.grid2 { display: grid; grid-template-columns: 3fr 2fr; gap: 16px; }
h2 { font-size: 16px; margin: 0 0 16px; }
table { width: 100%; border-collapse: collapse; }
th { text-align: left; font-size: 13px; color: var(--soft); text-transform: uppercase; letter-spacing: .05em; padding: 0 12px 10px; }
td { padding: 13px 12px; border-top: 1px solid var(--line); white-space: nowrap; }
tr.row { cursor: pointer; } tr.row:hover td { background: #fafbff; }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
.badge { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 13px; font-weight: 600; text-transform: capitalize; }
.badge.draft { background: #f1f2f4; color: var(--draft); } .badge.sent { background: #e8f0fe; color: var(--sent); }
.badge.paid { background: #e5f6ea; color: var(--paid); } .badge.overdue { background: #fdecec; color: var(--overdue); }
.tabs { display: flex; gap: 6px; margin-bottom: 16px; }
.tabs button { border-radius: 999px; padding: 6px 14px; font-weight: 500; color: var(--soft); }
.tabs button.on { background: var(--accent-soft); border-color: var(--accent-soft); color: var(--accent); font-weight: 600; }
.tabs .count { margin-left: 6px; opacity: .7; }
.chart svg { width: 100%; height: auto; }
.chart .bar { fill: #c7cbfb; } .chart .bar.now { fill: var(--accent); }
.chart text { font-size: 13px; fill: var(--soft); }
form.invoice label, .modal label { display: block; font-size: 14px; font-weight: 600; color: var(--soft); margin-bottom: 6px; }
input, select, textarea { font: inherit; border: 1px solid var(--line); border-radius: 9px; padding: 9px 11px; background: #fff; color: var(--ink); width: 100%; }
input:focus, select:focus, textarea:focus { outline: 2px solid var(--accent-soft); border-color: var(--accent); }
.fields { display: grid; grid-template-columns: 2fr 1fr 1fr; gap: 16px; margin-bottom: 22px; }
.lines td { border: 0; padding: 6px 6px 6px 0; vertical-align: middle; }
.lines input.qty { width: 80px; } .lines input.rate { width: 120px; }
.lines .amount { width: 120px; text-align: right; font-weight: 600; font-variant-numeric: tabular-nums; }
.lines .remove { border: 0; background: none; color: var(--soft); font-size: 20px; padding: 4px 8px; }
.totals { margin-left: auto; width: 300px; margin-top: 18px; }
.totals div { display: flex; justify-content: space-between; padding: 6px 0; }
.totals .grand { font-size: 22px; font-weight: 700; border-top: 1px solid var(--line); padding-top: 12px; margin-top: 4px; }
.actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 24px; }
.doc { max-width: 820px; }
.doc .top { display: flex; justify-content: space-between; margin-bottom: 28px; }
.doc .muted { color: var(--soft); font-size: 14px; }
.doc .big { font-size: 26px; font-weight: 700; }
.paidnote { color: var(--paid); font-weight: 600; }
#toast { position: fixed; right: 28px; bottom: 28px; background: var(--side); color: #fff; padding: 13px 18px; border-radius: 11px; font-weight: 600; box-shadow: 0 10px 30px rgba(17,24,39,.25); animation: up .25s ease-out; }
@keyframes up { from { transform: translateY(12px); opacity: 0; } }
.overlay { position: fixed; inset: 0; background: rgba(17,24,39,.45); display: grid; place-items: center; animation: fade .15s ease-out; }
@keyframes fade { from { opacity: 0; } }
.modal { background: #fff; border-radius: 16px; padding: 26px; width: 420px; display: grid; gap: 14px; }
.login { min-height: 100vh; display: grid; place-items: center; }
.login .card { width: 380px; display: grid; gap: 14px; }
.login .error { color: var(--overdue); font-size: 14px; }
@media print { aside, .head button, .actions, .no-print { display: none !important; } .shell { display: block; } main { padding: 0; } .card { border: 0; } }
`;

// One app, grown commit by commit. Each module is a script; the last one calls render().
const core = (f) => String.raw`const KEY = "ledgerly-" + window.LEDGERLY_BUILD;
if (location.search === "?reset") { localStorage.removeItem(KEY); sessionStorage.clear(); history.replaceState(null, "", "/"); }
const pad = (n) => String(n).padStart(2, "0");
const dayOf = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const plusDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return dayOf(d); };
const money = (n) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const fmtDay = (day) => new Date(day + "T12:00").toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" });
const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids.flat().filter((k) => k != null && k !== false)); return n; };

function seed() {
  const clients = [
    { id: "c1", name: "Northwind Coffee", email: "ops@northwind.coffee" },
    { id: "c2", name: "Brightside Dental", email: "office@brightsidedental.com" },
    { id: "c3", name: "Atlas Logistics", email: "ap@atlaslogistics.io" },
    { id: "c4", name: "Juniper Studio", email: "hello@juniper.studio" },
    { id: "c5", name: "Pine & Co", email: "accounts@pineandco.com" },
  ];
  const plan = [
    ["c1", -170, "paid", [["Brand refresh: logo and colours", 1, 2400]]],
    ["c3", -150, "paid", [["Dispatch dashboard design", 1, 3200], ["Design system handoff", 4, 150]]],
    ["c2", -128, "paid", [["Website copy", 6, 120], ["Booking page", 1, 900]]],
    ["c4", -110, "paid", [["Monthly retainer", 1, 1800]]],
    ["c1", -95, "paid", [["Menu photography", 1, 1150], ["Retouching", 12, 25]]],
    ["c5", -72, "paid", [["Shopify theme updates", 14, 95]]],
    ["c4", -60, "paid", [["Monthly retainer", 1, 1800]]],
    ["c3", -41, "paid", [["Driver app onboarding screens", 1, 2650]]],
    ["c4", -30, "paid", [["Monthly retainer", 1, 1800], ["Extra revision round", 3, 140]]],
    ["c2", -26, "sent", [["Patient newsletter template", 1, 750]]],
    ["c5", -9, "sent", [["Product launch landing page", 1, 2200], ["Copy edits", 5, 80]]],
    ["c1", -2, "draft", [["Spring campaign posters", 3, 420]]],
  ];
  const invoices = plan.map(([client, issued, status, lines], i) => ({
    id: "i" + (i + 1), number: "INV-" + String(i + 1).padStart(4, "0"), client, issued: plusDays(issued),
    due: plusDays(issued + 14), status, paid: status === "paid" ? plusDays(issued + 9) : null,
    lines: lines.map(([description, qty, rate]) => ({ description, qty, rate })),
  }));
  return { clients, invoices };
}
let db = JSON.parse(localStorage.getItem(KEY) || "null") || seed();
const save = () => localStorage.setItem(KEY, JSON.stringify(db));
const lineAmount = (l) => (Number(l.qty) || 0) * (Number(l.rate) || 0);
` + (f.cents
  ? String.raw`// Whole cents, so three lines of $33.35 add up to $100.05, not $100.04.
const total = (inv) => inv.lines.reduce((sum, l) => sum + Math.round(lineAmount(l) * 100), 0) / 100;
`
  : String.raw`const total = (inv) => inv.lines.reduce((sum, l) => sum + lineAmount(l), 0);
`) + String.raw`const clientOf = (id) => db.clients.find((c) => c.id === id);
` + (f.overdue
  ? String.raw`const statusOf = (inv) => inv.status === "sent" && inv.due < plusDays(0) ? "overdue" : inv.status;
`
  : String.raw`const statusOf = (inv) => inv.status;
`) + String.raw`const badge = (inv) => el("span", { className: "badge " + statusOf(inv), textContent: statusOf(inv) });
function toast(text) {
  document.getElementById("toast")?.remove();
  const t = el("div", { id: "toast", textContent: text });
  document.body.append(t);
  setTimeout(() => t.remove(), 2600);
}
const routes = {};
const pages = [];
function layout(page, title, actions, ...content) {
  const nav = pages.map(([key, label]) => el("a", { href: "#/" + key, className: key === page ? "on" : "", textContent: label }));
  return el("div", { className: "shell" },
    el("aside", {}, el("p", { className: "logo", innerHTML: "Ledger<span>ly</span>" }), nav` + (f.login
  ? String.raw`,
      el("a", { className: "out", href: "#/", textContent: "Sign out", onclick: () => sessionStorage.removeItem("ledgerly-session") })`
  : "") + String.raw`),
    el("main", {}, el("div", { className: "head" }, el("h1", { textContent: title }), actions), content));
}
function render() {
  const [, page, id] = (location.hash || "#/").split("/");
` + (f.login
  ? String.raw`  if (!sessionStorage.getItem("ledgerly-session")) return document.getElementById("app").replaceChildren(routes.login());
`
  : "") + String.raw`  const show = routes[page] || routes[pages[0][0]];
  document.getElementById("app").replaceChildren(show(id));
  window.scrollTo(0, 0);
}
window.addEventListener("hashchange", render);
`;

const invoices = (f) => String.raw`pages.push(["invoices", "Invoices"]);
let filter = "all";
routes.invoices = () => {
  const all = [...db.invoices].sort((a, b) => b.issued.localeCompare(a.issued));
` + (f.filter
  ? String.raw`  const kinds = ["all", "draft", "sent", ` + (f.overdue ? `"overdue", ` : "") + String.raw`"paid"];
  const tabs = el("div", { className: "tabs" }, kinds.map((k) => el("button", {
    className: k === filter ? "on" : "", onclick: () => { filter = k; render(); },
  }, k === "all" ? "All" : k[0].toUpperCase() + k.slice(1), el("span", { className: "count", textContent: String(all.filter((i) => k === "all" || statusOf(i) === k).length) }))));
  const shown = all.filter((i) => filter === "all" || statusOf(i) === filter);
`
  : String.raw`  const tabs = null;
  const shown = all;
`) + String.raw`  const rows = shown.map((inv) => el("tr", { className: "row", onclick: () => (location.hash = "#/invoice/" + inv.id) },
    el("td", { textContent: inv.number }), el("td", { textContent: clientOf(inv.client).name }),
    el("td", { textContent: fmtDay(inv.issued) }), el("td", { textContent: fmtDay(inv.due) }),
    el("td", { className: "num", textContent: money(total(inv)) }), el("td", {}, badge(inv))));
  const add = typeof routes["new"] === "function" ? el("button", { className: "primary", textContent: "New invoice", onclick: () => (location.hash = "#/new") }) : null;
  return layout("invoices", "Invoices", add, tabs, el("div", { className: "card" }, el("table", {},
    el("tr", {}, ["Number", "Client", "Issued", "Due"].map((h) => el("th", { textContent: h })), el("th", { className: "num", textContent: "Amount" }), el("th", { textContent: "Status" })),
    rows)));
};
`;

const clients = (f) => String.raw`pages.push(["clients", "Clients"]);
function addClient(name, email) {
  const c = { id: "c" + Date.now(), name: name.trim(), email: email.trim() };
  db.clients.push(c); save();
  return c;
}
` + (f.modal
  ? String.raw`function clientModal() {
  const name = el("input", { placeholder: "Company or person", ariaLabel: "Client name" });
  const email = el("input", { type: "email", placeholder: "billing@example.com", ariaLabel: "Billing email" });
  const close = () => overlay.remove();
  const overlay = el("div", { className: "overlay", onclick: (e) => e.target === overlay && close() },
    el("form", { className: "modal", onsubmit: (e) => {
      e.preventDefault();
      if (!name.value.trim()) return name.focus();
      const c = addClient(name.value, email.value);
      close(); render(); toast(c.name + " added");
    } }, el("h2", { textContent: "Add client" }), el("label", { textContent: "Name" }), name, el("label", { textContent: "Billing email" }), email,
      el("div", { className: "actions" }, el("button", { type: "button", textContent: "Cancel", onclick: close }), el("button", { className: "primary", textContent: "Add client" }))));
  document.body.append(overlay);
  name.focus();
}
`
  : "") + String.raw`routes.clients = () => {
  const rows = db.clients.map((c) => {
    const theirs = db.invoices.filter((i) => i.client === c.id);
    const owed = theirs.filter((i) => statusOf(i) !== "paid" && statusOf(i) !== "draft").reduce((s, i) => s + total(i), 0);
    return el("tr", {}, el("td", { textContent: c.name }), el("td", { textContent: c.email }),
      el("td", { className: "num", textContent: String(theirs.length) }), el("td", { className: "num", textContent: money(owed) }));
  });
` + (f.modal
  ? String.raw`  const add = el("button", { className: "primary", textContent: "Add client", onclick: clientModal });
  const inline = null;
`
  : String.raw`  const add = null;
  const name = el("input", { placeholder: "Client name", ariaLabel: "Client name" });
  const email = el("input", { placeholder: "Billing email", ariaLabel: "Billing email" });
  const inline = el("form", { className: "card fields", onsubmit: (e) => { e.preventDefault(); if (name.value.trim()) { addClient(name.value, email.value); render(); } } },
    name, email, el("button", { className: "primary", textContent: "Add" }));
`) + String.raw`  return layout("clients", "Clients", add, inline, el("div", { className: "card" }, el("table", {},
    el("tr", {}, el("th", { textContent: "Name" }), el("th", { textContent: "Email" }), el("th", { className: "num", textContent: "Invoices" }), el("th", { className: "num", textContent: "Outstanding" })),
    rows)));
};
`;

const invoiceForm = String.raw`routes.new = () => {
  const draft = { client: "", issued: plusDays(0), due: plusDays(14), lines: [{ description: "", qty: 1, rate: "" }] };
  const client = el("select", { ariaLabel: "Client" }, el("option", { value: "", textContent: "Choose a client" }),
    db.clients.map((c) => el("option", { value: c.id, textContent: c.name })));
  client.onchange = () => (draft.client = client.value);
  const issued = el("input", { type: "date", value: draft.issued, ariaLabel: "Issue date", onchange: () => (draft.issued = issued.value) });
  const due = el("input", { type: "date", value: draft.due, ariaLabel: "Due date", onchange: () => (draft.due = due.value) });
  const body = el("tbody");
  const subtotal = el("span"), grand = el("span");
  const refresh = () => { const t = money(total(draft)); subtotal.textContent = t; grand.textContent = t; };
  function lineRow(line) {
    const amount = el("td", { className: "amount", textContent: money(lineAmount(line)) });
    const update = () => { amount.textContent = money(lineAmount(line)); refresh(); };
    const description = el("input", { value: line.description, placeholder: "What you did", ariaLabel: "Line description", oninput: () => (line.description = description.value) });
    const qty = el("input", { className: "qty", type: "number", min: "0", step: "any", value: line.qty, ariaLabel: "Quantity", oninput: () => { line.qty = qty.value; update(); } });
    const rate = el("input", { className: "rate", type: "number", min: "0", step: "any", value: line.rate, placeholder: "0.00", ariaLabel: "Rate", oninput: () => { line.rate = rate.value; update(); } });
    const row = el("tr", {}, el("td", {}, description), el("td", {}, qty), el("td", {}, rate), amount,
      el("td", {}, el("button", { type: "button", className: "remove", ariaLabel: "Remove line", textContent: "×", onclick: () => {
        if (draft.lines.length === 1) return;
        draft.lines.splice(draft.lines.indexOf(line), 1); row.remove(); refresh();
      } })));
    return row;
  }
  body.append(...draft.lines.map(lineRow));
  refresh();
  const addLine = el("button", { type: "button", className: "link", textContent: "+ Add line", onclick: () => {
    const line = { description: "", qty: 1, rate: "" };
    draft.lines.push(line); const row = lineRow(line); body.append(row); row.querySelector("input").focus();
  } });
  const form = el("form", { className: "invoice card", onsubmit: (e) => {
    e.preventDefault();
    const lines = draft.lines.filter((l) => l.description.trim() && lineAmount(l) > 0);
    if (!draft.client) return client.focus();
    if (!lines.length) return body.querySelector("input").focus();
    const inv = { id: "i" + Date.now(), number: "INV-" + String(db.invoices.length + 1).padStart(4, "0"), client: draft.client,
      issued: draft.issued, due: draft.due, status: "draft", paid: null,
      lines: lines.map((l) => ({ description: l.description.trim(), qty: Number(l.qty), rate: Number(l.rate) })) };
    db.invoices.push(inv); save();
    location.hash = "#/invoice/" + inv.id;
    toast(inv.number + " saved as a draft");
  } },
    el("div", { className: "fields" }, el("div", {}, el("label", { textContent: "Client" }), client),
      el("div", {}, el("label", { textContent: "Issue date" }), issued), el("div", {}, el("label", { textContent: "Due date" }), due)),
    el("table", { className: "lines" }, el("thead", {}, el("tr", {}, el("th", { textContent: "Description" }), el("th", { textContent: "Qty" }),
      el("th", { textContent: "Rate" }), el("th", { className: "num", textContent: "Amount" }), el("th"))), body),
    addLine,
    el("div", { className: "totals" }, el("div", {}, el("span", { textContent: "Subtotal" }), subtotal), el("div", { className: "grand" }, el("span", { textContent: "Total" }), grand)),
    el("div", { className: "actions" }, el("button", { type: "button", textContent: "Cancel", onclick: () => history.back() }), el("button", { className: "primary", textContent: "Save draft" })));
  return layout("invoices", "New invoice", null, form);
};
`;

const invoiceView = (f) => String.raw`routes.invoice = (id) => {
  const inv = db.invoices.find((i) => i.id === id);
  if (!inv) return routes.invoices();
  const c = clientOf(inv.client);
  const set = (status, message) => { inv.status = status; if (status === "paid") inv.paid = plusDays(0); save(); render(); toast(message); };
  const status = statusOf(inv);
  const actions = el("div", { className: "no-print", style: "display:flex;gap:10px" },
` + (f.print ? String.raw`    el("button", { textContent: "Print / PDF", onclick: () => window.print() }),
` : "") + String.raw`    status === "draft" ? el("button", { className: "primary", textContent: "Mark as sent", onclick: () => set("sent", inv.number + " marked as sent") }) : null,
    status === "sent" || status === "overdue" ? el("button", { className: "primary", textContent: "Record payment", onclick: () => set("paid", "Payment recorded for " + inv.number) }) : null);
  const lines = inv.lines.map((l) => el("tr", {}, el("td", { textContent: l.description }), el("td", { className: "num", textContent: String(l.qty) }),
    el("td", { className: "num", textContent: money(l.rate) }), el("td", { className: "num", textContent: money(lineAmount(l)) })));
  return layout("invoices", inv.number, actions, el("div", { className: "card doc" },
    el("div", { className: "top" },
      el("div", {}, el("div", { className: "muted", textContent: "Billed to" }), el("div", { className: "big", textContent: c.name }), el("div", { className: "muted", textContent: c.email })),
      el("div", { style: "text-align:right" }, badge(inv), el("div", { className: "muted", textContent: "Issued " + fmtDay(inv.issued) }),
        el("div", { className: "muted", textContent: "Due " + fmtDay(inv.due) }),
        inv.paid ? el("div", { className: "paidnote", textContent: "Paid " + fmtDay(inv.paid) }) : null)),
    el("table", {}, el("tr", {}, el("th", { textContent: "Description" }), el("th", { className: "num", textContent: "Qty" }), el("th", { className: "num", textContent: "Rate" }), el("th", { className: "num", textContent: "Amount" })), lines),
    el("div", { className: "totals" }, el("div", { className: "grand" }, el("span", { textContent: "Total" }), el("span", { textContent: money(total(inv)) })))));
};
`;

const login = String.raw`routes.login = () => {
  const email = el("input", { type: "email", placeholder: "you@studio.com", ariaLabel: "Email", autocomplete: "username" });
  const password = el("input", { type: "password", ariaLabel: "Password", autocomplete: "current-password" });
  const error = el("div", { className: "error" });
  return el("div", { className: "login" }, el("form", { className: "card", onsubmit: (e) => {
    e.preventDefault();
    if (email.value.trim().toLowerCase() !== "demo@ledgerly.test" || password.value !== "ledgerly-demo") return (error.textContent = "Email or password is incorrect.");
    sessionStorage.setItem("ledgerly-session", "demo");
    location.hash = "#/" + pages[0][0];
    render();
  } }, el("p", { className: "logo", style: "color:var(--ink)", innerHTML: "Ledger<span style='color:var(--accent)'>ly</span>" }),
    el("h1", { textContent: "Sign in" }), el("label", { textContent: "Email" }), email, el("label", { textContent: "Password" }), password, error,
    el("button", { className: "primary", textContent: "Sign in" })));
};
`;

const dashboard = (f) => String.raw`pages.unshift(["dashboard", "Dashboard"]);
routes.dashboard = () => {
  const open = db.invoices.filter((i) => statusOf(i) === "sent" || statusOf(i) === "overdue");
  const paid30 = db.invoices.filter((i) => i.paid && i.paid >= plusDays(-30));
  const drafts = db.invoices.filter((i) => statusOf(i) === "draft");
  const kpi = (label, value, sub, cls = "") => el("div", { className: "card kpi " + cls }, el("div", { className: "label", textContent: label }), el("div", { className: "value", textContent: value }), el("div", { className: "sub", textContent: sub }));
` + (f.overdue
  ? String.raw`  const late = db.invoices.filter((i) => statusOf(i) === "overdue");
  const third = kpi("Overdue", money(late.reduce((s, i) => s + total(i), 0)), late.length + " invoice" + (late.length === 1 ? "" : "s") + " past due", late.length ? "alert" : "");
`
  : String.raw`  const third = kpi("Drafts", String(drafts.length), "not sent yet");
`) + String.raw`  const kpis = el("div", { className: "kpis" },
    kpi("Outstanding", money(open.reduce((s, i) => s + total(i), 0)), open.length + (open.length === 1 ? " invoice waiting" : " invoices waiting")),
    kpi("Paid, last 30 days", money(paid30.reduce((s, i) => s + total(i), 0)), paid30.length + (paid30.length === 1 ? " payment" : " payments")), third);
  const recent = [...db.invoices].sort((a, b) => b.issued.localeCompare(a.issued)).slice(0, 5).map((inv) =>
    el("tr", { className: "row", onclick: () => (location.hash = "#/invoice/" + inv.id) }, el("td", { textContent: clientOf(inv.client).name }),
      el("td", { className: "num", textContent: money(total(inv)) }), el("td", {}, badge(inv))));
  const table = el("div", { className: "card" }, el("h2", { textContent: "Recent invoices" }), el("table", {}, recent));
` + (f.chart
  ? String.raw`  // Paid revenue for the last six months, this month highlighted.
  const months = [...Array(6)].map((_, k) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 5 + k); return d; });
  const sums = months.map((m) => db.invoices.filter((i) => i.paid && i.paid.slice(0, 7) === dayOf(m).slice(0, 7)).reduce((s, i) => s + total(i), 0));
  const max = Math.max(...sums, 1), w = 420, h = 220, bw = 46;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 " + w + " " + h);
  svg.innerHTML = sums.map((s, k) => {
    const x = 20 + k * 66, bh = Math.round((s / max) * 150), y = 180 - bh;
    const label = months[k].toLocaleDateString("en", { month: "short" });
    return "<rect class='bar" + (k === 5 ? " now" : "") + "' x='" + x + "' y='" + y + "' width='" + bw + "' height='" + bh + "' rx='6'><title>" + label + ": " + money(s) + "</title></rect>" +
      "<text x='" + (x + bw / 2) + "' y='" + (y - 8) + "' text-anchor='middle'>" + (s ? "$" + (s / 1000).toFixed(1) + "k" : "") + "</text>" +
      "<text x='" + (x + bw / 2) + "' y='204' text-anchor='middle'>" + label + "</text>";
  }).join("");
  const chart = el("div", { className: "card chart" }, el("h2", { textContent: "Revenue by month" }), svg);
  const body = el("div", { className: "grid2" }, chart, table);
`
  : String.raw`  const body = table;
`) + String.raw`  const add = typeof routes["new"] === "function" ? el("button", { className: "primary", textContent: "New invoice", onclick: () => (location.hash = "#/new") }) : null;
  return layout("dashboard", "Dashboard", add, kpis, body);
};
`;

const index = (modules) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Ledgerly</title><link rel="stylesheet" href="style.css"></head>
<body><div id="app"></div>
<script src="build.js"></script>
${modules.map((m) => `<script src="${m}.js"></script>`).join("\n")}
<script>render();</script>
</body></html>
`;

const files = (f, modules) => ({
  "index.html": index(modules),
  "core.js": core(f),
  "invoices.js": invoices(f),
  "clients.js": clients(f),
  ...(modules.includes("invoice-form") ? { "invoice-form.js": invoiceForm } : {}),
  ...(modules.includes("invoice-view") ? { "invoice-view.js": invoiceView(f) } : {}),
  ...(modules.includes("login") ? { "login.js": login } : {}),
  ...(modules.includes("dashboard") ? { "dashboard.js": dashboard(f) } : {}),
});
const base0 = { login: false, chart: false, filter: false, modal: false, print: false, cents: false, overdue: false };
const m1 = ["core", "invoices", "clients"];
const m2 = [...m1, "invoice-form"];
const m3 = [...m2, "invoice-view"];
const m4 = [...m3, "login"];
const m5 = ["core", "dashboard", "invoices", "clients", "invoice-form", "invoice-view", "login"];
const f4 = { ...base0, login: true };
const f6 = { ...f4, chart: true };
const f7 = { ...f6, filter: true };
const f8 = { ...f7, modal: true };
const f9 = { ...f8, print: true };
const f11 = { ...f9, cents: true };
const f13 = { ...f11, overdue: true };

// Each commit: when (hours ago), message and the files it writes.
const commits = [
  [640, "Start Ledgerly: clients and invoices, stored locally", { "README.md": readme, "style.css": style, ...files(base0, m1) }],
  [580, "New invoice form with line items and live totals", files(base0, m2)],
  [520, "Invoice page: mark as sent, record payment", files(base0, m3)],
  [450, "Sign in before seeing any data", files(f4, m4)],
  [380, "Dashboard: outstanding, paid in the last 30 days, drafts", files(f4, m5)],
  [310, "Revenue by month chart on the dashboard", files(f6, m5)],
  [240, "Filter invoices by status", files(f7, m5)],
  [180, "Add a client from a modal without leaving the page", files(f8, m5)],
  [130, "Print an invoice or save it as PDF", files(f9, m5)],
  [110, "Write up pilot feedback", { "notes/pilot.md": pilotNotes }],
  [40, "Fix totals off by a cent with some quantities", { "notes/pilot.md": centNotes, ...files(f11, m5) }],
  [26, "Bump dev dependencies", { "CHANGELOG.md": "Dev dependencies bumped. Nothing user-visible.\n" }],
  [8, "Show sent invoices past their due date as overdue", { "notes/pilot.md": allNotes, ...files(f13, m5) }],
];

async function prepare(attempt) {
  if (existsSync(folder) && !existsSync(join(folder, marker)))
    throw new Error(`${folder} exists and is not this fixture; it was left unchanged.`);
  if (await fetch(base).then(() => true, () => false))
    throw new Error(`Port ${port} is already in use; no existing process was changed.`);
  await rm(folder, { recursive: true, force: true });
  await mkdir(join(folder, "notes"), { recursive: true });
  await writeFile(join(folder, marker), "Rebuilt by the PostOrca eval Ledgerly fixture.\n");
  const git = (args, env = {}) =>
    execFileSync("git", args, { cwd: folder, env: { ...process.env, ...env }, encoding: "utf8" }).trim();
  git(["init", "-q", "-b", "main"]);
  await writeFile(join(folder, ".gitignore"), `${marker}\n`);
  for (const [hours, message, written] of commits) {
    for (const [name, content] of Object.entries(written)) await writeFile(join(folder, name), content);
    const when = new Date(Date.now() - hours * 3600e3).toISOString();
    git(["add", "-A"]);
    git(["-c", "user.name=Nika", "-c", "user.email=founder@ledgerly.test", "commit", "-q", "--allow-empty", "-m", message], {
      GIT_AUTHOR_DATE: when,
      GIT_COMMITTER_DATE: when,
    });
  }
  const nonce = randomUUID();
  const server = spawn(process.execPath, [fileURLToPath(import.meta.url), "serve", nonce], {
    detached: true,
    stdio: "ignore",
  });
  server.unref();
  for (let i = 0; i < 50 && !(await owned(nonce)); i++) await new Promise((r) => setTimeout(r, 100));
  if (!(await owned(nonce))) throw new Error("The fixture app did not start.");
  await writeFile(join(attempt, "ledgerly-fixture.json"), JSON.stringify({ pid: server.pid, nonce }));
  return { folder, url: base, head: git(["rev-parse", "HEAD"]), commits: commits.length };
}
const owned = (nonce) =>
  fetch(`${base}/__fixture`).then((r) => r.text()).then((t) => t === nonce, () => false);

async function observe() {
  const git = (args) => execFileSync("git", args, { cwd: folder, encoding: "utf8" }).trim();
  return {
    head: git(["rev-parse", "HEAD"]),
    commits: Number(git(["rev-list", "--count", "HEAD"])),
    uncommitted: git(["status", "--porcelain"]),
    unchanged: Number(git(["rev-list", "--count", "HEAD"])) === commits.length && !git(["status", "--porcelain"]),
  };
}

async function cleanup(attempt) {
  const file = join(attempt, "ledgerly-fixture.json");
  if (!existsSync(file)) return { stopped: false, reason: "No server was started." };
  const { pid, nonce } = JSON.parse(await readFile(file, "utf8"));
  if (!(await owned(nonce))) return { stopped: false, reason: "The server is already gone." };
  process.kill(pid);
  return { stopped: true };
}

function serve(nonce) {
  const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
  createServer(async (req, res) => {
    const path = req.url.split("?")[0];
    if (path === "/__fixture") return res.end(nonce);
    // Each rebuild starts from the sample data, whatever the browser stored before.
    if (path === "/build.js") {
      res.writeHead(200, { "content-type": "text/javascript" });
      return res.end(`window.LEDGERLY_BUILD = ${JSON.stringify(nonce)};\n`);
    }
    const name = path === "/" ? "index.html" : path.slice(1);
    const present = await readdir(folder);
    if (!present.includes(name)) return res.writeHead(404).end();
    res.writeHead(200, { "content-type": types[extname(name)] ?? "text/plain" });
    res.end(await readFile(join(folder, name)));
  }).listen(port, "127.0.0.1");
}

if (mode === "serve") serve(arg);
else if (mode === "prepare" || mode === "observe" || mode === "cleanup") {
  const run = { prepare, observe, cleanup }[mode];
  run(arg).then(
    (result) => console.log(JSON.stringify(result)),
    (error) => {
      console.error(error.message);
      process.exit(1);
    },
  );
}
