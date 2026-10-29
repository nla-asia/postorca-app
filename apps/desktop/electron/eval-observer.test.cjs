const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join, resolve, dirname } = require("node:path");
const { pathToFileURL } = require("node:url");
const moduleUrl = pathToFileURL(
  resolve(__dirname, "../../../scripts/evals/observe-computer.mjs"),
).href;
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB9sAAAAASUVORK5CYII=",
  "base64",
);
async function context(t) {
  const dir = await fs.mkdtemp(join(tmpdir(), "postorca-native-observer-"));
  t.after(async () => {
    assert.equal(dirname(resolve(dir)), resolve(tmpdir()));
    await fs.rm(dir, { recursive: true, force: true });
  });
  await fs.writeFile(
    join(dir, "evidence.json"),
    JSON.stringify({
      task: { turns: [{ status: "completed" }] },
      calls: [
        { name: "computer_observe", failed: false, result: { window: "123" } },
      ],
    }),
  );
  return dir;
}
function reader(overrides = {}) {
  const calls = [];
  return {
    calls,
    read: async (op, args) => {
      calls.push({ op, args });
      if (op in overrides)
        return typeof overrides[op] === "function"
          ? overrides[op](args)
          : overrides[op];
      switch (op) {
        case "control":
          return { available: true, active: false, platform: "win32" };
        case "window":
          return {
            window: {
              id: "123",
              pid: 42,
              title: "Calculator",
              bounds: { x: 0, y: 0, width: 100, height: 100 },
            },
          };
        case "list":
          return {
            apps: [
              { id: "/x/Calculator.app", path: "/x/Calculator.app", name: "Calculator", windows: [{ id: "123" }] },
              { id: "/x/Other.app", path: "/x/Other.app", name: "Other", windows: [{ id: "9" }] },
            ],
          };
        case "accessibility":
          return { nodes: [{ text: "Display is 907" }], truncated: false };
        case "capture":
          return { png_base64: png.toString("base64") };
        default:
          throw new Error("Unexpected observer action");
      }
    },
  };
}
test("native observer reads the real window/result without task input or answer synthesis", async (t) => {
  const dir = await context(t),
    { observeComputer } = await import(moduleUrl),
    r = reader();
  const out = await observeComputer(dir, r.read);
  assert.deepEqual(
    r.calls.map((c) => c.op),
    ["control", "window", "list", "accessibility", "capture", "control"],
  );
  // The owning app comes from the native app list, matched by window id.
  assert.deepEqual(out.computer_evidence.observed.app, {
    id: "/x/Calculator.app",
    path: "/x/Calculator.app",
    name: "Calculator",
  });
  assert.equal(
    r.calls.find((c) => c.op === "accessibility").args.expected_pid,
    42,
  );
  assert.equal(out.computer_evidence.controlReleased, true);
  assert.equal(
    out.computer_evidence.observed.accessibility.nodes[0].text,
    "Display is 907",
  );
  assert.deepEqual(
    await fs.readFile(join(dir, "evidence/computer-observer.png")),
    png,
  );
});
test("native observer preserves an incorrect displayed answer and never fabricates release", async (t) => {
  const dir = await context(t),
    { observeComputer } = await import(moduleUrl),
    r = reader({
      control: { available: true, active: true, platform: "win32" },
      accessibility: { nodes: [{ text: "Display is 999" }], truncated: false },
    });
  const out = await observeComputer(dir, r.read);
  assert.equal(
    out.computer_evidence.observed.accessibility.nodes[0].text,
    "Display is 999",
  );
  assert.equal(out.computer_evidence.controlReleased, false);
});
test("native observer rejects missing identity, truncated evidence and an unfinished task", async (t) => {
  const dir = await context(t),
    { observeComputer } = await import(moduleUrl);
  await assert.rejects(
    observeComputer(
      dir,
      reader({ window: { window: { id: "different", pid: 42 } } }).read,
    ),
    /identity/,
  );
  await assert.rejects(
    observeComputer(
      dir,
      reader({ accessibility: { nodes: [], truncated: true } }).read,
    ),
    /truncated/,
  );
  await fs.writeFile(
    join(dir, "evidence.json"),
    JSON.stringify({ task: { turns: [{ status: "running" }] }, calls: [] }),
  );
  await assert.rejects(observeComputer(dir, reader().read), /settled/);
});
test("inspector adapter refuses remote endpoints and unsupported operations", async () => {
  const { inspectorRead } = await import(moduleUrl);
  await assert.rejects(
    inspectorRead("/desktop", "https://example.com", "control"),
    /loopback/,
  );
  await assert.rejects(
    inspectorRead("/desktop", "http://127.0.0.1:9232", "computer_click"),
    /Unsupported/,
  );
});
