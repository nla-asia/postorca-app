/** Read-only observer adapter for an already-running development desktop.
 * node observe-computer.mjs --desktop-root <apps/desktop> --inspector <loopback-url>
 *   [--preflight] <attempt-folder>
 *
 * The inspector must belong to the desktop that executes the product task.
 * The adapter reads already-loaded production modules; it never creates a new
 * controller, activates a lease, launches an app, or supplies task actions.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

export async function observeComputer(folder, read) {
  const evidence = JSON.parse(
    await readFile(join(folder, "evidence.json"), "utf8"),
  );
  if (
    !evidence.task?.turns?.length ||
    evidence.task.turns.some((t) => !["completed", "failed"].includes(t.status))
  )
    throw new Error("Independent observation requires a settled product task");
  const last = [...evidence.calls]
    .reverse()
    .find(
      (c) => c.name.startsWith("computer_") && !c.failed && c.result?.window,
    );
  const window = last?.result.window;
  if (typeof window !== "string" || !/^\d+$/.test(window))
    throw new Error("No actual agent-observed native window is available");
  const before = await read("control");
  const info = await read("window", { window });
  if (String(info.window?.id) !== window || !Number.isInteger(info.window?.pid))
    throw new Error("Independent native window identity is missing or changed");
  // The app that owns the window, from the native app list (its id and path).
  const owner = (await read("list")).apps?.find((app) =>
    (app.windows ?? []).some((w) => String(w.id) === window),
  );
  const accessibility = await read("accessibility", {
    window,
    expected_pid: info.window.pid,
  });
  if (
    !Array.isArray(accessibility.nodes) ||
    accessibility.unavailable ||
    accessibility.truncated
  )
    throw new Error(
      "Independent Accessibility readback is missing or truncated",
    );
  const captured = await read("capture", { bounds: info.window.bounds });
  if (typeof captured.png_base64 !== "string" || !captured.png_base64)
    throw new Error("Independent screenshot is unavailable");
  const bytes = Buffer.from(captured.png_base64, "base64");
  if (
    !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    throw new Error("Independent screenshot is not a PNG");
  await mkdir(join(folder, "evidence"), { recursive: true });
  const file = "evidence/computer-observer.png";
  await writeFile(join(folder, file), bytes);
  const after = await read("control");
  return {
    checks: [],
    observer: {
      method:
        "Read-only inspection of already-loaded production desktop modules and native Accessibility",
      observed_at: new Date().toISOString(),
      window_info: info,
      control_before: before,
      control_after: after,
    },
    computer_evidence: {
      observed: {
        window,
        ...(owner ? { app: { id: owner.id, path: owner.path, name: owner.name } } : {}),
        title: info.window.title,
        bounds: info.window.bounds,
        accessibility,
        attachments: [{ kind: "screenshot", file, mime_type: "image/png" }],
      },
      controlReleased:
        before.available === true &&
        after.available === true &&
        before.active === false &&
        after.active === false,
    },
  };
}

export async function inspectorRead(
  desktopRoot,
  endpoint,
  operation,
  args = {},
) {
  const url = new URL(endpoint);
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password
  )
    throw new Error(
      "Desktop inspector must be a credential-free loopback HTTP endpoint",
    );
  const root = resolve(desktopRoot);
  const modules = {
    control: "electron/plugins/computer/index.cjs",
    list: "electron/plugins/computer/native.cjs",
    window: "electron/plugins/computer/native.cjs",
    accessibility: "electron/plugins/computer/native.cjs",
    capture: "electron/plugins/computer/capture.cjs",
  };
  if (!Object.hasOwn(modules, operation))
    throw new Error("Unsupported observer operation");
  const targetFile = join(root, modules[operation]);
  // resolve + cache check is essential: requiring an unloaded computer module
  // would create an unrelated idle controller and falsely prove release.
  const setup = `const req=process.mainModule.require('node:module').createRequire(${JSON.stringify(join(root, "electron/main.cjs"))});const key=req.resolve(${JSON.stringify(targetFile)});const loaded=req.cache[key];if(!loaded)throw new Error('Observer module is not loaded in the target desktop');const mod=loaded.exports;`;
  const actions = {
    control: "return await mod.status();",
    list: 'return await mod.native({action:"list",running_only:true});',
    window: `return await mod.native(${JSON.stringify({ ...args, action: "window" })});`,
    accessibility: `return await mod.native(${JSON.stringify({ ...args, action: "accessibility" })});`,
    capture: `const result=await mod.capture(${JSON.stringify(args.bounds)});return {width:result.width,height:result.height,png_base64:result.image.toString('base64')};`,
  };
  const targets = await fetch(new URL("/json/list", url), {
    signal: AbortSignal.timeout(5000),
  }).then((r) => {
    if (!r.ok) throw new Error(`Inspector HTTP ${r.status}`);
    return r.json();
  });
  if (targets.length !== 1 || !targets[0].webSocketDebuggerUrl)
    throw new Error(
      "Expected exactly one target desktop main-process inspector",
    );
  const wsUrl = new URL(targets[0].webSocketDebuggerUrl);
  if (wsUrl.hostname !== url.hostname || wsUrl.port !== url.port)
    throw new Error("Inspector WebSocket belongs to another endpoint");
  const socket = new WebSocket(wsUrl);
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Inspector connection timeout")),
        5000,
      );
      socket.onopen = () => {
        clearTimeout(timer);
        resolve();
      };
      socket.onerror = () => {
        clearTimeout(timer);
        reject(new Error("Inspector connection failed"));
      };
    });
    const response = await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Independent observation timed out")),
        20000,
      );
      socket.onerror = () => {
        clearTimeout(timer);
        reject(new Error("Inspector disconnected"));
      };
      socket.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.id === 1) {
          clearTimeout(timer);
          resolve(data);
        }
      };
      socket.send(
        JSON.stringify({
          id: 1,
          method: "Runtime.evaluate",
          params: {
            expression: `(async()=>{${setup}${actions[operation]}})()`,
            awaitPromise: true,
            returnByValue: true,
          },
        }),
      );
    });
    if (response.error || response.result?.exceptionDetails)
      throw new Error(
        `Independent desktop observation failed: ${response.result?.exceptionDetails?.exception?.description ?? response.error?.message ?? "unknown inspector error"}`,
      );
    return response.result.result.value;
  } finally {
    socket.close();
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2),
    flags = {};
  let preflight = false,
    folder;
  while (args.length) {
    const a = args.shift();
    if (a === "--preflight") preflight = true;
    else if (a.startsWith("--")) {
      if (!["--desktop-root", "--inspector"].includes(a) || !args.length)
        throw new Error(`Invalid option ${a}`);
      flags[a] = args.shift();
    } else if (!folder) folder = resolve(a);
    else throw new Error("Unexpected observer argument");
  }
  if (!flags["--desktop-root"] || !flags["--inspector"])
    throw new Error(
      "Pass --desktop-root and --inspector for the actual executing desktop",
    );
  const read = (op, params) =>
    inspectorRead(flags["--desktop-root"], flags["--inspector"], op, params);
  if (preflight) {
    const status = await read("control");
    if (
      status.available !== true ||
      status.active !== false ||
      status.platform !== process.platform
    )
      throw new Error(
        "Computer control is unavailable, owned by another turn, or on another platform",
      );
    const nativeReady = await read("list");
    if (!Array.isArray(nativeReady.apps))
      throw new Error("Independent native helper is unavailable");
    console.log(
      JSON.stringify({
        ready: true,
        status,
        native_helper_ready: true,
        observer: "read-only loaded desktop controller",
      }),
    );
  } else {
    if (!folder) throw new Error("Pass the absolute attempt folder");
    console.log(JSON.stringify(await observeComputer(folder, read)));
  }
}
