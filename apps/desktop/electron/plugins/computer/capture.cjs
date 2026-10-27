function displays() {
  const { screen } = require("electron");
  return screen
    .getAllDisplays()
    .map((d) => ({
      id: String(d.id),
      pixelWidth: Math.round(d.bounds.width * d.scaleFactor),
      pixelHeight: Math.round(d.bounds.height * d.scaleFactor),
      ...(process.platform === "win32"
        ? screen.dipToScreenRect(null, d.bounds)
        : d.bounds),
    }));
}
async function capture(bounds) {
  const { desktopCapturer } = require("electron");
  const display = displays().find(
    (d) =>
      bounds.x >= d.x &&
      bounds.y >= d.y &&
      bounds.x + bounds.width <= d.x + d.width &&
      bounds.y + bounds.height <= d.y + d.height,
  );
  if (!display)
    throw new Error("Capture region no longer fits on one display.");
  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: { width: display.pixelWidth, height: display.pixelHeight },
  });
  const source = sources.find((s) => s.display_id === display.id);
  if (!source || source.thumbnail.isEmpty())
    throw new Error(
      "Display capture unavailable. Check Screen Recording permission.",
    );
  const size = source.thumbnail.getSize();
  const scaleX = size.width / display.width,
    scaleY = size.height / display.height;
  const x = Math.round((bounds.x - display.x) * scaleX),
    y = Math.round((bounds.y - display.y) * scaleY);
  const rect = {
    x,
    y,
    width: Math.min(size.width - x, Math.round(bounds.width * scaleX)),
    height: Math.min(size.height - y, Math.round(bounds.height * scaleY)),
  };
  const image = source.thumbnail.crop(rect);
  return { ...image.getSize(), image: image.toPNG() };
}
module.exports = { capture, displays };
