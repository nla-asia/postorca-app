/**
 * Snap a focus region's edges onto the nearest real edge in the picture: the side of the
 * app's window, a sidebar, the line under a browser's bars. A focus is estimated by eye,
 * and a few percent off cuts through the app (half a sidebar, a strip of the address
 * bar), which reads as a mistake; on an edge, it reads as framed.
 *
 * `gray` is one byte per pixel, `width` × `height`, row by row. Each edge moves at most
 * `reach` of the picture: onto an edge that cuts nothing, or else into the empty space
 * beside what it would cut, looking further when that is all inside one big element.
 */
function snapRegion(
  gray,
  width,
  height,
  region,
  { reach = 0.1, reachX = reach, reachY = reach, contrast = 12 } = {},
) {
  const at = (x, y) => gray[y * width + x];
  // The line between pixels p-1 and p (columns or rows), over from..to along it: how
  // sharply the picture changes across it (the mean step between a few pixels either
  // side, so a hairline scores lower than a real boundary), and whether it runs through
  // empty space on both sides rather than cutting text or an element.
  function line(vertical, p, from, to) {
    const size = vertical ? width : height;
    const side = Math.min(3, p, size - p);
    const pixel = (along, across) => (vertical ? at(across, along) : at(along, across));
    let total = 0,
      crossings = 0;
    for (let i = from; i < to; i++) {
      let before = 0,
        after = 0;
      for (let k = 0; k < side; k++) {
        before += pixel(i, p - 1 - k);
        after += pixel(i, p + k);
      }
      total += Math.abs(before - after) / side;
      if (i > from) {
        if (Math.abs(pixel(i, p) - pixel(i - 1, p)) > 10) crossings++;
        if (Math.abs(pixel(i, p - 1) - pixel(i - 1, p - 1)) > 10) crossings++;
      }
    }
    const length = Math.max(1, to - from);
    // An element's corners may touch a line that runs past it; cutting through text or
    // a card crosses it many times.
    return { strength: total / length, clear: crossings <= 8 };
  }
  // The strongest clear edge nearby, nearer winning a close call; else the nearest clear
  // line, so the edge at least sits beside what it would cut; else where it was.
  function snap(vertical, position, from, to, outward) {
    const size = vertical ? width : height;
    const range = Math.max(1, Math.round((vertical ? reachX : reachY) * size));
    let edge = null,
      edgeScore = 0,
      gap = null;
    for (let p = Math.max(1, position - range); p <= Math.min(size - 1, position + range); p++) {
      const { strength, clear } = line(vertical, p, from, to);
      if (!clear) continue;
      const distance = Math.abs(p - position);
      if (gap === null || distance < Math.abs(gap - position)) gap = p;
      const score = strength * (1 - (0.3 * distance) / range);
      if (strength >= contrast && score > edgeScore) {
        edge = p;
        edgeScore = score;
      }
    }
    // Nothing clean nearby: the edge is inside something big (a card, a chart), so move
    // it to the nearest clean line further out, rather than leave it cutting through.
    for (let d = range + 1; edge === null && gap === null && d <= 0.3 * size; d++)
      for (const p of [position - d, position + d])
        if (gap === null && p >= 1 && p <= size - 1 && line(vertical, p, from, to).clear) gap = p;
    if (edge !== null || gap === null || gap === position) return edge ?? position;
    // Beside an element, leave a little room, as far as the space stays empty.
    let roomy = gap;
    for (let i = 0; i < Math.round(0.012 * size); i++) {
      const next = roomy + outward;
      if (next < 1 || next > size - 1 || !line(vertical, next, from, to).clear) break;
      roomy = next;
    }
    return roomy;
  }
  const left = Math.round(region.x * width),
    right = Math.round((region.x + region.width) * width),
    top = Math.round(region.y * height),
    bottom = Math.round((region.y + region.height) * height);
  // Each edge is checked along the others; once they've moved, check again along where
  // they ended up, so a side doesn't cut what a taller or wider box now takes in.
  let snapped = { left, right, top, bottom };
  for (let pass = 0; pass < 2; pass++) {
    const rows = [Math.max(0, snapped.top), Math.min(height, snapped.bottom)],
      columns = [Math.max(0, snapped.left), Math.min(width, snapped.right)];
    snapped = {
      left: snap(true, left, ...rows, -1),
      right: snap(true, right, ...rows, 1),
      top: snap(false, top, ...columns, -1),
      bottom: snap(false, bottom, ...columns, 1),
    };
  }
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


const normal = (text) => text.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * The box around the named pieces of on-screen text (`lines` from read_text, fractions
 * of the picture): for each, the line containing it, picking near the ones already found
 * when it appears more than once. Returns the names it couldn't find instead, if any.
 */
function textBox(lines, names) {
  const found = [];
  const missing = [];
  for (const name of names) {
    const matches = lines.filter((line) => normal(line.text).includes(normal(name)));
    if (!matches.length) {
      missing.push(name);
      continue;
    }
    const centre = (box) => [box.x + box.width / 2, box.y + box.height / 2];
    const [cx, cy] = found.length
      ? found.map(centre).reduce(([ax, ay], [bx, by]) => [ax + bx / found.length, ay + by / found.length], [0, 0])
      : [0.5, 0.5];
    // The first one: the most prominent (tallest) match; after that, the nearest.
    const pick = found.length
      ? matches.reduce((a, b) => {
          const d = (box) => Math.hypot(centre(box)[0] - cx, centre(box)[1] - cy);
          return d(b) < d(a) ? b : a;
        })
      : matches.reduce((a, b) => (b.height > a.height ? b : a));
    found.push(pick);
  }
  if (missing.length) return { missing };
  const left = Math.min(...found.map((b) => b.x)),
    top = Math.min(...found.map((b) => b.y)),
    right = Math.max(...found.map((b) => b.x + b.width)),
    bottom = Math.max(...found.map((b) => b.y + b.height));
  return { box: { x: left, y: top, width: right - left, height: bottom - top } };
}

// The tightest a close-up goes, as fractions of the recording: about 1.8 times the whole
// app at most, so the viewer still sees where the element sits. Tighter reads as a
// crop of one word rather than a camera moving in.
const tightest = { width: 0.55, height: 0.35 };

/**
 * A close-up around `box` (fractions of a picture `aspect` wide per unit tall): room
 * around the elements, no tighter than `tightest`, and shaped toward the space it fills
 * (`frame`, width over height) so it shows large. It stays below `top`, where the app
 * starts under any browser bars, and inside the picture.
 */
function closeUp(box, aspect, frame, top = 0) {
  let width = (box.width + 2 * 0.04) * aspect,
    height = box.height + 2 * 0.03;
  width = Math.max(width, aspect * tightest.width);
  height = Math.max(height, tightest.height);
  if (width / height < frame * 0.75) width = height * frame * 0.75;
  if (width / height > frame * 1.5) height = width / (frame * 1.5);
  return around(box, width / aspect, height, top);
}

/** A region `w` × `h` centred on `box`, kept below `top` and inside the picture. */
function around(box, w, h, top = 0) {
  w = Math.min(1, w);
  h = Math.min(1 - top, h);
  const cx = box.x + box.width / 2,
    cy = box.y + box.height / 2;
  const x = Math.min(1 - w, Math.max(0, cx - w / 2)),
    y = Math.min(1 - h, Math.max(top, cy - h / 2));
  return { x, y, width: w, height: h };
}

/** A focus box drawn tighter than `tightest`, widened around its centre to it. */
function notTooTight(region) {
  if (region.width >= tightest.width && region.height >= tightest.height) return region;
  return around(
    region,
    Math.max(region.width, tightest.width),
    Math.max(region.height, tightest.height),
  );
}

/**
 * Where the app starts below a browser's bars: under the lowest line of text near the
 * top that reads as an address (a URL, an IP, localhost), at the next clean edge.
 * 0 when there is no address bar.
 */
function appTop(lines, gray, width, height) {
  const address = lines.filter(
    (line) =>
      line.y < 0.3 &&
      /:\/\/|\b\d{1,3}(\.\d{1,3}){3}\b|localhost|\.[a-z]{2,}\//i.test(line.text),
  );
  if (!address.length) return 0;
  const below = Math.max(...address.map((line) => line.y + line.height)) + 0.01;
  return snapRegion(gray, width, height, { x: 0, y: below, width: 1, height: 1 - below }).y;
}

/**
 * Keep the words on screen whole: a line of text the region's edge runs through is
 * taken in when most of it is inside, and left out otherwise. Edges can otherwise sit
 * in the gap between two letters, which looks clean to the pixels and reads "ssued".
 */
function wholeWords(region, lines) {
  let { x, y, width, height } = region;
  for (let pass = 0; pass < 3; pass++) {
    let moved = false;
    for (const line of lines) {
      const left = Math.max(x, line.x),
        right = Math.min(x + width, line.x + line.width),
        top = Math.max(y, line.y),
        bottom = Math.min(y + height, line.y + line.height);
      if (right <= left || bottom <= top) continue;
      const inside = ((right - left) * (bottom - top)) / (line.width * line.height);
      if (inside >= 0.999) continue;
      moved = true;
      const gap = 0.006;
      if (inside >= 0.5) {
        const r = Math.min(1, Math.max(x + width, line.x + line.width + gap)),
          b = Math.min(1, Math.max(y + height, line.y + line.height + gap));
        x = Math.max(0, Math.min(x, line.x - gap));
        y = Math.max(0, Math.min(y, line.y - gap));
        width = r - x;
        height = b - y;
      } else if (line.x < x) {
        width -= line.x + line.width + gap - x;
        x = line.x + line.width + gap;
      } else if (line.x + line.width > x + width) width = line.x - gap - x;
      else if (line.y < y) {
        height -= line.y + line.height + gap - y;
        y = line.y + line.height + gap;
      } else height = line.y - gap - y;
    }
    if (!moved) break;
  }
  return { x, y, width, height };
}

module.exports = { snapRegion, textBox, closeUp, wholeWords, appTop, notTooTight };
