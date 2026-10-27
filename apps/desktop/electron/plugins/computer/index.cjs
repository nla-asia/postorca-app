const { ComputerController } = require("./controller.cjs");
const { native } = require("./native.cjs");
const { capture, displays } = require("./capture.cjs");

const controller = new ComputerController({
  native,
  capture,
  displays,
  encode: (bitmap) => bitmap.image,
  loadRobot: () => {
    const robot = require("robotjs");
    robot.setMouseDelay(15);
    robot.setKeyboardDelay(15);
    return robot;
  },
  clipboard: {
    read: async () => {
      const { clipboard, ClipboardItem } = require("electron");
      const items = await clipboard.read();
      return Promise.all(
        items
          .filter((item) => item.types.length)
          .map(
            async (item) =>
              new ClipboardItem(
                Object.fromEntries(
                  await Promise.all(
                    item.types.map(async (type) => [
                      type,
                      await item.getType(type),
                    ]),
                  ),
                ),
              ),
          ),
      );
    },
    readText: () => require("electron").clipboard.readText(),
    writeText: (text) => require("electron").clipboard.writeText(text),
    restore: (items) => {
      const { clipboard } = require("electron");
      return items.length ? clipboard.write(items) : clipboard.clear();
    },
  },
});
const names = [
  "computer_list_apps",
  "computer_open",
  "computer_observe",
  "computer_click",
  "computer_type",
  "computer_press",
  "computer_scroll",
];
module.exports = {
  name: "computer",
  status: async () => controller.status(),
  shutdown: () => controller.reset(),
  tools: {
    // Internal transport command; deliberately absent from the model's tool catalog.
    desktop_computer_session: {
      run: ({ active }, context) =>
        controller.session(active === true, context),
    },
    ...Object.fromEntries(
      names.map((name) => [
        name,
        { run: (args, context) => controller.run(name, args, context) },
      ]),
    ),
  },
};
