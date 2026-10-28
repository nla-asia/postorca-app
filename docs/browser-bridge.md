# Browser Bridge developer resources

PostOrca Browser Bridge supports PostOrca and compatible local companions selected in its Connection settings. The extension has no separate login, agent, or cloud backend. A companion supplies browser tasks and determines data processing.

- Public protocol and setup guide: [website source](../apps/website/app/developers/browser-bridge/page.tsx), published at https://orca.atpa.site/developers/browser-bridge.
- Standalone Node.js example and integration instructions: [examples/browser-companion/README.md](../examples/browser-companion/README.md).
- Store copy, permission justifications, and reviewer steps: [chrome-web-store.md](chrome-web-store.md).

Run the example directly from a checkout with `node examples/browser-companion/cli.cjs help` after `npm install`. Generate the independent download with `npm run browser:bridge:package`. Website dev/build commands generate it automatically from an explicit source-file allowlist. The downloaded package bundles the relay and host code and needs only Node.js and `ws`; it does not load Electron or connect to the PostOrca API.

The default host remains `com.postorca.browser`; the example registers the separate `com.postorca.browser.example` host. Third-party apps should use their own unique native host names. There is one selected host per extension/profile. Credentials come only from that installed native host; users cannot point the extension to an arbitrary remote WebSocket server.

The native host response, handshake, message schemas, heartbeat behavior, ownership routing, reconnect cleanup, child sessions, and CDP compatibility limitations are documented in the public guide. Tab routing checks are not a separate browser profile or security sandbox: companions are trusted local software with access to signed-in page data through supported debugging commands. Each integration needs its own task authorization and privacy controls.
