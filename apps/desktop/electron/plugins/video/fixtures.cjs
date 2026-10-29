const fs = require("node:fs/promises");
const path = require("node:path");
const { deflateSync } = require("node:zlib");

// Small synthetic screen and tones for offline verification, not generated content.
function crc32(data) {
  let result = 0xffffffff;
  for (const byte of data) {
    result ^= byte;
    for (let bit = 0; bit < 8; bit++)
      result = (result >>> 1) ^ (result & 1 ? 0xedb88320 : 0);
  }
  return (result ^ 0xffffffff) >>> 0;
}
function pngChunk(name, data) {
  const type = Buffer.from(name),
    size = Buffer.alloc(4),
    checksum = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  checksum.writeUInt32BE(crc32(Buffer.concat([type, data])));
  return Buffer.concat([size, type, data, checksum]);
}
/** RGB pixels of the synthetic screen; `progress` (0–1) grows a bar along the top, as a clip's motion. */
function screenPixels(width, height, progress, row) {
  const raw = Buffer.alloc(row(height - 1) + width * 3);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      let color = [239, 242, 246];
      if (y < 45) color = [30, 40, 55];
      else if (x < 120) color = [220, 228, 238];
      else if (x > 145 && x < 610 && y > 78 && y < 330) color = [255, 255, 255];
      if (x > 175 && x < 470 && y > 100 && y < 122) color = [50, 80, 110];
      if (x > 175 && x < 570 && y > 155 && y < 180) color = [112, 152, 183];
      if (x > 175 && x < 570 && y > 200 && y < 225) color = [170, 190, 210];
      if (x > 480 && x < 570 && y > 265 && y < 300) color = [29, 143, 126];
      if (progress !== null && y > 50 && y < 70 && x < width * progress)
        color = [242, 165, 65];
      const offset = row(y) + x * 3;
      color.forEach((channel, index) => {
        raw[offset + index] = channel;
      });
    }
  return raw;
}
function screenPng(progress = null) {
  const width = 640,
    height = 400;
  const raw = screenPixels(
    width,
    height,
    progress,
    (y) => y * (width * 3 + 1) + 1,
  );
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}
function toneWav(seconds = 4, frequency = 440) {
  const rate = 44100,
    samples = Math.round(rate * seconds),
    header = Buffer.alloc(44),
    data = Buffer.alloc(samples * 2);
  header.write("RIFF");
  header.writeUInt32LE(data.length + 36, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  for (let index = 0; index < samples; index++)
    data.writeInt16LE(
      Math.round(Math.sin((index * frequency * Math.PI * 2) / rate) * 2000),
      index * 2,
    );
  return Buffer.concat([header, data]);
}
async function makeFixtures(directory) {
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, "screen.png"), screenPng());
  await fs.writeFile(path.join(directory, "tone.wav"), toneWav());
  // Frames of a 3 s, 30 fps screen recording whose bar fills over the clip.
  await fs.mkdir(path.join(directory, "clip"), { recursive: true });
  for (let frame = 0; frame < 90; frame++)
    await fs.writeFile(
      path.join(directory, "clip", `${String(frame).padStart(3, "0")}.png`),
      screenPng((frame + 1) / 90),
    );
}
module.exports = { screenPng, toneWav, makeFixtures };
