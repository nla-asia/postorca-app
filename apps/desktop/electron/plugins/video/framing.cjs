/**
 * Snap a focus region's edges onto the nearest real edge in the picture: the side of the
 * app's window, a sidebar, the line under a browser's bars. A focus is estimated by eye,
 * and a few percent off cuts through the app (half a sidebar, a strip of the address
 * bar), which reads as a mistake; on an edge, it reads as framed.
 *
 * `gray` is one byte per pixel, `width` × `height`, row by row. Each edge moves at most
 * `reach` of the picture, and stays put when nothing nearby stands out.
 */
function snapRegion(gray, width, height, region, { reach = 0.05, contrast = 12 } = {}) {
  const at = (x, y) => gray[y * width + x];
  // How sharply the picture changes across the vertical line at x (between x-1 and x),
  // over rows from..to: the mean step between a few pixels either side, so a hairline
  // scores lower than a real boundary.
  function columnStep(x, from, to) {
    const side = Math.min(3, x, width - x);
    let total = 0;
    for (let y = from; y < to; y++) {
      let before = 0,
        after = 0;
      for (let k = 0; k < side; k++) {
        before += at(x - 1 - k, y);
        after += at(x + k, y);
      }
      total += Math.abs(before - after) / side;
    }
    return total / Math.max(1, to - from);
  }
  function rowStep(y, from, to) {
    const side = Math.min(3, y, height - y);
    let total = 0;
    for (let x = from; x < to; x++) {
      let before = 0,
        after = 0;
      for (let k = 0; k < side; k++) {
        before += at(x, y - 1 - k);
        after += at(x, y + k);
      }
      total += Math.abs(before - after) / side;
    }
    return total / Math.max(1, to - from);
  }
  function snap(position, size, step) {
    const range = Math.max(1, Math.round(reach * size));
    let best = position,
      bestScore = 0;
    for (
      let p = Math.max(1, position - range);
      p <= Math.min(size - 1, position + range);
      p++
    ) {
      const strength = step(p);
      if (strength < contrast) continue;
      // Nearer edges win a close call.
      const score = strength * (1 - (0.5 * Math.abs(p - position)) / range);
      if (score > bestScore) {
        best = p;
        bestScore = score;
      }
    }
    return best;
  }
  const left = Math.round(region.x * width),
    right = Math.round((region.x + region.width) * width),
    top = Math.round(region.y * height),
    bottom = Math.round((region.y + region.height) * height);
  const rows = [Math.max(0, top), Math.min(height, bottom)],
    columns = [Math.max(0, left), Math.min(width, right)];
  const snapped = {
    left: snap(left, width, (x) => columnStep(x, ...rows)),
    right: snap(right, width, (x) => columnStep(x, ...rows)),
    top: snap(top, height, (y) => rowStep(y, ...columns)),
    bottom: snap(bottom, height, (y) => rowStep(y, ...columns)),
  };
  // An edge that wandered past its opposite would turn the region inside out.
  if (snapped.right - snapped.left < (right - left) / 2) {
    snapped.left = left;
    snapped.right = right;
  }
  if (snapped.bottom - snapped.top < (bottom - top) / 2) {
    snapped.top = top;
    snapped.bottom = bottom;
  }
  const round = (value) => Math.round(value * 10000) / 10000;
  return {
    x: round(snapped.left / width),
    y: round(snapped.top / height),
    width: round((snapped.right - snapped.left) / width),
    height: round((snapped.bottom - snapped.top) / height),
  };
}

module.exports = { snapRegion };
