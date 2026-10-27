const { test } = require("node:test");
const assert = require("node:assert/strict");
const { assertFileResponse } = require("./file-transfer.cjs");
test("HTML sign-in/preview pages cannot silently become image or generic downloads; explicit HTML remains supported", () => {
  for (const name of ["photo.png", "download", "audio.mp3"])
    assert.throws(
      () => assertFileResponse("text/html; charset=utf-8", name),
      /HTML page/,
    );
  assert.throws(
    () => assertFileResponse("application/xhtml+xml", "file.pdf"),
    /HTML page/,
  );
  assert.doesNotThrow(() => assertFileResponse("text/html", "page.html"));
  assert.doesNotThrow(() => assertFileResponse("text/html", "page.htm"));
  assert.doesNotThrow(() => assertFileResponse("image/png", "photo.png"));
  assert.doesNotThrow(() =>
    assertFileResponse("application/octet-stream", "file.bin"),
  );
});
