const { app, BrowserWindow } = require("electron");
const os = require("node:os");
const plugins = require("../plugins/index.cjs");

// What this desktop can do right now; Orca checks it before relying on desktop tools.
exports.run = async (_args, context) => ({
  available: true,
  app_version: app.getVersion(),
  platform: process.platform,
  os_version: os.release(),
  arch: process.arch,
  // The app keeps running tools with its window closed (macOS keeps it in the Dock).
  window_open: BrowserWindow.getAllWindows().length > 0,
  // Where list_dir and read_file work besides project folders; null until chosen.
  working_folder: require("../working-folder.cjs").get(),
  plugins: await plugins.status(),
  tools: context.tools,
});
