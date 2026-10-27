const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { fetchBrowserFile } = require("./fetch-file.cjs");
const page = { url: () => "https://example.com/private" };

test("session fetch reads binary chunks, includes browser credentials and closes its stream", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "orca-fetch-"));
  const data = Buffer.from([0, 255, 128, 10, 65]);
  let reads = 0;
  const sent = [];
  const session = {
    send: async (method, params) => {
      sent.push({ method, params });
      if (method === "Page.getFrameTree")
        return { frameTree: { frame: { id: "owned-frame" } } };
      if (method === "Network.loadNetworkResource")
        return {
          resource: {
            success: true,
            httpStatusCode: 200,
            stream: "stream",
            headers: {
              "Content-Type": "application/octet-stream",
              "Set-Cookie": "one=private\ntwo=private",
              "Content-Disposition": 'attachment; filename="private.dat"',
            },
          },
        };
      if (method === "IO.read")
        return ++reads === 1
          ? { data: data.toString("base64"), base64Encoded: true, eof: false }
          : { data: "", eof: true };
      if (method === "IO.close") return {};
      assert.fail(method);
    },
  };
  try {
    const result = await fetchBrowserFile(
      page,
      session,
      { url: "https://example.com/file" },
      {
        uploadFile: async (file, metadata) => {
          assert.deepEqual(await fs.readFile(file), data);
          assert.equal(metadata.filename, "private.dat");
          assert.equal(metadata.final_url, undefined);
          return {
            ...metadata,
            file: "owned-key",
            mime_type: "application/octet-stream",
            sha256: crypto.createHash("sha256").update(data).digest("hex"),
          };
        },
      },
      { directory },
    );
    assert.equal(result.bytes, 5);
    assert.equal(result.attachments[0].filename, "private.dat");
    assert.deepEqual(sent[1].params, {
      frameId: "owned-frame",
      url: "https://example.com/file",
      options: { disableCache: true, includeCredentials: true },
    });
    assert.equal(sent.at(-1).method, "IO.close");
    assert.ok(sent.every((x) => !x.method.startsWith("Orca.download")));
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("session fetch closes error/oversize streams without importing files", async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "orca-fetch-error-"),
  );
  try {
    for (const resource of [
      { success: false, httpStatusCode: 401, stream: "s" },
      {
        success: true,
        httpStatusCode: 200,
        stream: "s",
        headers: { "Content-Length": "201" },
      },
      { success: true, httpStatusCode: 200, stream: "s", headers: {} },
    ]) {
      const sent = [];
      const session = {
        send: async (method) => {
          sent.push(method);
          if (method === "Page.getFrameTree")
            return { frameTree: { frame: { id: "f" } } };
          if (method === "Network.loadNetworkResource") return { resource };
          if (method === "IO.read")
            return {
              data: Buffer.alloc(201).toString("base64"),
              base64Encoded: true,
              eof: true,
            };
          return {};
        },
      };
      await assert.rejects(
        fetchBrowserFile(
          page,
          session,
          { url: "https://example.com/file" },
          { uploadFile: async () => assert.fail("no import") },
          { directory, maxBytes: 200 },
        ),
        /HTTP 401|200 MB/,
      );
      assert.equal(sent.at(-1), "IO.close");
      assert.deepEqual(await fs.readdir(directory), []);
    }
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("session fetch cancellation closes streams that arrive after the caller stopped waiting", async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "orca-fetch-abort-"),
  );
  try {
    let finish;
    let started;
    const ready = new Promise((r) => (started = r));
    const closed = [];
    const session = {
      send: async (method, params) => {
        if (method === "Page.getFrameTree")
          return { frameTree: { frame: { id: "f" } } };
        if (method === "Network.loadNetworkResource") {
          started();
          return new Promise((r) => (finish = r));
        }
        if (method === "IO.close") {
          closed.push(params.handle);
          return {};
        }
        assert.fail(method);
      },
    };
    const controller = new AbortController();
    const pending = fetchBrowserFile(
      page,
      session,
      { url: "https://example.com/file" },
      {
        signal: controller.signal,
        uploadFile: async () => assert.fail("no import"),
      },
      { directory },
    );
    await ready;
    controller.abort();
    await assert.rejects(pending, /abort/i);
    finish({ resource: { success: true, stream: "late-stream" } });
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(closed, ["late-stream"]);
    assert.deepEqual(await fs.readdir(directory), []);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
