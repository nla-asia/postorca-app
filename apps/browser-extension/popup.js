const status = document.getElementById("status");
const label = document.getElementById("label");
const detail = document.getElementById("detail");
const retry = document.getElementById("retry");

function render(state) {
  status.classList.toggle("on", !!state?.connected);
  retry.hidden = !!state?.connected;
  if (state?.connected) {
    label.textContent = state.nativeHost === "com.postorca.browser" ? "Connected to PostOrca" : "Connected to local companion";
    detail.textContent =
      "The companion controls tabs opened by this bridge, normally in the green Orca group. Page content and screenshots are shared with that companion.";
  } else {
    label.textContent = "Not connected";
    detail.textContent = state?.error ?? "Start PostOrca or your selected local companion.";
  }
}

chrome.storage.session.get("state").then(({ state }) => render(state));
chrome.storage.session.onChanged.addListener((changes) => {
  if (changes.state) render(changes.state.newValue);
});
retry.addEventListener("click", () =>
  chrome.runtime.sendMessage({ type: "reconnect" }),
);
document.getElementById("settings").addEventListener("click", () => chrome.runtime.openOptionsPage());
