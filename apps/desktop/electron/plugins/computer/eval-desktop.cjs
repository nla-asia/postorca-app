// Runs the production desktop transport/tools for a real internal-agent eval.
// No task actions are scripted here; all input comes from the agent's tool calls.
const { app } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { DesktopConnection } = require("../../connection.cjs");
const plugins = require("../index.cjs");
const profile = path.join(path.dirname(process.argv[2]), "desktop-profile");
fs.mkdirSync(profile, { recursive: true });
app.setPath("userData", profile);
let connection;
app.whenReady().then(() => {
  const session = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  connection = new DesktopConnection(session.deviceId);
  connection.setSession({ token: session.token, apiUrl: session.apiUrl });
  console.log("Eval desktop transport started; awaiting internal-agent calls.");
  const watch = setInterval(() => {
    if (!fs.existsSync(process.argv[2])) {
      clearInterval(watch);
      connection.setSession(null);
      app.quit();
    }
  }, 1000);
});
app.on("before-quit", () => {
  connection?.setSession(null);
  plugins.shutdown();
});
