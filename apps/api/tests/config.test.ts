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

test("Orca's provider and model are chosen explicitly; keys alone choose nothing", () => {
  const base = {
    DATABASE_URL: databaseUrl,
    JWT_SECRET: secret,
    OPENAI_API_KEY: "sk-test",
    META_MODEL_API_KEY: "meta-test",
  };
  assert.equal(configFromEnv(base).orca, null);
  assert.deepEqual(
    configFromEnv({ ...base, ORCA_PROVIDER: "meta", ORCA_MODEL: "muse-spark-1.3" })
      .orca,
    { provider: "meta", model: "muse-spark-1.3", apiKey: "meta-test" },
  );
  assert.deepEqual(
    configFromEnv({ ...base, ORCA_PROVIDER: "openai", ORCA_MODEL: "gpt-6-luna" })
      .orca,
    { provider: "openai", model: "gpt-6-luna", apiKey: "sk-test" },
  );
  assert.throws(
    () => configFromEnv({ ...base, ORCA_PROVIDER: "meta", ORCA_MODEL: "gpt-6-luna" }),
    /orca\.model: Set ORCA_MODEL to muse-wonder-1\.0 or muse-spark-1\.3 for meta/,
  );
  assert.throws(
    () => configFromEnv({ ...base, ORCA_MODEL: "muse-spark-1.3" }),
    /Set ORCA_PROVIDER to openai or meta/,
  );
  assert.throws(
    () => configFromEnv({ ...base, ORCA_PROVIDER: "other", ORCA_MODEL: "x" }),
    /Set ORCA_PROVIDER to openai or meta/,
  );
  assert.throws(
    () =>
      configFromEnv({
        DATABASE_URL: databaseUrl,
        JWT_SECRET: secret,
        ORCA_PROVIDER: "meta",
        ORCA_MODEL: "muse-spark-1.3",
      }),
    /orca\.apiKey: Set META_MODEL_API_KEY for ORCA_PROVIDER=meta/,
  );
});

test("the image model is chosen explicitly and the OpenAI image key never falls back to the chat key", () => {
  const base = {
    DATABASE_URL: databaseUrl,
    JWT_SECRET: secret,
    OPENAI_API_KEY: "sk-chat",
    META_MODEL_API_KEY: "meta-test",
  };
  assert.equal(configFromEnv(base).images, null);
  assert.deepEqual(
    configFromEnv({ ...base, IMAGE_PROVIDER: "meta", IMAGE_MODEL: "muse-image-1.0" })
      .images,
    { provider: "meta", model: "muse-image-1.0", apiKey: "meta-test" },
  );
  assert.throws(
    () =>
      configFromEnv({
        ...base,
        IMAGE_PROVIDER: "openai",
        IMAGE_MODEL: "gpt-image-2.5-flare",
      }),
    /images\.apiKey: Set OPENAI_IMAGE_API_KEY for IMAGE_PROVIDER=openai/,
  );
  assert.throws(
    () =>
      configFromEnv({ ...base, IMAGE_PROVIDER: "meta", IMAGE_MODEL: "muse-spark-1.3" }),
    /images\.model: Set IMAGE_MODEL to muse-image-1\.0 for meta/,
  );
});
