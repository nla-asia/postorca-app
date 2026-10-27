import assert from "node:assert/strict";
import { test } from "node:test";
import { once } from "node:events";
import nock from "nock";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createConnectorApp } from "../src/app.js";
import { composeEmail } from "../src/email.js";

test("email preserves Unicode, blank lines, header/body separator, and rejects header injection", () => {
  const body = "Hello Asia 👋\n\nKeep this paragraph.\n";
  const message = Buffer.from(
    composeEmail({ to: "founder@example.com", subject: "Update ✓", body }),
    "base64url",
  ).toString();
  const [headers, encodedBody] = message.split("\r\n\r\n");

  assert.equal(
    Buffer.from(encodedBody.replace(/\r\n/g, ""), "base64").toString(),
    body,
  );
  const subject = headers.match(/Subject: =\?UTF-8\?B\?(.+)\?=/)![1];
  assert.equal(Buffer.from(subject, "base64").toString(), "Update ✓");
  assert.ok(!headers.includes("Bcc:"));

  assert.throws(() =>
    composeEmail({
      to: "a@b.com\r\nBcc: hidden@b.com",
      subject: "x",
      body: "x",
    }),
  );
  assert.throws(() =>
    composeEmail({
      to: "a@b.com",
      subject: "x\nInjected: yes",
      body: "x",
    }),
  );
});

test("real MCP transport authenticates, exposes five tools, and isolates Google tokens", async () => {
  nock.disableNetConnect();
  nock.enableNetConnect(/^(127\.0\.0\.1|localhost)(:\d+)?$/);

  const testApiKey = "postorca-test-service-key";
  const listener = createConnectorApp(testApiKey).listen(0, "127.0.0.1");
  await once(listener, "listening");
  const port = (listener.address() as { port: number }).port;
  const baseUrl = `http://127.0.0.1:${port}`;
  const endpoint = new URL(`${baseUrl}/mcp`);

  const clients: Client[] = [];
  async function connect(token: string) {
    const client = new Client({ name: "postorca-test", version: "1" });
    clients.push(client);
    await client.connect(
      new StreamableHTTPClientTransport(endpoint, {
        requestInit: {
          headers: {
            Authorization: `Bearer ${testApiKey}`,
            "X-Google-Access-Token": token,
          },
        },
      }),
    );
    return client;
  }

  try {
    // Health check endpoint
    const health = await fetch(`${baseUrl}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: "ok" });

    // Method not allowed for non-POST /mcp with valid auth
    const getMcp = await fetch(endpoint, {
      method: "GET",
      headers: { Authorization: `Bearer ${testApiKey}` },
    });
    assert.equal(getMcp.status, 405);

    // Missing auth header
    assert.equal(
      (
        await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        })
      ).status,
      401,
    );

    // Wrong auth header
    assert.equal(
      (
        await fetch(endpoint, {
          method: "POST",
          headers: {
            Authorization: "Bearer wrong-key",
            "Content-Type": "application/json",
          },
          body: "{}",
        })
      ).status,
      401,
    );

    // Missing Google access token header
    assert.equal(
      (
        await fetch(endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${testApiKey}`,
            "Content-Type": "application/json",
          },
          body: "{}",
        })
      ).status,
      400,
    );

    const [a, b] = await Promise.all([
      connect("user-a-token"),
      connect("user-b-token"),
    ]);

    const tools = await a.listTools();
    assert.deepEqual(
      tools.tools.map((t) => t.name).sort(),
      [
        "gmail_read_emails",
        "gmail_send_email",
        "google_drive_list_drive_files",
        "google_drive_read_file",
        "google_drive_write_file",
      ],
    );

    // Test token isolation between user A and user B
    const upstreamA = nock("https://gmail.googleapis.com", {
      reqheaders: { authorization: "Bearer user-a-token" },
    })
      .get("/gmail/v1/users/me/messages")
      .query(true)
      .delay(30)
      .reply(200, { messages: [] });

    const upstreamB = nock("https://gmail.googleapis.com", {
      reqheaders: { authorization: "Bearer user-b-token" },
    })
      .get("/gmail/v1/users/me/messages")
      .query(true)
      .reply(200, { messages: [] });

    const results = await Promise.all([
      a.callTool({ name: "gmail_read_emails", arguments: { maxResults: 1 } }),
      b.callTool({ name: "gmail_read_emails", arguments: { maxResults: 1 } }),
    ]);

    for (const result of results) {
      assert.ok(!result.isError, JSON.stringify(result));
      assert.deepEqual(result.structuredContent, { emails: [], total: 0 });
    }
    assert.ok(upstreamA.isDone());
    assert.ok(upstreamB.isDone());

    // Test google_drive_list_drive_files
    const driveMock = nock("https://www.googleapis.com", {
      reqheaders: { authorization: "Bearer user-a-token" },
    })
      .get("/drive/v3/files")
      .query(true)
      .reply(200, {
        files: [{ id: "doc-1", name: "Brand guidelines", mimeType: "text/plain" }],
      });

    const listed = await a.callTool({
      name: "google_drive_list_drive_files",
      arguments: { maxResults: 1 },
    });
    assert.ok(!listed.isError, JSON.stringify(listed));
    assert.equal((listed.structuredContent as { total: number }).total, 1);
    assert.ok(driveMock.isDone());

    // Test google_drive_read_file (text file)
    const readMock = nock("https://www.googleapis.com")
      .get("/drive/v3/files/doc-1")
      .query({ fields: "id, name, mimeType, size" })
      .reply(200, {
        id: "doc-1",
        name: "Brand guidelines",
        mimeType: "text/plain",
        size: "12",
      })
      .get("/drive/v3/files/doc-1")
      .query({ alt: "media" })
      .reply(200, "hello orca");

    const file = await a.callTool({
      name: "google_drive_read_file",
      arguments: { fileId: "doc-1" },
    });
    assert.ok(!file.isError, JSON.stringify(file));
    assert.equal(
      (file.structuredContent as { content: string }).content,
      "hello orca",
    );
    assert.ok(readMock.isDone());

    // Test google_drive_write_file
    const writeMock = nock("https://www.googleapis.com")
      .post("/upload/drive/v3/files")
      .query(true)
      .reply(200, { id: "new-file-id", name: "Post Draft", mimeType: "text/plain" });

    const saved = await a.callTool({
      name: "google_drive_write_file",
      arguments: { name: "Post Draft", content: "PostOrca rocks" },
    });
    assert.ok(!saved.isError, JSON.stringify(saved));
    assert.equal(
      (saved.structuredContent as { action: string }).action,
      "created",
    );
    assert.ok(writeMock.isDone());

    // Test google_drive_read_file (Google Doc export)
    const exportDocMock = nock("https://www.googleapis.com")
      .get("/drive/v3/files/gdoc-1")
      .query({ fields: "id, name, mimeType, size" })
      .reply(200, {
        id: "gdoc-1",
        name: "Meeting Notes",
        mimeType: "application/vnd.google-apps.document",
      })
      .get("/drive/v3/files/gdoc-1/export")
      .query({ mimeType: "text/plain" })
      .reply(200, "Exported Google Doc content");

    const exportedDoc = await a.callTool({
      name: "google_drive_read_file",
      arguments: { fileId: "gdoc-1" },
    });
    assert.ok(!exportedDoc.isError, JSON.stringify(exportedDoc));
    assert.equal(
      (exportedDoc.structuredContent as { content: string }).content,
      "Exported Google Doc content",
    );
    assert.ok(exportDocMock.isDone());

    // Test google_drive_read_file rejecting binary file
    const binaryMock = nock("https://www.googleapis.com")
      .get("/drive/v3/files/binary-1")
      .query({ fields: "id, name, mimeType, size" })
      .reply(200, {
        id: "binary-1",
        name: "photo.jpg",
        mimeType: "image/jpeg",
        size: "1000",
      });

    const binaryResult = await a.callTool({
      name: "google_drive_read_file",
      arguments: { fileId: "binary-1" },
    });
    assert.ok(binaryResult.isError);
    assert.ok(binaryMock.isDone());

    // Test google_drive_write_file updating existing file (fileId)
    const updateMock = nock("https://www.googleapis.com")
      .patch("/upload/drive/v3/files/existing-file-id")
      .query(true)
      .reply(200, {
        id: "existing-file-id",
        name: "Updated Post Draft",
        mimeType: "text/plain",
      });

    const updated = await a.callTool({
      name: "google_drive_write_file",
      arguments: {
        fileId: "existing-file-id",
        name: "Updated Post Draft",
        content: "Updated content",
      },
    });
    assert.ok(!updated.isError, JSON.stringify(updated));
    assert.equal(
      (updated.structuredContent as { action: string }).action,
      "updated",
    );
    assert.ok(updateMock.isDone());

    // Test gmail_send_email
    const sendMock = nock("https://gmail.googleapis.com")
      .post("/gmail/v1/users/me/messages/send", (body) => {
        const mime = Buffer.from(body.raw, "base64url").toString();
        return (
          mime.includes("\r\n\r\n") &&
          mime.includes("Content-Type: text/plain; charset=UTF-8")
        );
      })
      .reply(200, { id: "msg-sent-id", threadId: "thread-sent-id" });

    const sent = await a.callTool({
      name: "gmail_send_email",
      arguments: {
        to: "recipient@example.com",
        subject: "Launch Day 🚀",
        body: "Hello\n\nOrca launched!",
      },
    });
    assert.ok(!sent.isError, JSON.stringify(sent));
    assert.equal(
      (sent.structuredContent as { messageId: string }).messageId,
      "msg-sent-id",
    );
    assert.ok(sendMock.isDone());

    // Test error case on invalid email input
    const invalid = await a.callTool({
      name: "gmail_send_email",
      arguments: { to: "a@b.com\nBcc: evil@b.com", subject: "test", body: "test" },
    });
    assert.ok(invalid.isError);

    // Test error case on unavailable tool
    const unavailable = await a.callTool({
      name: "non_existent_tool",
      arguments: {},
    });
    assert.ok(unavailable.isError);
  } finally {
    await Promise.all(clients.map((c) => c.close()));
    await new Promise<void>((resolve, reject) =>
      listener.close((error) => (error ? reject(error) : resolve())),
    );
    nock.cleanAll();
    nock.enableNetConnect();
  }
});
