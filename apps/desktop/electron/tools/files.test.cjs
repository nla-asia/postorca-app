const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { list_dir, read_file, upload_file } = require("./files.cjs");

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
  await fs.writeFile(path.join(project, "unsupported.zip"), "archive");
  await fs.mkdir(path.join(project, "more"));
  await fs.writeFile(path.join(outside, "secret.txt"), "no");
  await fs.symlink(
    outside,
    path.join(project, "escape"),
    process.platform === "win32" ? "junction" : "dir",
  );
  const roots = [project];

  await assert.rejects(
    list_dir.run({ path: project }),
    /No working folder or project folder is set/,
  );
  // No path, or a relative one, means the first project folder.
  assert.equal((await list_dir.run({ roots })).path, project);
  assert.equal(
    (await read_file.run({ path: "notes.md", roots }, {})).text,
    "# Notes\n",
  );
  // Hidden files and secrets are never listed.
  assert.deepEqual(
    (await list_dir.run({ path: project, roots })).entries.map((e) => [
      e.name,
      e.type,
    ]),
    [
      ["escape", "folder"],
      ["more", "folder"],
      ["notes.md", "file"],
      ["screen.png", "file"],
      ["unsupported.zip", "file"],
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
    await read_file.run(
      { path: path.join(project, "screen.png"), roots },
      context,
    ),
    {
      path: path.join(project, "screen.png"),
      attachments: [
        {
          file: "users/u/screenshots/k.png",
          mime_type: "image/png",
          title: "screen.png",
        },
      ],
    },
  );
  assert.deepEqual(uploads[0], { data: png, type: "image/png" });
  await assert.rejects(
    read_file.run({ path: "unsupported.zip", roots }, context),
    /images and audio only/,
  );
  await assert.rejects(
    read_file.run({ path: ".env", roots }, context),
    /secrets/,
  );

  // Nothing outside, including through a link that points out.
  await assert.rejects(
    read_file.run({ path: path.join(outside, "secret.txt"), roots }, context),
    /Not in the working folder or a project folder/,
  );
  await assert.rejects(
    read_file.run(
      { path: path.join(project, "escape/secret.txt"), roots },
      context,
    ),
    /Not in the working folder or a project folder/,
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
  await fs.symlink(
    real,
    link,
    process.platform === "win32" ? "junction" : "dir",
  );
  assert.equal(
    (await read_file.run({ path: "plan.md", roots: [link] }, {})).text,
    "Plan\n",
  );
});

test("audio reading converts only the selected excerpt inside the project boundary", async (t) => {
  const { toneWav } = require("../plugins/video/fixtures.cjs");
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "postorca-audio-test-"),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.writeFile(path.join(directory, "track.wav"), toneWav(4));
  let uploaded;
  const result = await read_file.run(
    {
      path: "track.wav",
      roots: [directory],
      start_seconds: 1,
      duration_seconds: 2,
    },
    {
      upload: async (data, type) => {
        uploaded = { data, type };
        return "users/u/media/12345678.mp3";
      },
    },
  );
  assert.equal(uploaded.type, "audio/mpeg");
  assert.ok(uploaded.data.length > 1000);
  assert.equal(result.ref, "12345678");
  assert.deepEqual(result.excerpt, { start_seconds: 1, duration_seconds: 2 });
  assert.equal(result.duration_seconds, 4);
  const suffix = process.platform === "win32" ? "-msvc" : "";
  const binaryDirectory = path.dirname(
    require.resolve(
      `@remotion/compositor-${process.platform}-${process.arch}${suffix}/package.json`,
    ),
  );
  const filename = path.join(directory, "excerpt.mp3");
  await fs.writeFile(filename, uploaded.data);
  const run = require("node:util").promisify(
    require("node:child_process").execFile,
  );
  const { stdout } = await run(
    path.join(
      binaryDirectory,
      process.platform === "win32" ? "ffprobe.exe" : "ffprobe",
    ),
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "csv=p=0",
      filename,
    ],
    { cwd: binaryDirectory },
  );
  assert.ok(Math.abs(Number(stdout.trim()) - 2) < 0.1);
});

test("development shared folders are readable, and upload_file sends originals unchanged", async (t) => {
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "postorca-outside-"));
  const shared = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "postorca-shared-")),
  );
  const project = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "postorca-project-")),
  );
  const previous = process.env.POSTORCA_SHARED_FOLDERS;
  t.after(async () => {
    if (previous === undefined) delete process.env.POSTORCA_SHARED_FOLDERS;
    else process.env.POSTORCA_SHARED_FOLDERS = previous;
    await fs.rm(shared, { recursive: true, force: true });
    await fs.rm(project, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  });
  // Development folders come after the working folder and project folders.
  process.env.POSTORCA_SHARED_FOLDERS = shared;
  const original = Buffer.from([0, 1, 2, 3, 255, 254]);
  await fs.writeFile(path.join(shared, "clip.mov"), original);
  await fs.writeFile(path.join(project, "plan.md"), "# Plan\n");
  await fs.writeFile(path.join(outside, "private.txt"), "outside allowed folders");
  await fs.writeFile(path.join(shared, "empty.dat"), "");
  await fs.mkdir(path.join(shared, "demos"));

  // Without a project, relative paths start in the shared folder; both are readable.
  assert.equal((await list_dir.run({})).path, shared);
  assert.equal((await list_dir.run({ roots: [project] })).path, project);
  assert.equal(
    (await read_file.run({ path: path.join(project, "plan.md"), roots: [project] }, {})).text,
    "# Plan\n",
  );

  const sent = [];
  const context = {
    uploadFile: async (file, metadata) => {
      sent.push({ data: await fs.readFile(file), metadata });
      return {
        file: "downloads/0123456789abcdef.mov",
        filename: metadata.filename,
        mime_type: "video/quicktime",
        bytes: original.length,
      };
    },
  };
  const uploaded = await upload_file.run({ path: "clip.mov" }, context);
  assert.deepEqual(sent[0].data, original);
  assert.deepEqual(sent[0].metadata, { filename: "clip.mov" });
  assert.equal(uploaded.ref, "01234567");
  assert.equal(uploaded.local_path, path.join(shared, "clip.mov"));
  assert.deepEqual(uploaded.attachments, [
    {
      kind: "download",
      file: "downloads/0123456789abcdef.mov",
      mime_type: "video/quicktime",
      filename: "clip.mov",
      title: "clip.mov",
      bytes: original.length,
    },
  ]);
  await assert.rejects(upload_file.run({ path: "demos" }, context), /not a folder/);
  await assert.rejects(upload_file.run({ path: "empty.dat" }, context), /empty file/);
  await fs.truncate(path.join(shared, "empty.dat"), 200 * 1024 * 1024 + 1);
  await assert.rejects(upload_file.run({ path: "empty.dat" }, context), /200 MB/);
  await assert.rejects(
    upload_file.run({ path: path.join(outside, "private.txt") }, context),
    /Not in the working folder or a project folder/,
  );
  assert.equal(sent.length, 1);
});
