# PostOrca Browser Bridge: local companion example

A Node.js companion and demonstration client for PostOrca Browser Bridge. No PostOrca desktop app, API server, account, or AI key is required. The example opens an `about:blank` tab, writes a confirmation message, reads its title, and closes it. It does not send browser content to a cloud service.

Requires Node.js 22 or newer and Chrome 125 or newer. Windows and macOS registration is supported; a Linux Chrome host location is also provided. Linux and macOS installation paths have unit coverage; native launch is verified on Windows. This is a developer example, not a universal connector for agents that have not implemented the protocol.

## Install the downloadable example

Once the website is deployed:

```sh
npm install --global https://orca.atpa.site/downloads/postorca-browser-companion.tgz
postorca-browser-bridge install --extension-id YOUR_CHROME_EXTENSION_ID
postorca-browser-bridge start --extension-id YOUR_CHROME_EXTENSION_ID
```

Keep that process running. In Chrome, open the extension popup → **Connection settings**, enter `com.postorca.browser.example`, and save. Chrome must be running; the popup will show when the local companion connects. The ID is shown at `chrome://extensions` in Developer mode; use the Web Store ID for a store-installed extension.

In a second terminal:

```sh
postorca-browser-bridge demo
```

Expected output: `PostOrca bridge demo`. The demo's tab closes on completion. No external website is needed.

## Run from this repository

From the repository root, run `npm install`, then:

```sh
node examples/browser-companion/cli.cjs install --extension-id YOUR_CHROME_EXTENSION_ID
node examples/browser-companion/cli.cjs start --extension-id YOUR_CHROME_EXTENSION_ID
# In a second terminal:
node examples/browser-companion/cli.cjs demo
```

Repository use shares the pure Node relay files under `apps/desktop/electron/plugins/browser`; the downloadable package bundles those files and depends only on `ws`. `npm run browser:bridge:package` creates the download, and website builds run that command automatically. No secrets or local configuration enter the package.

## Integrate your own agent

While running, the example saves `~/.postorca-browser-companion/connection.json`:

```json
{"browsers":[{"id":"PROFILE_ID","browser":"Chrome","endpoint":"ws://127.0.0.1:PORT/cdp/SECRET/PROFILE_ID"}]}
```

Treat the endpoint as a credential: it gives control of tabs opened by the bridge. Read it from disk in your local agent; do not expose it to web pages, logs, public listeners, or another user. The file lists no browsers until pairing completes and is updated when browsers connect or disconnect. `--data-dir DIRECTORY` changes the location; use the same directory for every command.

An agent can connect using a Node WebSocket CDP client (see `demo` in `cli.cjs`) or Playwright. Install `playwright-core` in your integration and save this example as an `.mjs` file:

```js
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
const { browsers } = JSON.parse(await readFile(join(homedir(), ".postorca-browser-companion/connection.json"), "utf8"));
if (!browsers.length) throw new Error("No browser connected");
const browser = await chromium.connectOverCDP(browsers[0].endpoint);
try {
  const page = await browser.contexts()[0].newPage();
  await page.goto("https://example.com");
  console.log(await page.title());
} finally {
  await browser.close(); // closes this client's tabs, not the user's Chrome
}
```

The CDP endpoint implements the browser-level methods needed by the bridge; it is not a complete Chrome remote-debugging endpoint. Only tabs created through this connection are exposed. One automation client per browser profile is supported; a new client replaces the old one and closes its tabs. The selected companion handles authorization, user instructions, AI integration, and data retention. See the [protocol guide](https://orca.atpa.site/developers/browser-bridge) and review the extension's privacy policy before connecting.

## Stop and uninstall

Stop the running companion with Ctrl+C, then:

```sh
postorca-browser-bridge uninstall
```

This removes only the example's native-host registration and connection files. It does not unregister PostOrca's separate host. Select **Use PostOrca** in Connection settings to switch back. If using a custom data directory, pass it to `uninstall` too. After an unclean shutdown, verify the old process is stopped before removing a stale `pairing.json` and restarting.

Install/start must use the same extension ID. If PostOrca is open, changing the selected host disconnects it from this browser profile. Reconnecting closes tabs from the previous bridge session, so finish ongoing tasks first. A separate browser profile is useful when testing integrations.
