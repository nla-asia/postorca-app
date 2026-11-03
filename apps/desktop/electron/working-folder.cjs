// The founder's content output folder: the one folder on this computer Orca's file tools may
// use. Chosen with the system folder picker (required when it isn't set).
// Saved in the app's settings file in userData.
const fs = require("node:fs");
const path = require("node:path");

const file = () =>
  path.join(require("electron").app.getPath("userData"), "settings.json");

function read() {
  try {
    return JSON.parse(fs.readFileSync(file(), "utf8"));
  } catch {
    return {};
  }
}

/** The saved content output folder, or null when none is set or it no longer exists. */
function get() {
  const folder = read().workingFolder;
  return typeof folder === "string" && fs.existsSync(folder) ? folder : null;
}

function set(folder) {
  fs.writeFileSync(
    file(),
    JSON.stringify({ ...read(), workingFolder: folder }, null, 2),
  );
}

/** Opens the folder picker over win; saves and returns the choice, or null. */
async function choose(win) {
  const { dialog } = require("electron");
  const current = get();
  const result = await dialog.showOpenDialog(win, {
    title: "Choose your content output folder",
    message:
      "Orca saves plans, scripts, recordings, and finished content here. Add project source folders separately in the sidebar.",
    buttonLabel: "Use this folder",
    defaultPath: current ?? require("electron").app.getPath("documents"),
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  set(result.filePaths[0]);
  return result.filePaths[0];
}

module.exports = { get, choose };
