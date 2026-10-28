import { test } from "node:test";
import assert from "node:assert/strict";
import { nativeHost, DEFAULT_NATIVE_HOST, pairingDetails } from "../connection.js";

test("only registered native host names are accepted, never remote URLs", () => {
  assert.equal(nativeHost(), DEFAULT_NATIVE_HOST);
  assert.equal(nativeHost("com.example.my_agent"), "com.example.my_agent");
  for (const value of ["wss://example.com", "localhost:1234", ".bad", "bad..host", "Upper.Case", "host\nname", "a".repeat(256), null]) {
    assert.throws(() => nativeHost(value), /native messaging host name/);
  }
});

test("pairing requires a valid loopback port and a 32-byte hexadecimal secret", () => {
  const valid = { ok: true, port: 12345, secret: "ab".repeat(32) };
  assert.equal(pairingDetails(valid), valid);
  assert.throws(() => pairingDetails({ ok: false }), /not running/);
  for (const patch of [{ port: 0 }, { port: 65536 }, { port: "1234" }, { secret: "weak" }, { secret: "zz".repeat(32) }]) {
    assert.throws(() => pairingDetails({ ...valid, ...patch }), /invalid local connection/);
  }
});
