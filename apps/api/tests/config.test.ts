import { test } from "node:test";
import assert from "node:assert/strict";
import { configFromEnv } from "../src/config.js";

test("configuration has local defaults and accepts trimmed origins", () => {
  assert.deepEqual(configFromEnv({}), {
    port: 3001,
    origins: ["http://127.0.0.1:5173", "http://localhost:5173"],
  });
  assert.deepEqual(
    configFromEnv({
      PORT: "4100",
      CLIENT_ORIGINS: " https://app.example.com , http://localhost:5173 ",
    }),
    {
      port: 4100,
      origins: ["https://app.example.com", "http://localhost:5173"],
    },
  );
});

test("invalid ports and non-origin URLs fail before the server starts", () => {
  for (const port of ["", "0", "-1", "65536", "1.5", "invalid"]) {
    assert.throws(
      () => configFromEnv({ PORT: port }),
      /Invalid API configuration: port/,
    );
  }
  for (const origin of [
    "",
    "*",
    "null",
    "file://",
    "https://example.com/path",
    "https://example.com/",
    "https://user:password@example.com",
  ]) {
    assert.throws(
      () => configFromEnv({ CLIENT_ORIGINS: origin }),
      /Invalid API configuration: origins/,
    );
  }
});
