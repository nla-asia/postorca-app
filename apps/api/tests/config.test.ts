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

test("the model provider is optional, but its key and model are set together", () => {
  const base = { DATABASE_URL: databaseUrl, JWT_SECRET: secret };
  assert.deepEqual(
    configFromEnv({ ...base, OPENAI_API_KEY: "sk-test", OPENAI_MODEL: "gpt-test" })
      .orca,
    { provider: "openai", apiKey: "sk-test", model: "gpt-test" },
  );
  assert.deepEqual(
    configFromEnv({
      ...base,
      META_MODEL_API_KEY: "meta-test",
      META_MODEL: "muse-test",
    }).orca,
    { provider: "meta", apiKey: "meta-test", model: "muse-test" },
  );
  assert.throws(
    () => configFromEnv({ ...base, OPENAI_API_KEY: "sk-test" }),
    /orca\.model: Set OPENAI_MODEL together with OPENAI_API_KEY/,
  );
  assert.throws(
    () => configFromEnv({ ...base, OPENAI_MODEL: "gpt-test" }),
    /orca\.apiKey: Set OPENAI_API_KEY together with OPENAI_MODEL/,
  );
  assert.throws(
    () => configFromEnv({ ...base, META_MODEL_API_KEY: "meta-test" }),
    /orca\.model: Set META_MODEL together with META_MODEL_API_KEY/,
  );
});

test("Meta is preferred when both providers are set, and ORCA_PROVIDER overrides it", () => {
  const env = {
    DATABASE_URL: databaseUrl,
    JWT_SECRET: secret,
    OPENAI_API_KEY: "sk-test",
    OPENAI_MODEL: "gpt-test",
    META_MODEL_API_KEY: "meta-test",
    META_MODEL: "muse-test",
  };
  assert.equal(configFromEnv(env).orca?.provider, "meta");
  assert.deepEqual(configFromEnv({ ...env, ORCA_PROVIDER: "openai" }).orca, {
    provider: "openai",
    apiKey: "sk-test",
    model: "gpt-test",
  });
  assert.throws(
    () => configFromEnv({ ...env, ORCA_PROVIDER: "other" }),
    /Set ORCA_PROVIDER to openai or meta/,
  );
  assert.throws(
    () =>
      configFromEnv({
        DATABASE_URL: databaseUrl,
        JWT_SECRET: secret,
        ORCA_PROVIDER: "meta",
      }),
    /orca\.apiKey: Set META_MODEL_API_KEY together with META_MODEL/,
  );
});
