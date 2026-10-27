// Controlled live test: only this script's own window receives input.
const { app, BrowserWindow, nativeImage } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { tools, shutdown } = require("./index.cjs");
const title = `PostOrca Computer Use Probe ${process.pid}`;
const folder = path.resolve(
  ".data/computer-use-smoke",
  new Date().toISOString().replace(/[:.]/g, "-"),
);
require("node:fs").mkdirSync(path.join(folder, "profile"), { recursive: true });
app.setPath("userData", path.join(folder, "profile"));
let probe;
app.whenReady().then(async () => {
  await fs.mkdir(folder, { recursive: true });
  let saved;
  const context = {
    taskId: "computer-smoke",
    turnId: String(process.pid),
    upload: async (data) => {
      const file = path.join(folder, `shot-${Date.now()}.png`);
      await fs.writeFile(file, data);
      saved = file;
      return file;
    },
  };
  const run = (name, args = {}) => tools[name].run(args, context);
  try {
    probe = new BrowserWindow({
      title,
      frame: false,
      width: 700,
      height: 550,
      x: 100,
      y: 100,
      webPreferences: { contextIsolation: true, nodeIntegration: false },
    });
    await probe.loadURL(
      "data:text/html;charset=utf-8," +
        encodeURIComponent(
          `<!doctype html><title>${title}</title><style>body{font:18px Arial;background:#eef3ff;margin:24px}textarea{width:90%;height:90px}button{padding:12px}#panel{height:200px;overflow:auto;background:white;margin-top:20px}p{height:65px}</style><h1>Computer Use Probe</h1><textarea id="editor"></textarea><button id="button" onclick="this.textContent='Clicked'">Click me</button><div id="panel">${Array.from({ length: 20 }, (_, i) => `<p>Row ${i + 1}</p>`).join("")}<p id="bottom">BOTTOM</p></div>`,
        ),
    );
    probe.show();
    probe.focus();
    await run("desktop_computer_session", { active: true });
    const listing = await run("computer_list_apps");
    const own = listing.apps.find((a) =>
      a.windows?.some((w) => w.title === title),
    );
    assert.ok(own, "Probe is discoverable");
    await run("computer_open", { app_id: own.id });
    const target = own.windows.find((w) => w.title === title).id;
    let shot = await run("computer_observe", {
      window: target,
      accessibility: true,
    });
    assert.ok(
      shot.accessibility?.nodes?.length > 0,
      JSON.stringify(shot.accessibility),
    );
    const accessibilityNodes = shot.accessibility.nodes.length;
    const geometry = async (selector) =>
      probe.webContents.executeJavaScript(
        `(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,width:innerWidth,height:innerHeight}})()`,
      );
    const click = async (selector) => {
      const r = await geometry(selector);
      shot = await run("computer_click", {
        window: target,
        observation: shot.observation,
        x: Math.round((r.x * shot.width) / r.width),
        y: Math.round((r.y * shot.height) / r.height),
      });
    };
    await click("#editor");
    const text = "Hello สวัสดี 👋 computer use";
    shot = await run("computer_type", {
      window: target,
      observation: shot.observation,
      text,
    });
    assert.equal(
      await probe.webContents.executeJavaScript(
        "document.querySelector('#editor').value",
      ),
      text,
    );
    await click("#button");
    assert.equal(
      await probe.webContents.executeJavaScript(
        "document.querySelector('#button').textContent",
      ),
      "Clicked",
    );
    const point = await geometry("#panel");
    shot = await run("computer_scroll", {
      window: target,
      observation: shot.observation,
      x: Math.round((point.x * shot.width) / point.width),
      y: Math.round((point.y * shot.height) / point.height),
      mode: "bottom",
      max_steps: 20,
    });
    const scroll = await probe.webContents.executeJavaScript(
      "(()=>{const p=document.querySelector('#panel');return {top:p.scrollTop,height:p.scrollHeight,client:p.clientHeight}})()",
    );
    assert.ok(
      scroll.top + scroll.client >= scroll.height - 2,
      JSON.stringify(scroll),
    );
    assert.ok(nativeImage.createFromPath(saved).getSize().width > 100);
    await run("desktop_computer_session", { active: false });
    await assert.rejects(run("computer_list_apps"), /inactive/);
    const report = {
      platform: process.platform,
      robotjs: require("robotjs/package.json").version,
      discovered_apps: listing.apps.length,
      accessibility_nodes: accessibilityNodes,
      screenshot: saved,
      dimensions: [shot.width, shot.height],
      scroll,
      passed: true,
    };
    await fs.writeFile(
      path.join(folder, "report.json"),
      JSON.stringify(report, null, 2),
    );
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    console.error(error);
    app.exitCode = 1;
  } finally {
    shutdown();
    probe?.destroy();
    app.exit(app.exitCode ?? 0);
  }
});
