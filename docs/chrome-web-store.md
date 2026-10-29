# Chrome Web Store submission copy

## Listing

**Name:** PostOrca Browser Bridge

**Summary (matches manifest):** Connect PostOrca or a compatible local AI agent to Chrome for browser tasks using your existing sign-ins.

**Category:** Workflow & Planning (choose the closest available productivity category in the dashboard).

**Homepage:** https://orca.atpa.site

**Privacy policy:** https://orca.atpa.site/privacy

**Developer guide:** https://orca.atpa.site/developers/browser-bridge

**Support:** nla@autopilotstartup.com

### Detailed description

Let your AI agent work in your browser.

PostOrca Browser Bridge connects Chrome to the PostOrca desktop app or a compatible local companion. An agent can open pages, read content, interact with websites, and capture screenshots using your existing signed-in sessions.

Browser tasks run in tabs opened by the bridge, normally organized in a green Orca tab group. Some tasks use a separate window. Chrome displays its debugging indicator while tabs are controlled. You can close bridge tabs, cancel debugging, disable the extension, or stop the companion.

For developers:

Developers can integrate their own AI agents or desktop software by implementing the extension's native messaging and authenticated local WebSocket protocol. Integration documentation is available in our developer guide. Third-party integrations require development and setup; existing agents do not connect automatically.

Requirements:

- Chrome 125 or newer.
- PostOrca desktop, or separately installed compatible companion software.

The extension itself has no separate login or AI model. It shares browser-task data with the companion you select. PostOrca's desktop integration uses the PostOrca service and AI provider; independent companions determine their own data processing. Review the extension and companion privacy policies before connecting.

Developer guide: https://orca.atpa.site/developers/browser-bridge
Privacy policy: https://orca.atpa.site/privacy

## Privacy practices and permission explanations

**Single purpose:** Connect a user-selected, locally installed companion to Chrome so it can carry out browser automation in tabs opened by the bridge, using the user's existing browser sessions.

| Permission | Justification |
| --- | --- |
| `debugger` | Attach to bridge-created tabs and use Chrome DevTools Protocol to inspect pages, perform browser actions, and capture requested screenshots. Required for the extension's core local browser-automation bridge. |
| `tabGroups` | Organize bridge-created tabs in the named green Orca group so users can identify automation tabs. |
| `storage` | Save the selected native host and browser-profile identifier locally; keep connection status and bridge-owned tab IDs in session storage. |
| `alarms` | Retry pairing with the selected local companion after service-worker idle periods or when the companion becomes available. |
| `nativeMessaging` | Ask the installed, user-selected native host for the loopback relay port and per-run secret. |

There are no host permissions, content scripts, or `tabs` permission. Ordinary tab creation/query/activation does not require `tabs`; sensitive metadata is obtained through the attached debugger for owned tabs. No remote code is loaded into the extension service worker or popup. Companion-supplied page evaluation can run through the Debugger API's documented MV3 exemption; disclose that behavior in the dashboard's remote-code field rather than claiming there is no externally supplied logic. The native companion/agent supplies task instructions; debugger calls are limited by Chrome's API and the bridge's routing. See the [MV3 policy](https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements).

**Data categories to disclose:** Website content, web history/activity (URLs and titles for bridge tasks, not a browser-history database scan), user activity (task interactions), and authentication information where task-related protocol data includes session/authentication material. Tasks can also expose personally identifiable information, personal communications, financial information, or health information on signed-in pages; assess the dashboard definitions against supported tasks instead of making a blanket "no data collected" claim. The profile UUID is a persistent identifier. Keep actual dashboard selections consistent with the policy and supported companions. Local processing also counts as data handling.

## Reviewer test instructions

1. Install the submitted extension on Chrome 125+ and note its assigned extension ID.
2. Install and open the PostOrca desktop app using the installer supplied with the submission. Sign in using the reviewer account provided in the dashboard's private test instructions. The PostOrca API must be available for this product test.
3. In the extension's Connection settings, select Use PostOrca. Confirm "Connected to PostOrca" in the popup.
4. In PostOrca, ask Orca to open https://example.com and report the page title. Verify that the task opens a tab in the green Orca group and returns the page title.
5. Close the task's tab or cancel its Chrome debugger attachment to verify user control. Quit PostOrca and check that the extension reports disconnection.

Before submission, supply a working desktop installer URL, reviewer credentials, and any account-specific steps in the private dashboard instructions. Verify that the desktop's native host accepts the actual submitted extension ID. Third-party integration is a developer capability described in the listing, not a separate demo reviewers must download.

## Remaining submission gates

- Deploy the website with the privacy page and developer guide. Verify each live URL; no separate companion download is required.
- Upload the extension ZIP as a draft and verify its store ID. Update the desktop's native host and relay expectations if the store ID differs from its development ID.
- Capture extension-specific screenshots for the listing: connected popup, connection settings, and a browser task in the green group. Website privacy screenshots are review evidence, not a substitute for store screenshots.
- Complete the developer account, privacy/data certifications, remote-code declaration, distribution, support information, and test instructions.
- Verify the PostOrca desktop/extension flow on every platform advertised in the submission.
