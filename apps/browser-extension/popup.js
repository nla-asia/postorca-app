const status = document.getElementById("status");
const label = document.getElementById("label");
const detail = document.getElementById("detail");
const retry = document.getElementById("retry");

function render(state) {
  status.classList.toggle("on", !!state?.connected);
  retry.hidden = !!state?.connected;
  if (state?.connected) {
    label.textContent = "Connected to PostOrca";
    detail.textContent =
      "Orca works only in tabs it opens, in the green Orca tab group.";
  } else {
    label.textContent = "Not connected";
    detail.textContent = state?.error ?? "Open the PostOrca desktop app.";
  }
}

chrome.storage.session.get("state").then(({ state }) => render(state));
chrome.storage.session.onChanged.addListener((changes) => {
  if (changes.state) render(changes.state.newValue);
});
retry.addEventListener("click", () =>
  chrome.runtime.sendMessage({ type: "reconnect" }),
);
