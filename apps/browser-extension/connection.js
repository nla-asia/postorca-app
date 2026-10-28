export const DEFAULT_NATIVE_HOST = "com.postorca.browser";

export function nativeHost(value = DEFAULT_NATIVE_HOST) {
  if (typeof value !== "string" || value.length > 255 || !/^[a-z0-9_]+(?:\.[a-z0-9_]+)*$/.test(value)) {
    throw new Error("Enter a native messaging host name such as com.example.agent.");
  }
  return value;
}

export function pairingDetails(value) {
  if (!value?.ok) throw new Error("The selected companion is not running. Start it and try again.");
  if (!Number.isInteger(value.port) || value.port < 1 || value.port > 65535 ||
      typeof value.secret !== "string" || !/^[a-f0-9]{64}$/i.test(value.secret)) {
    throw new Error("The companion returned invalid local connection details.");
  }
  return value;
}
