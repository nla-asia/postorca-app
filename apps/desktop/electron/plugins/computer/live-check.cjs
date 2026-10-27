// Interactive real-app validation through the plugin's own tools.
// Authenticated loopback JSON requests: {tool:"computer_list_apps",args:{}}.
const { app } = require("electron");
const { createServer } = require("node:http");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { tools, shutdown } = require("./index.cjs");
const folder = path.resolve(
  ".data/computer-use-live",
  new Date().toISOString().replace(/[:.]/g, "-"),
);
require("node:fs").mkdirSync(path.join(folder, "profile"), { recursive: true });
app.setPath("userData", path.join(folder, "profile"));
app.whenReady().then(async () => {
  await fs.mkdir(folder, { recursive: true });
  let sequence = 0;
  const context = {
    taskId: "computer-live-check",
    turnId: String(process.pid),
    upload: async (data) => {
      const file = path.join(folder, `screenshot-${Date.now()}.png`);
      await fs.writeFile(file, data);
      return file;
    },
  };
  let queue = Promise.resolve();
  const token = randomUUID();
  const server = createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (
      req.method !== "POST" ||
      req.headers.authorization !== `Bearer ${token}`
    ) {
      res.writeHead(403);
      res.end("{}");
      return;
    }
    const chunks = [];
    let bytes = 0;
    for await (const chunk of req) {
      bytes += chunk.length;
      if (bytes > 128_000) {
        res.writeHead(413);
        res.end("{}");
        req.destroy();
        return;
      }
      chunks.push(chunk);
    }
    const line = Buffer.concat(chunks).toString();
    queue = queue.then(async () => {
      let request;
      try {
        request = JSON.parse(line);
        if (request.tool === "quit") {
          shutdown();
          res.end(JSON.stringify({ stopped: true }));
          server.close();
          app.quit();
          return;
        }
        if (!Object.hasOwn(tools, request.tool))
          throw new Error("Unknown tool");
        await tools.desktop_computer_session.run({ active: true }, context);
        const result = await tools[request.tool].run(
          request.args ?? {},
          context,
        );
        const file = path.join(folder, `${++sequence}-${request.tool}.json`);
        await fs.writeFile(
          file,
          JSON.stringify(
            { tool: request.tool, args: request.args ?? {}, result },
            null,
            2,
          ),
        );
        const summary = { ...result };
        if (summary.apps)
          summary.apps = summary.apps.filter(
            (a) =>
              a.windows?.length ||
              /chatgpt|claude|codex|notepad|calculator|chrome|edge/i.test(
                a.name,
              ),
          );
        if (summary.accessibility)
          summary.accessibility = {
            ...summary.accessibility,
            nodes: summary.accessibility.nodes?.length,
          };
        res.end(JSON.stringify({ tool: request.tool, file, result: summary }));
      } catch (error) {
        const result = {
          tool: request?.tool,
          args: request?.args,
          error: error.message,
        };
        const file = path.join(folder, `${++sequence}-error.json`);
        await fs.writeFile(file, JSON.stringify(result, null, 2));
        res.end(JSON.stringify({ ...result, file }));
      }
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const connection = path.join(folder, "connection.json");
  await fs.writeFile(
    connection,
    JSON.stringify({ port: server.address().port, token }),
    { mode: 0o600 },
  );
  console.log(JSON.stringify({ ready: true, folder, connection }));
});
app.on("before-quit", shutdown);
