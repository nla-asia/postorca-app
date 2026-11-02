// Desktop tools Orca can call, run in the main process on the founder's computer.
// Each name must match a tool on the server, which owns the schema the model sees:
// core tools in apps/api/src/tools/desktop.ts, plugin tools in apps/api/src/plugins.
// The server validates arguments first; a tool should still treat its arguments as
// untrusted input.
//
// A tool module exports run(args, context) → JSON-serializable result. Throwing
// reports the call as failed with the error's message.
const tools = {
  desktop_status: require("./desktop-status.cjs"),
  download_file: require("./download-file.cjs"),
  list_dir: require("./files.cjs").list_dir,
  read_file: require("./files.cjs").read_file,
  upload_file: require("./files.cjs").upload_file,
  write_content_file: require("./files.cjs").write_content_file,
  media_transcribe: require("./transcribe.cjs").media_transcribe,
  ...require("./work.cjs"),
  list_capture_targets: require("./screen.cjs").list_capture_targets,
  screen_capture: require("./screen.cjs").screen_capture,
  screen_record_start: require("./screen.cjs").screen_record_start,
  screen_record_stop: require("./screen.cjs").screen_record_stop,
  ...require("../plugins/index.cjs").tools,
};
module.exports = tools;
