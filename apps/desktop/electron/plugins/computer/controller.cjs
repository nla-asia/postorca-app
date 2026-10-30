const { randomBytes, createHash } = require("node:crypto");
const { setTimeout: delay } = require("node:timers/promises");

const LEASE_MS = 120_000;
const OBSERVATION_MS = 120_000;
const keys = new Set([
  "enter",
  "tab",
  "escape",
  "backspace",
  "delete",
  "home",
  "end",
  "pageup",
  "pagedown",
  "up",
  "down",
  "left",
  "right",
  ..."abcdefghijklmnopqrstuvwxyz0123456789",
]);
const modifiers = new Set(["control", "command", "alt", "shift"]);
const sameBounds = (a, b) =>
  ["x", "y", "width", "height"].every((key) => a[key] === b[key]);
// Controls worth targeting even when the helper reports no press action
// (macOS AX roles and Windows UI Automation control types).
const actionableRoles = new Set([
  "AXButton",
  "AXCheckBox",
  "AXRadioButton",
  "AXPopUpButton",
  "AXMenuButton",
  "AXMenuItem",
  "AXLink",
  "AXTextField",
  "AXTextArea",
  "AXSearchField",
  "AXComboBox",
  "AXSlider",
  "AXIncrementor",
  "AXDisclosureTriangle",
  "AXTab",
  "AXCell",
  ..."Button CheckBox RadioButton ComboBox Edit Hyperlink ListItem MenuItem TabItem TreeItem Slider SplitButton DataItem Spinner"
    .split(" ")
    .map((type) => `ControlType.${type}`),
]);

// Desktop rectangle (the window/capture coordinate space) → its visible part in
// screenshot pixels, plus the desktop centre of that visible part.
function elementRegion(rect, shot) {
  if (
    !rect ||
    ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) ||
    rect.width <= 0 ||
    rect.height <= 0
  )
    return null;
  const c = shot.bounds,
    sx = shot.width / c.width,
    sy = shot.height / c.height;
  const left = Math.max(rect.x, c.x),
    top = Math.max(rect.y, c.y),
    right = Math.min(rect.x + rect.width, c.x + c.width),
    bottom = Math.min(rect.y + rect.height, c.y + c.height);
  if (right - left < 1 || bottom - top < 1) return null;
  const x = Math.floor((left - c.x) * sx),
    y = Math.floor((top - c.y) * sy);
  return {
    bounds: {
      x,
      y,
      width: Math.ceil((right - c.x) * sx) - x,
      height: Math.ceil((bottom - c.y) * sy) - y,
    },
    center: {
      x: Math.floor((left + right) / 2),
      y: Math.floor((top + bottom) / 2),
    },
  };
}

// Rewrite helper bounds into this screenshot's pixels and index the visible
// actionable controls so a click can target one instead of guessing pixels.
function indexElements(accessibility, shot) {
  const elements = new Map();
  if (!Array.isArray(accessibility?.nodes)) return elements;
  accessibility.nodes = accessibility.nodes.map(
    ({ bounds, actionable, ...node }) => {
      const region = elementRegion(bounds, shot);
      if (!region) return node;
      if (
        (actionable || actionableRoles.has(node.role)) &&
        elements.size < 300
      ) {
        const element = elements.size + 1;
        elements.set(element, {
          center: region.center,
          role: node.role,
          text: (node.text ?? "").slice(0, 80),
        });
        return { element, ...node, bounds: region.bounds };
      }
      return { ...node, bounds: region.bounds };
    },
  );
  accessibility.bounds_space = "screenshot";
  return elements;
}

function matchingApps(apps, wanted) {
  return apps.flatMap((a) => {
    const appMatches =
      a.id === wanted.id ||
      (wanted.path && a.path?.toLowerCase() === wanted.path.toLowerCase()) ||
      a.name.toLowerCase() === wanted.name.toLowerCase();
    const windows = (a.windows ?? []).filter(
      (w) => appMatches || w.title?.toLowerCase() === wanted.name.toLowerCase(),
    );
    return windows.length ? [{ ...a, windows }] : [];
  });
}

function captureBounds(bounds, displays) {
  const visible = displays
    .map((d) => {
      const x = Math.max(bounds.x, d.x),
        y = Math.max(bounds.y, d.y);
      return {
        x: Math.ceil(x),
        y: Math.ceil(y),
        width: Math.floor(
          Math.min(bounds.x + bounds.width, d.x + d.width) - Math.ceil(x),
        ),
        height: Math.floor(
          Math.min(bounds.y + bounds.height, d.y + d.height) - Math.ceil(y),
        ),
      };
    })
    .filter((r) => r.width > 0 && r.height > 0)
    .sort((a, b) => b.width * b.height - a.width * a.height);
  if (!visible.length)
    throw new Error("The window is outside all active displays.");
  return visible[0];
}

class ComputerController {
  constructor({
    native,
    loadRobot,
    encode,
    capture,
    displays,
    clipboard,
    requestAccess = {},
    now = Date.now,
  }) {
    Object.assign(this, {
      native,
      loadRobot,
      encode,
      capture,
      displays,
      clipboard,
      requestAccess,
      now,
    });
    this.lease = null;
    this.robot = null;
    this.apps = new Map();
    this.windows = new Map();
    this.observations = new Map();
    this.queue = Promise.resolve();
    this.observationPrefix = randomBytes(3).toString("hex");
    this.observationSequence = 0;
  }
  owner(context) {
    if (!context.taskId || !context.turnId)
      throw new Error(
        "Computer Use requires a task and turn identity. Update the server and desktop together.",
      );

    return `${context.taskId}:${context.turnId}`;
  }
  reset() {
    this.lease = null;
    this.observations.clear();
    this.apps.clear();
    this.windows.clear();
  }
  status() {
    return {
      available: ["win32", "darwin"].includes(process.platform),
      active: !!this.lease && this.lease.expires > this.now(),
      platform: process.platform,
    };
  }
  check(context) {
    context.signal?.throwIfAborted();
    if (
      !this.lease ||
      this.lease.owner !== this.owner(context) ||
      this.lease.expires <= this.now()
    )
      throw new Error(
        "Computer Use is inactive for this turn. Activate the computer plugin again.",
      );
    this.lease.expires = this.now() + LEASE_MS;
  }
  async session(active, context) {
    const owner = this.owner(context);
    if (!active) {
      if (this.lease?.owner === owner) this.reset();
      return { active: false };
    }
    context.signal?.throwIfAborted();
    if (
      this.lease &&
      this.lease.expires > this.now() &&
      this.lease.owner !== owner
    )
      throw new Error("Another agent turn currently controls this desktop.");
    if (this.lease?.owner !== owner || this.lease.expires <= this.now())
      this.reset();
    this.robot ??= this.loadRobot();
    // A missing permission asks macOS to show its prompt, which also lists the app
    // in System Settings; only the founder can turn it on.
    if (this.robot.getAccessibilityPermission?.() === false) {
      this.requestAccess.accessibility?.();
      throw new Error(
        "Grant Accessibility permission to PostOrca in macOS System Settings (macOS is showing its prompt), then activate again.",
      );
    }
    if (this.robot.getScreenCapturePermission?.() === false) {
      this.requestAccess.screen?.();
      throw new Error(
        "Grant Screen Recording permission to PostOrca in macOS System Settings (macOS is showing its prompt), then activate again.",
      );
    }
    this.lease = { owner, expires: this.now() + LEASE_MS };
    return { active: true, platform: process.platform };
  }
  run(name, args, context) {
    // One input sequence at a time; a timed-out queued call must never execute later.
    const job = this.queue.then(async () => {
      this.check(context);
      return this.execute(name, args, context);
    });
    this.queue = job.catch(() => {});
    return job;
  }
  async list(context) {
    const result = await this.native({ action: "list" }, context.signal);
    this.check(context);
    this.apps = new Map(result.apps.map((a) => [a.id, a]));
    this.windows = new Map(
      result.apps.flatMap((a) =>
        (a.windows ?? []).map((w) => [w.id, { ...w, app_id: a.id }]),
      ),
    );
    return result;
  }
  async target(window, context, focus = true) {
    this.check(context);
    const known = this.windows.get(window);
    if (!known)
      throw new Error(
        "Unknown window ID. List apps and select a returned window first.",
      );
    let result = await this.native(
      { action: focus ? "focus" : "window", window, expected_pid: known.pid },
      context.signal,
    );
    this.check(context);
    if (
      focus &&
      !result.foreground &&
      process.platform === "win32" &&
      result.focus_details?.enabled &&
      result.focus_details?.popup === window
    ) {
      // Windows foreground locking can reject a background process's focus
      // request. An Alt gesture permits activation without changing OS settings.
      // Never use it to bypass a disabled window or an app's modal dialog.
      this.robot.keyTap("alt");
      await delay(30, undefined, { signal: context.signal });
      this.check(context);
      result = await this.native(
        { action: "focus", window, expected_pid: known.pid },
        context.signal,
      );
      this.check(context);
    }
    if (!result.window || (focus && !result.foreground))
      throw new Error(
        "The target window could not be focused. No task input was sent.",
      );
    return result.window;
  }
  async observe(window, accessibility, context, extra = {}) {
    const target = await this.target(window, context);
    const bounds = captureBounds(
      target.bounds,
      this.displays ? this.displays() : this.robot.getDisplays(),
    );
    const bitmap = await this.takeCapture(bounds);
    this.check(context);
    const image = this.encode(bitmap);
    const id = `o${++this.observationSequence}_${this.observationPrefix}`;
    this.observations.set(window, {
      id,
      bounds,
      windowBounds: { ...target.bounds },
      width: bitmap.width,
      height: bitmap.height,
      at: this.now(),
    });
    const result = {
      window,
      title: target.title,
      observation: id,
      width: bitmap.width,
      height: bitmap.height,
      capture_bounds: bounds,
      ...extra,
    };
    if (accessibility) {
      try {
        result.accessibility = await this.native(
          { action: "accessibility", window },
          context.signal,
        );
      } catch (error) {
        result.accessibility = { unavailable: true, reason: error.message };
      }
    }
    if (result.accessibility?.menus)
      this.observations.get(window).menus = result.accessibility.menus;
    if (result.accessibility && !result.accessibility.unavailable)
      this.observations.get(window).elements = indexElements(
        result.accessibility,
        this.observations.get(window),
      );
    this.check(context);
    const file = await context.upload(image, "image/png");
    return {
      ...result,
      attachments: [{ kind: "screenshot", file, mime_type: "image/png" }],
    };
  }
  async observed(args, context) {
    const observation = this.observations.get(args.window);
    if (
      !observation ||
      observation.id !== args.observation ||
      this.now() - observation.at > OBSERVATION_MS
    )
      throw new Error(
        "Stale screenshot. Observe this window again before sending input.",
      );
    const target = await this.target(args.window, context);
    if (!sameBounds(target.bounds, observation.windowBounds))
      throw new Error(
        "The window moved or resized. Observe it again before sending input.",
      );
    if (
      !sameBounds(
        captureBounds(
          target.bounds,
          this.displays ? this.displays() : this.robot.getDisplays(),
        ),
        observation.bounds,
      )
    )
      throw new Error("Display layout changed. Observe this window again.");
    return observation;
  }
  point(args, shot) {
    if (
      ![args.x, args.y].every(Number.isInteger) ||
      args.x < 0 ||
      args.y < 0 ||
      args.x >= shot.width ||
      args.y >= shot.height
    )
      throw new Error("Point is outside the latest screenshot.");
    return {
      x: Math.floor(shot.bounds.x + (args.x * shot.bounds.width) / shot.width),
      y: Math.floor(
        shot.bounds.y + (args.y * shot.bounds.height) / shot.height,
      ),
    };
  }
  takeCapture(bounds) {
    return this.capture
      ? this.capture(bounds)
      : this.robot.screen.capture(
          bounds.x,
          bounds.y,
          bounds.width,
          bounds.height,
        );
  }
  async execute(name, args, context) {
    if (name === "computer_list_apps") return this.list(context);
    if (name === "computer_open") {
      if (!this.apps.has(args.app_id))
        throw new Error(
          "Unknown app ID. List apps first and use a returned ID.",
        );
      const wanted = this.apps.get(args.app_id);
      const existing = matchingApps([...this.apps.values()], wanted);
      if (existing.length) {
        const windows = existing.flatMap((a) => a.windows);
        if (windows.length === 1) await this.target(windows[0].id, context);
        return {
          apps: existing,
          ...(windows.length > 1
            ? {
                note: "Several windows are already open. Select one and observe it.",
              }
            : {}),
        };
      }
      await this.native(
        { action: "open", app: this.apps.get(args.app_id) },
        context.signal,
      );
      let result;
      for (let attempt = 0; attempt < 8; attempt++) {
        this.check(context);
        result = await this.native(
          { action: "list", running_only: true },
          context.signal,
        );
        for (const a of result.apps)
          for (const w of a.windows ?? [])
            this.windows.set(w.id, { ...w, app_id: a.id });
        const found = matchingApps(result.apps, wanted);
        if (found.some((a) => a.windows?.length)) return { apps: found };
        await delay(350, undefined, { signal: context.signal });
      }
      return {
        apps: result.apps.filter((a) => a.windows?.length),
        note: "App launch requested. Select its window from these running apps; launch completion is unverified.",
      };
    }
    if (name === "computer_observe") {
      const waitMs = args.wait_ms ?? 0;
      if (!Number.isInteger(waitMs) || waitMs < 0 || waitMs > 10000)
        throw new Error("Observation wait must be 0–10000 milliseconds.");
      if (waitMs) await delay(waitMs, undefined, { signal: context.signal });
      this.check(context);
      return this.observe(args.window, args.accessibility ?? false, context);
    }
    const shot = await this.observed(args, context);
    const outcome = { action: name, input_sent: false };
    try {
      // Invalidate before the first side effect, including partial failures.
      this.observations.delete(args.window);
      if (name === "computer_click" && args.menu_path !== undefined) {
        if (process.platform !== "darwin")
          throw new Error("App menus are supported on macOS only.");
        if (
          args.x !== undefined ||
          args.y !== undefined ||
          args.element !== undefined ||
          args.button !== undefined ||
          args.clicks !== undefined
        )
          throw new Error(
            "Use a menu_path or an element/screenshot coordinates, not both.",
          );
        if (
          !Array.isArray(args.menu_path) ||
          args.menu_path.length < 2 ||
          args.menu_path.length > 4 ||
          !args.menu_path.every(
            (part) =>
              typeof part === "string" && part.length > 0 && part.length <= 200,
          ) ||
          !shot.menus?.some(
            (item) =>
              item.enabled &&
              JSON.stringify(item.path) === JSON.stringify(args.menu_path),
          )
        )
          throw new Error(
            "Unknown or disabled menu path. Observe with accessibility=true first.",
          );
        this.check(context);
        const result = await this.native(
          {
            action: "menu",
            window: args.window,
            expected_pid: this.windows.get(args.window).pid,
            menu_path: args.menu_path,
          },
          context.signal,
        );
        outcome.input_sent = result.input_sent === true;
        if (!outcome.input_sent)
          throw new Error("The menu command was not sent.");
        this.check(context);
        // Menus can create dialogs or close the app. Return fresh discovery, then let
        // the caller explicitly select and observe the resulting window.
        return {
          ...outcome,
          window: args.window,
          menu_path: args.menu_path,
          window_closed: result.window_closed,
          menus: result.menus,
          ...(await this.list(context)),
          needs_observation: true,
        };
      } else if (name === "computer_click") {
        let p;
        if (args.element !== undefined) {
          if (args.x !== undefined || args.y !== undefined)
            throw new Error(
              "Use an element or screenshot coordinates, not both.",
            );
          const element = shot.elements?.get(args.element);
          if (!Number.isInteger(args.element) || !element)
            throw new Error(
              "Unknown element. Observe with accessibility=true and use an element number from that observation.",
            );
          p = element.center;
          outcome.element = {
            element: args.element,
            role: element.role,
            text: element.text,
          };
        } else p = this.point(args, shot);
        if (
          ![undefined, "left", "right"].includes(args.button) ||
          ![undefined, 1, 2].includes(args.clicks)
        )
          throw new Error("Unsupported mouse button or click count.");
        this.check(context);
        this.robot.moveMouse(p.x, p.y);
        this.robot.mouseClick(args.button ?? "left", args.clicks === 2);
        outcome.input_sent = true;
      } else if (name === "computer_type") {
        if (
          typeof args.text !== "string" ||
          !args.text.length ||
          args.text.length > 20_000
        )
          throw new Error("Text must contain 1–20000 characters.");
        const appId = this.windows.get(args.window)?.app_id;
        if (
          process.platform === "darwin" &&
          /\/Simulator\.app$/.test(appId ?? "") &&
          /^[A-Za-z0-9 ,.-]{1,512}$/.test(args.text)
        ) {
          // Simulator asynchronously mirrors the host clipboard. Restoring it after
          // Cmd+V can paste the previous clipboard into iOS instead of this text.
          // Use the same hardware-key primitive as computer_press for short text.
          for (const [index, character] of [...args.text].entries()) {
            if (index % 8 === 0) {
              const target = await this.target(args.window, context);
              if (!sameBounds(target.bounds, shot.windowBounds))
                throw new Error(
                  "The window moved before typing. Observe it again.",
                );
            }
            this.check(context);
            outcome.input_sent = true;
            this.robot.keyTap(
              character === " " ? "space" : character.toLowerCase(),
              /[A-Z]/.test(character) ? ["shift"] : [],
            );
          }
          outcome.text_input = "hardware_keys";
        } else {
          const saved = await this.clipboard.read();
          await this.clipboard.writeText(args.text);
          try {
            // Clipboard I/O yields; focus may have changed while awaiting it.
            const target = await this.target(args.window, context);
            if (!sameBounds(target.bounds, shot.windowBounds))
              throw new Error(
                "The window moved before typing. Observe it again.",
              );
            this.check(context);
            this.robot.keyTap(
              "v",
              process.platform === "darwin" ? "command" : "control",
            );
            outcome.input_sent = true;
            await delay(250, undefined, { signal: context.signal });
          } finally {
            if ((await this.clipboard.readText()) === args.text)
              await this.clipboard.restore(saved);
          }
        }
      } else if (name === "computer_press") {
        if (
          !keys.has(args.key) ||
          !Array.isArray(args.modifiers ?? []) ||
          (args.modifiers ?? []).some((m) => !modifiers.has(m))
        )
          throw new Error("Unsupported key or modifiers.");
        this.check(context);
        this.robot.keyTap(args.key, args.modifiers ?? []);
        outcome.input_sent = true;
      } else if (name === "computer_scroll") {
        const p = this.point(args, shot);
        if (
          ![undefined, "up", "down"].includes(args.direction) ||
          ![undefined, "step", "bottom"].includes(args.mode)
        )
          throw new Error("Unsupported scroll direction or mode.");
        const limit = args.mode === "bottom" ? (args.max_steps ?? 12) : 1;
        if (!Number.isInteger(limit) || limit < 1 || limit > 20)
          throw new Error("Scroll limit must be 1–20.");
        let previous = "",
          unchanged = 0;
        outcome.stop_reason = "step_limit";
        for (let i = 0; i < limit; i++) {
          // Recheck focus/bounds between scrolls instead of continuing into another app.
          const target = await this.target(args.window, context);
          if (!sameBounds(target.bounds, shot.windowBounds))
            throw new Error(
              "Window moved during scrolling; inspect it before continuing.",
            );
          this.check(context);
          this.robot.moveMouse(p.x, p.y);
          // RobotJS uses raw wheel deltas on Windows (120 per notch), pixels on macOS.
          const amount = process.platform === "win32" ? 360 : 500;
          this.robot.scrollMouse(
            0,
            args.mode !== "bottom" && args.direction === "up"
              ? amount
              : -amount,
          );
          outcome.input_sent = true;
          outcome.steps = i + 1;
          await delay(200, undefined, { signal: context.signal });
          const b = await this.takeCapture(shot.bounds);
          const hash = createHash("sha256").update(b.image).digest("hex");
          unchanged = hash === previous ? unchanged + 1 : 0;
          previous = hash;
          if (unchanged >= 3) {
            outcome.stop_reason = "unchanged_images";
            break;
          }
        }
        outcome.bottom_verified = false;
      } else throw new Error("Unknown computer tool.");
      await delay(200, undefined, { signal: context.signal });
      return await this.observe(args.window, false, context, outcome);
    } catch (error) {
      if (outcome.input_sent)
        throw new Error(
          `Input was sent; its outcome needs inspection. Do not repeat blindly. ${error.message}`,
        );
      throw error;
    }
  }
}
module.exports = { ComputerController, captureBounds, elementRegion };
