// Desktop sides of the server's plugins (apps/api/src/plugins). Each plugin module
// exports { name, tools, start?, shutdown?, status? }; its tool names must match the
// server plugin's desktop tools. To add one: create electron/plugins/<name>/index.cjs
// and list it here.
const plugins = [require("./browser/index.cjs"), require("./computer/index.cjs")];

module.exports = {
  /** Every plugin's desktop tools, by name. */
  tools: Object.assign({}, ...plugins.map((plugin) => plugin.tools)),
  start() {
    for (const plugin of plugins) void plugin.start?.()?.catch?.(() => {});
  },
  shutdown() {
    for (const plugin of plugins) void plugin.shutdown?.()?.catch?.(() => {});
  },
  /** Status reported by each plugin that has one, by plugin name. */
  async status() {
    const entries = await Promise.all(
      plugins
        .filter((plugin) => plugin.status)
        .map(async (plugin) => [
          plugin.name,
          await plugin.status().catch((error) => ({
            available: false,
            reason: String(error?.message ?? error),
          })),
        ]),
    );
    return Object.fromEntries(entries);
  },
};
