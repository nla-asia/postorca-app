// Desktop tools Orca can call, run in the main process on the founder's computer.
// Each name must match a tool on the server, which owns the schema the model sees
// (plugin tools in apps/api/src/plugins). The server validates arguments first; a
// tool should still treat its arguments as untrusted input.
//
// A tool module exports run(args, context) → JSON-serializable result. Throwing
// reports the call as failed with the error's message.
const tools = {
  ...require("../plugins/index.cjs").tools,
};
module.exports = tools;
