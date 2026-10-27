const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const crypto = require("node:crypto");
const { downloadPublicFile, safeFilename } = require("./download-file.cjs");

test("direct downloads follow redirects without cookies and preserve originals and safe names", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "postorca-direct-"));
  const data = Buffer.from("original file bytes");
  let requests = 0;
  const server = http.createServer((req, res) => {
    requests++;
    assert.equal(req.headers.cookie, undefined);
    assert.equal(req.headers.authorization, undefined);
    if (req.url === "/redirect") {
      res.writeHead(302, {
        Location: "/file",
        "Set-Cookie": "private=do-not-send",
      });
      res.end();
      return;
    }
    res.writeHead(200, {
      "Content-Disposition":
        "attachment; filename*=UTF-8''R%C3%A9sum%C3%A9.pdf",
    });
    res.end(data);
  });
  server.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  try {
    let importedPath;
    const result = await downloadPublicFile(
      { url: `http://127.0.0.1:${server.address().port}/redirect` },
      {
        uploadFile: async (file, metadata) => {
          importedPath = file;
          assert.deepEqual(await fs.readFile(file), data);
          assert.equal(metadata.filename, "Résumé.pdf");
          return {
            file: "test-key",
            mime_type: "application/octet-stream",
            sha256: crypto.createHash("sha256").update(data).digest("hex"),
          };
        },
      },
      { directory },
    );
    assert.equal(requests, 2);
    assert.equal(result.local_path, importedPath);
    assert.equal(path.basename(importedPath), "Résumé.pdf");
    assert.equal(result.bytes, data.length);
    assert.equal(result.attachments[0].filename, "Résumé.pdf");
    assert.doesNotMatch(safeFilename("../../CON:evil.mp3"), /[\\/:]/);
    assert.equal(safeFilename("CON.txt"), "_CON.txt");
    assert.equal(safeFilename(".."), "download");
  } finally {
    await new Promise((r) => server.close(r));
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("direct download rejects errors, invalid redirects, oversized streams and aborts without importing partials", async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "postorca-direct-errors-"),
  );
  const neverUpload = {
    uploadFile: async () => assert.fail("must not import"),
  };
  const options = { directory, maxBytes: 8 };
  try {
    await assert.rejects(
      downloadPublicFile({ url: "file:///secret" }, neverUpload, options),
      /HTTP/,
    );
    await assert.rejects(
      downloadPublicFile(
        { url: "https://user:pass@example.com/file" },
        neverUpload,
        options,
      ),
      /credentials/,
    );
    for (const status of [401, 403, 404])
      await assert.rejects(
        downloadPublicFile({ url: "https://example.com/file" }, neverUpload, {
          ...options,
          fetchImpl: async () => new Response("denied", { status }),
        }),
        new RegExp(`HTTP ${status}`),
      );
    await assert.rejects(
      downloadPublicFile(
        { url: "https://example.com/private.png", filename: "private.png" },
        neverUpload,
        {
          ...options,
          fetchImpl: async () =>
            new Response("<html>Sign in</html>", {
              headers: { "Content-Type": "text/html; charset=utf-8" },
            }),
        },
      ),
      /HTML page instead of a file/,
    );
    await assert.rejects(
      downloadPublicFile({ url: "https://example.com/file" }, neverUpload, {
        ...options,
        fetchImpl: async () =>
          new Response(null, {
            status: 302,
            headers: { Location: "file:///secret" },
          }),
      }),
      /HTTP/,
    );
    await assert.rejects(
      downloadPublicFile({ url: "https://example.com/file" }, neverUpload, {
        ...options,
        fetchImpl: async () =>
          new Response(null, { status: 302, headers: { Location: "/loop" } }),
      }),
      /Too many/,
    );
    await assert.rejects(
      downloadPublicFile({ url: "https://example.com/file" }, neverUpload, {
        ...options,
        fetchImpl: async () =>
          new Response("123456789", { headers: { "Content-Length": "9" } }),
      }),
      /200 MB/,
    );
    await assert.rejects(
      downloadPublicFile({ url: "https://example.com/file" }, neverUpload, {
        ...options,
        fetchImpl: async () => new Response("123456789"),
      }),
      /200 MB/,
    );
    await assert.rejects(
      downloadPublicFile({ url: "https://example.com/file" }, neverUpload, {
        ...options,
        fetchImpl: async () => new Response(""),
      }),
      /empty/,
    );
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode("part"));
        setTimeout(() => c.error(Error("connection lost")), 20);
      },
    });
    await assert.rejects(
      downloadPublicFile({ url: "https://example.com/file" }, neverUpload, {
        ...options,
        fetchImpl: async () => new Response(stream),
      }),
      /connection lost/,
    );
    const controller = new AbortController();
    const stalled = new ReadableStream({
      start(c) {
        c.enqueue(new Uint8Array([1]));
      },
    });
    const pending = downloadPublicFile(
      { url: "https://example.com/file" },
      { ...neverUpload, signal: controller.signal },
      { ...options, fetchImpl: async () => new Response(stalled) },
    );
    setTimeout(() => controller.abort(), 20);
    await assert.rejects(pending, /abort/i);
    assert.deepEqual(await fs.readdir(directory), []);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("a completed original remains available if attachment upload fails", async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "postorca-direct-upload-"),
  );
  try {
    let original;
    await assert.rejects(
      downloadPublicFile(
        { url: "https://example.com/file.mp3", filename: "../tone.mp3" },
        {
          uploadFile: async (file) => {
            original = file;
            throw Error("offline");
          },
        },
        { directory, fetchImpl: async () => new Response("original") },
      ),
      /saved at.*attachment import failed.*Do not download/i,
    );
    assert.equal(await fs.readFile(original, "utf8"), "original");
    assert.equal(path.dirname(path.dirname(original)), directory);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
