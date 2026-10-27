const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { list_dir, read_file } = require("./files.cjs");

// A 1×1 PNG.
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB9sAAAAASUVORK5CYII=",
  "base64",
);

test("list_dir and read_file work only inside project folders; images come back as uploads", async (t) => {
  const project = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "postorca-project-")),
  );
  const outside = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "postorca-outside-")),
  );
  t.after(async () => {
    await fs.rm(project, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  });
  await fs.writeFile(path.join(project, "notes.md"), "# Notes\n");
  await fs.writeFile(path.join(project, "screen.png"), png);
  await fs.writeFile(path.join(project, ".env"), "API_KEY=do-not-read\n");
  await fs.writeFile(path.join(project, "song.mp3"), "ID3");
  await fs.mkdir(path.join(project, "more"));
  await fs.writeFile(path.join(outside, "secret.txt"), "no");
  await fs.symlink(
    outside,
    path.join(project, "escape"),
    process.platform === "win32" ? "junction" : "dir",
  );
  const roots = [project];

  await assert.rejects(list_dir.run({ path: project }), /No project folder is set/);
  // No path, or a relative one, means the first project folder.
  assert.equal((await list_dir.run({ roots })).path, project);
  assert.equal(
    (await read_file.run({ path: "notes.md", roots }, {})).text,
    "# Notes\n",
  );
  // Hidden files and secrets are never listed.
  assert.deepEqual(
    (await list_dir.run({ path: project, roots })).entries.map((e) => [e.name, e.type]),
    [
      ["escape", "folder"],
      ["more", "folder"],
      ["notes.md", "file"],
      ["screen.png", "file"],
      ["song.mp3", "file"],
    ],
  );
  const uploads = [];
  const context = {
    upload: async (data, type) => (
      uploads.push({ data, type }),
      "users/u/screenshots/k.png"
    ),
  };
  assert.deepEqual(
    await read_file.run({ path: path.join(project, "screen.png"), roots }, context),
    {
      path: path.join(project, "screen.png"),
      attachments: [
        { file: "users/u/screenshots/k.png", mime_type: "image/png", title: "screen.png" },
      ],
    },
  );
  assert.deepEqual(uploads[0], { data: png, type: "image/png" });
  await assert.rejects(
    read_file.run({ path: "song.mp3", roots }, context),
    /text, code and PNG or JPEG images only/,
  );
  await assert.rejects(read_file.run({ path: ".env", roots }, context), /secrets/);

  // Nothing outside, including through a link that points out.
  await assert.rejects(
    read_file.run({ path: path.join(outside, "secret.txt"), roots }, context),
    /Not in a project folder/,
  );
  await assert.rejects(
    read_file.run({ path: path.join(project, "escape/secret.txt"), roots }, context),
    /Not in a project folder/,
  );
  await assert.rejects(
    read_file.run({ path: path.join(project, "nope.txt"), roots }, context),
    /Not found/,
  );
});

test("a project folder reached through a link still counts as that folder", async (t) => {
  const real = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "postorca-real-")),
  );
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "postorca-link-"));
  const link = path.join(parent, "project");
  t.after(async () => {
    await fs.rm(real, { recursive: true, force: true });
    await fs.rm(parent, { recursive: true, force: true });
  });
  await fs.writeFile(path.join(real, "plan.md"), "Plan\n");
  await fs.symlink(real, link, process.platform === "win32" ? "junction" : "dir");
  assert.equal(
    (await read_file.run({ path: "plan.md", roots: [link] }, {})).text,
    "Plan\n",
  );
});
