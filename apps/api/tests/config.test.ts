import { test } from "node:test";
import assert from "node:assert/strict";
import { configFromEnv } from "../src/config.js";
const databaseUrl = "postgresql://postorca:test@127.0.0.1:55433/postorca_test";

test("configuration has local defaults and accepts trimmed origins", () => {
  assert.deepEqual(configFromEnv({ DATABASE_URL: databaseUrl }), {
    databaseUrl,
    port: 3001,
    origins: ["http://127.0.0.1:5173", "http://localhost:5173"],
  });
  assert.deepEqual(
    configFromEnv({
      DATABASE_URL: databaseUrl,
      PORT: "4100",
      CLIENT_ORIGINS: " https://app.example.com , http://localhost:5173 ",
    }),
    {
      databaseUrl,
      port: 4100,
      origins: ["https://app.example.com", "http://localhost:5173"],
    },
  );
});

test("invalid ports and non-origin URLs fail before the server starts", () => {
  for (const port of ["", "0", "-1", "65536", "1.5", "invalid"]) {
    assert.throws(
      () => configFromEnv({ DATABASE_URL: databaseUrl, PORT: port }),
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
      () =>
        configFromEnv({ DATABASE_URL: databaseUrl, CLIENT_ORIGINS: origin }),
      /Invalid API configuration: origins/,
    );
  }
});

test("database configuration is required", () => {
  assert.throws(() => configFromEnv({}), /DATABASE_URL is required/);
  assert.throws(
    () => configFromEnv({ DATABASE_URL: "" }),
    /DATABASE_URL is required/,
  );
});
