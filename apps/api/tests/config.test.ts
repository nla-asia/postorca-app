import { test } from "node:test";
import assert from "node:assert/strict";
import { configFromEnv } from "../src/config.js";
const databaseUrl = "postgresql://postorca:test@127.0.0.1:55433/postorca_test";
const secret = "test-only-secret-at-least-32-characters";

test("configuration has local defaults and accepts trimmed origins", () => {
  assert.deepEqual(
    configFromEnv({ DATABASE_URL: databaseUrl, JWT_SECRET: secret }),
    {
      databaseUrl,
      jwtSecret: secret,
      port: 3001,
      origins: ["http://127.0.0.1:5173", "http://localhost:5173"],
      orca: null,
      images: null,
    },
  );
  assert.deepEqual(
    configFromEnv({
      DATABASE_URL: databaseUrl,
      JWT_SECRET: secret,
      PORT: "4100",
      CLIENT_ORIGINS: " https://app.example.com , http://localhost:5173 ",
    }),
    {
      databaseUrl,
      jwtSecret: secret,
      port: 4100,
      origins: ["https://app.example.com", "http://localhost:5173"],
      orca: null,
      images: null,
    },
  );
});

test("invalid ports and non-origin URLs fail before the server starts", () => {
  for (const port of ["", "0", "-1", "65536", "1.5", "invalid"]) {
    assert.throws(
      () =>
        configFromEnv({
          DATABASE_URL: databaseUrl,
          JWT_SECRET: secret,
          PORT: port,
        }),
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
        configFromEnv({
          DATABASE_URL: databaseUrl,
          JWT_SECRET: secret,
          CLIENT_ORIGINS: origin,
        }),
      /Invalid API configuration: origins/,
    );
  }
});

test("signing secrets must contain at least 32 characters", () => {
  for (const value of [undefined, "", "too-short"]) {
    assert.throws(
      () => configFromEnv({ DATABASE_URL: databaseUrl, JWT_SECRET: value }),
      /JWT_SECRET must contain at least 32 characters/,
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

test("models come from settings; a key only turns its model on", () => {
  const base = { DATABASE_URL: databaseUrl, JWT_SECRET: secret };
  assert.equal(configFromEnv(base).orca, null);
  assert.equal(configFromEnv(base).images, null);
  // Keys for other providers change nothing.
  assert.equal(
    configFromEnv({ ...base, OPENAI_API_KEY: "sk", OPENAI_IMAGE_API_KEY: "img" })
      .orca,
    null,
  );
  const config = configFromEnv({ ...base, META_MODEL_API_KEY: "meta-test" });
  assert.deepEqual(config.orca, {
    provider: "meta",
    model: "muse-spark-1.3",
    apiKey: "meta-test",
  });
  assert.deepEqual(config.images, {
    provider: "meta",
    model: "muse-image-1.0",
    apiKey: "meta-test",
  });
});

test("a chosen model must be priced, and the OpenAI image key never falls back to the chat key", () => {
  const env = {
    DATABASE_URL: databaseUrl,
    JWT_SECRET: secret,
    OPENAI_API_KEY: "sk-chat",
  };
  assert.deepEqual(
    configFromEnv(env, { orca: { provider: "openai", model: "gpt-6-luna" } })
      .orca,
    { provider: "openai", model: "gpt-6-luna", apiKey: "sk-chat" },
  );
  assert.equal(
    configFromEnv(env, {
      images: { provider: "openai", model: "gpt-image-2.5-flare" },
    }).images,
    null,
  );
  assert.throws(
    () => configFromEnv(env, { orca: { provider: "meta", model: "gpt-6-luna" } }),
    /settings\.orca\.model must be muse-wonder-1\.0 or muse-spark-1\.3 for meta/,
  );
});
