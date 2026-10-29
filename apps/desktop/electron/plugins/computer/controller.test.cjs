const { test } = require("node:test");
const assert = require("node:assert/strict");
const { ComputerController, captureBounds } = require("./controller.cjs");

function fixture() {
  let time = 1000;
  const sent = [],
    window = {
      id: "7",
      pid: 55,
      title: "Probe",
      bounds: { x: -100, y: 10, width: 400, height: 300 },
    };
  const native = async ({ action, expected_pid }) => {
    if (expected_pid) assert.equal(expected_pid, 55);
    if (action === "list")
      return { apps: [{ id: "a1", name: "Probe", windows: [window] }] };
    if (action === "accessibility") return { nodes: [{ text: "hello" }] };
    return { window, foreground: true };
  };
  const bitmap = { width: 800, height: 600, image: Buffer.from("stable") };
  const clipboard = {
    read: () => "original",
    writeText: (s) => {
      clipboard.text = s;
    },
    readText: () => clipboard.text,
    restore: (s) => {
      clipboard.text = s;
    },
  };
  const robot = {
    getDisplays: () => [{ x: -500, y: 0, width: 1500, height: 900 }],
    screen: { capture: () => bitmap },
    moveMouse: (...a) => sent.push(["move", ...a]),
    mouseClick: (...a) => sent.push(["click", ...a]),
    keyTap: (...a) => sent.push(["key", ...a]),
    scrollMouse: (...a) => sent.push(["scroll", ...a]),
  };
  let loads = 0;
  const controller = new ComputerController({
    native,
    loadRobot: () => {
      loads++;
      return robot;
    },
    encode: () => Buffer.from("png"),
    clipboard,
    now: () => time,
  });
  const context = {
    taskId: "task",
    turnId: "turn",
    upload: async () => "image.png",
  };
  const ready = async () => {
    await controller.session(true, context);
    await controller.run("computer_list_apps", {}, context);
    return controller.run("computer_observe", { window: "7" }, context);
  };
  return {
    controller,
    context,
    ready,
    sent,
    window,
    clipboard,
    robot,
    loads: () => loads,
    tick: () => {
      time += 121000;
    },
  };
}

test("computer input is lazy, activation gated, exclusive and released by owner only", async () => {
  const f = fixture();
  assert.equal(f.loads(), 0);
  await assert.rejects(
    f.controller.run("computer_list_apps", {}, f.context),
    /inactive/,
  );
  await f.ready();
  assert.equal(f.loads(), 1);
  const other = { ...f.context, turnId: "other" };
  await assert.rejects(f.controller.session(true, other), /Another agent/);
  await f.controller.session(false, other);
  assert.equal(f.controller.status().active, true);
  await f.controller.session(false, f.context);
  await assert.rejects(
    f.controller.run("computer_list_apps", {}, f.context),
    /inactive/,
  );
});
test("click maps screenshot pixels to desktop coordinates and consumes its observation", async () => {
  const f = fixture(),
    shot = await f.ready();
  assert.match(shot.observation, /^o\d+_[a-f0-9]{6}$/);
  const args = { window: "7", observation: shot.observation, x: 200, y: 100 };
  const result = await f.controller.run("computer_click", args, f.context);
  assert.deepEqual(f.sent, [
    ["move", 0, 60],
    ["click", "left", false],
  ]);
  assert.notEqual(result.observation, shot.observation);
  await assert.rejects(
    f.controller.run("computer_click", args, f.context),
    /Stale/,
  );
});
test("moved windows, off-image points, unknown targets and expired leases send no input", async () => {
  const f = fixture(),
    shot = await f.ready();
  const args = { window: "7", observation: shot.observation, x: 5, y: 5 };
  f.window.bounds.x += 1;
  await assert.rejects(
    f.controller.run("computer_click", args, f.context),
    /moved/,
  );
  f.window.bounds.x -= 1;
  await assert.rejects(
    f.controller.run("computer_click", { ...args, x: 800 }, f.context),
    /outside/,
  );
  await assert.rejects(
    f.controller.run("computer_observe", { window: "invented" }, f.context),
    /Unknown window/,
  );
  f.tick();
  await assert.rejects(
    f.controller.run("computer_click", args, f.context),
    /inactive/,
  );
  assert.deepEqual(f.sent, []);
});
test("Unicode paste preserves the clipboard and does not submit", async () => {
  const f = fixture(),
    shot = await f.ready();
  await f.controller.run(
    "computer_type",
    { window: "7", observation: shot.observation, text: "Hello สวัสดี 👋" },
    f.context,
  );
  assert.deepEqual(f.sent, [
    ["key", "v", process.platform === "darwin" ? "command" : "control"],
  ]);
  assert.equal(f.clipboard.text, "original");
});
test("aborted queued input cannot execute after the preceding action", async () => {
  const f = fixture(),
    shot = await f.ready();
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(
    f.controller.run(
      "computer_click",
      { window: "7", observation: shot.observation, x: 3, y: 3 },
      { ...f.context, signal: abort.signal },
    ),
  );
  assert.deepEqual(f.sent, []);
});
test("bottom scrolling is bounded and does not assert completeness", async () => {
  const f = fixture(),
    shot = await f.ready();
  const result = await f.controller.run(
    "computer_scroll",
    {
      window: "7",
      observation: shot.observation,
      x: 20,
      y: 20,
      mode: "bottom",
      max_steps: 8,
    },
    f.context,
  );
  assert.equal(result.steps, 4);
  assert.equal(result.stop_reason, "unchanged_images");
  assert.equal(result.bottom_verified, false);
});
test("a lost post-input screenshot reports uncertainty and invalidates the old observation", async () => {
  const f = fixture(),
    shot = await f.ready();
  f.controller.capture = async () => {
    throw new Error("capture failed");
  };
  const args = { window: "7", observation: shot.observation, key: "enter" };
  await assert.rejects(
    f.controller.run("computer_press", args, f.context),
    /Input was sent; its outcome needs inspection/,
  );
  assert.equal(f.sent.length, 1);
  await assert.rejects(
    f.controller.run("computer_press", args, f.context),
    /Stale/,
  );
});
test("spanning windows capture only the largest visible display intersection", () => {
  assert.deepEqual(
    captureBounds({ x: -100, y: -10, width: 500, height: 300 }, [
      { x: 0, y: 0, width: 1920, height: 1080 },
    ]),
    { x: 0, y: 0, width: 400, height: 290 },
  );
});

test("opening a hosted Windows app returns its matching window, not sibling apps", async () => {
  const f = fixture();
  const calculator = {
    id: "start:calculator",
    name: "Calculator",
    windows: [],
  };
  const window = {
    id: "calc",
    title: "Calculator",
    pid: 123,
    bounds: { x: 0, y: 0, width: 400, height: 600 },
  };
  let opened = false;
  f.controller.native = async ({ action }) => {
    if (action === "open") {
      opened = true;
      return { requested: true };
    }
    return {
      apps: opened
        ? [
            {
              id: "host",
              name: "ApplicationFrameHost",
              windows: [
                window,
                { ...window, id: "settings", title: "Settings" },
              ],
            },
          ]
        : [calculator],
    };
  };
  await f.controller.session(true, f.context);
  await f.controller.run("computer_list_apps", {}, f.context);
  const result = await f.controller.run(
    "computer_open",
    { app_id: calculator.id },
    f.context,
  );
  assert.equal(result.note, undefined);
  assert.deepEqual(
    result.apps.flatMap((a) => a.windows.map((w) => w.id)),
    ["calc"],
  );
});

test("opening an already running app focuses its window without launching another instance", async () => {
  const f = fixture();
  await f.ready();
  const native = f.controller.native,
    actions = [];
  f.controller.native = async (request, signal) => {
    actions.push(request.action);
    return native(request, signal);
  };
  const result = await f.controller.run(
    "computer_open",
    { app_id: "a1" },
    f.context,
  );
  assert.equal(result.apps[0].windows[0].id, "7");
  assert.deepEqual(actions, ["focus"]);
});

test("a sheet in front of the selected window is named and can be observed and clicked", async () => {
  const f = fixture();
  await f.ready();
  const sheet = {
    id: "8",
    pid: 55,
    title: "Untitled",
    bounds: { x: 0, y: 40, width: 200, height: 150 },
  };
  const original = f.controller.native;
  f.controller.native = async (request) => {
    if (request.action !== "focus") return original(request);
    assert.equal(request.expected_pid, 55);
    return request.window === "8"
      ? { window: sheet, foreground: true }
      : { window: f.window, foreground: false, front: sheet };
  };
  await assert.rejects(
    f.controller.run("computer_observe", { window: "7" }, f.context),
    /Window 8 \("Untitled"\) of this app is in front.*Observe window 8/,
  );
  // The sheet is usable without listing apps again.
  const shot = await f.controller.run(
    "computer_observe",
    { window: "8" },
    f.context,
  );
  assert.deepEqual(shot.capture_bounds, sheet.bounds);
  await f.controller.run(
    "computer_click",
    { window: "8", observation: shot.observation, x: 400, y: 300 },
    f.context,
  );
  assert.deepEqual(f.sent, [
    ["move", 100, 115],
    ["click", "left", false],
  ]);
});
test("a covering window of another process is not offered as a target", async () => {
  const f = fixture();
  await f.ready();
  f.controller.native = async () => ({
    window: f.window,
    foreground: false,
    front: { id: "9", pid: 99, title: "Other", bounds: f.window.bounds },
  });
  await assert.rejects(
    f.controller.run("computer_observe", { window: "7" }, f.context),
    /could not be focused/,
  );
  assert.equal(f.controller.windows.has("9"), false);
});
test(
  "Windows foreground lock gets one Alt activation retry, but modal windows do not",
  { skip: process.platform !== "win32" },
  async () => {
    const f = fixture();
    await f.ready();
    let attempts = 0;
    f.controller.native = async () => ({
      window: f.window,
      foreground: ++attempts > 1,
      focus_details: { enabled: true, popup: "7" },
    });
    await f.controller.run("computer_observe", { window: "7" }, f.context);
    assert.equal(attempts, 2);
    assert.deepEqual(f.sent, [["key", "alt"]]);
    const blocked = fixture();
    await blocked.ready();
    blocked.controller.native = async () => ({
      window: blocked.window,
      foreground: false,
      focus_details: { enabled: false, popup: "modal" },
    });
    await assert.rejects(
      blocked.controller.run(
        "computer_observe",
        { window: "7" },
        blocked.context,
      ),
      /could not be focused/,
    );
    assert.deepEqual(blocked.sent, []);
  },
);

test(
  "Mac menu clicks require an observed enabled app path and pass the selected PID",
  { skip: process.platform !== "darwin" },
  async () => {
    const f = fixture();
    const original = f.controller.native;
    const requests = [];
    f.controller.native = async (request) => {
      if (request.action === "accessibility")
        return {
          nodes: [],
          menus: [
            { path: ["File", "Record Screen"], enabled: true },
            { path: ["File", "Stop Recording"], enabled: false },
          ],
        };
      if (request.action === "menu") {
        requests.push(request);
        return { input_sent: true, window_closed: false, menus: [] };
      }
      return original(request);
    };
    await f.ready();
    const shot = await f.controller.run(
      "computer_observe",
      { window: "7", accessibility: true },
      f.context,
    );
    const result = await f.controller.run(
      "computer_click",
      {
        window: "7",
        observation: shot.observation,
        menu_path: ["File", "Record Screen"],
      },
      f.context,
    );
    assert.equal(result.input_sent, true);
    assert.equal(result.needs_observation, true);
    assert.equal(result.observation, undefined);
    assert.deepEqual(requests, [
      {
        action: "menu",
        window: "7",
        expected_pid: 55,
        menu_path: ["File", "Record Screen"],
      },
    ]);
    assert.deepEqual(f.sent, []);
    await assert.rejects(
      f.controller.run(
        "computer_click",
        {
          window: "7",
          observation: shot.observation,
          menu_path: ["File", "Record Screen"],
        },
        f.context,
      ),
      /Stale/,
    );
  },
);

test(
  "Mac menu clicks reject unobserved, disabled and mixed coordinate paths without input",
  { skip: process.platform !== "darwin" },
  async () => {
    for (const args of [
      { menu_path: ["File", "Stop Recording"] },
      { menu_path: ["Apple", "Restart"] },
      { menu_path: ["File", "Record Screen"], x: 1, y: 1 },
    ]) {
      const f = fixture();
      const original = f.controller.native;
      let menuCalls = 0;
      f.controller.native = async (request) => {
        if (request.action === "accessibility")
          return {
            nodes: [],
            menus: [
              { path: ["File", "Record Screen"], enabled: true },
              { path: ["File", "Stop Recording"], enabled: false },
            ],
          };
        if (request.action === "menu") menuCalls++;
        return original(request);
      };
      await f.ready();
      const shot = await f.controller.run(
        "computer_observe",
        { window: "7", accessibility: true },
        f.context,
      );
      await assert.rejects(
        f.controller.run(
          "computer_click",
          { window: "7", observation: shot.observation, ...args },
          f.context,
        ),
        /menu path|menu_path/,
      );
      assert.equal(menuCalls, 0);
      assert.deepEqual(f.sent, []);
    }
  },
);

test(
  "Simulator short text uses hardware keys without touching the shared clipboard",
  { skip: process.platform !== "darwin" },
  async () => {
    const f = fixture();
    const original = f.controller.native;
    f.controller.native = async (request) =>
      request.action === "list"
        ? {
            apps: [
              {
                id: "/Applications/Xcode.app/Contents/Developer/Applications/Simulator.app",
                name: "Simulator",
                windows: [f.window],
              },
            ],
          }
        : original(request);
    for (const method of ["read", "writeText", "readText", "restore"])
      f.clipboard[method] = () => {
        throw new Error("Simulator must not use clipboard for short text");
      };
    const shot = await f.ready();
    const result = await f.controller.run(
      "computer_type",
      { window: "7", observation: shot.observation, text: "Bangkok, Thailand" },
      f.context,
    );
    assert.equal(result.text_input, "hardware_keys");
    assert.equal(result.input_sent, true);
    assert.deepEqual(
      f.sent.map(([kind, key, mods]) => [kind, key, mods]),
      [..."Bangkok, Thailand"].map((c) => [
        "key",
        c === " " ? "space" : c.toLowerCase(),
        /[A-Z]/.test(c) ? ["shift"] : [],
      ]),
    );
  },
);

test("observation waits validate their bound and cancellation prevents later focus", async () => {
  const f = fixture();
  await f.ready();
  await assert.rejects(
    f.controller.run(
      "computer_observe",
      { window: "7", wait_ms: 10001 },
      f.context,
    ),
    /0–10000/,
  );
  const abort = new AbortController();
  let focus = 0;
  const original = f.controller.native;
  f.controller.native = async (request) => {
    if (request.action === "focus") focus++;
    return original(request);
  };
  const pending = f.controller.run(
    "computer_observe",
    { window: "7", wait_ms: 1000 },
    { ...f.context, signal: abort.signal },
  );
  setTimeout(() => abort.abort(), 10);
  await assert.rejects(pending, /abort/i);
  assert.equal(focus, 0);
});

test("a missing macOS permission asks macOS to prompt and grants no control", async () => {
  const asked = [];
  const permissions = { accessibility: false, screen: false };
  const controller = new ComputerController({
    native: async () => ({}),
    loadRobot: () => ({
      getAccessibilityPermission: () => permissions.accessibility,
      getScreenCapturePermission: () => permissions.screen,
    }),
    encode: () => Buffer.from("png"),
    clipboard: {},
    requestAccess: {
      accessibility: () => asked.push("accessibility"),
      screen: () => asked.push("screen"),
    },
  });
  const context = { taskId: "task", turnId: "turn" };
  await assert.rejects(
    controller.session(true, context),
    /Grant Accessibility permission .*prompt/,
  );
  permissions.accessibility = true;
  await assert.rejects(
    controller.session(true, context),
    /Grant Screen Recording permission .*prompt/,
  );
  assert.deepEqual(asked, ["accessibility", "screen"]);
  assert.equal(controller.lease, null);
  permissions.screen = true;
  assert.deepEqual(await controller.session(true, context), {
    active: true,
    platform: process.platform,
  });
});
