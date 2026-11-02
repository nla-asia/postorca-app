import { DEFAULT_NATIVE_HOST, nativeHost } from "./connection.js";

const host = document.getElementById("host");
const result = document.getElementById("result");
chrome.storage.local.get("nativeHost").then((saved) => {
  host.value = saved.nativeHost ?? DEFAULT_NATIVE_HOST;
});
document.getElementById("connection").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const value = nativeHost(host.value.trim());
    await chrome.storage.local.set({ nativeHost: value });
    host.value = value;
    result.textContent = "Saved. Start your companion, then check the extension popup for connection status.";
  } catch (error) {
    result.textContent = error.message;
  }
});
document.getElementById("reset").addEventListener("click", async () => {
  host.value = DEFAULT_NATIVE_HOST;
  await chrome.storage.local.set({ nativeHost: DEFAULT_NATIVE_HOST });
  result.textContent = "PostOrca selected. Open the PostOrca desktop app to connect.";
});
