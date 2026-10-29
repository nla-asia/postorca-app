# Browser Bridge developer resources

PostOrca Browser Bridge supports PostOrca and compatible local companions selected in its Connection settings. The extension has no separate login, agent, or cloud backend. A companion supplies browser tasks and determines data processing.

- Public protocol and setup guide: [website source](../apps/website/app/developers/browser-bridge/page.tsx), published at https://orca.atpa.site/developers/browser-bridge.
- Store copy, permission justifications, and reviewer steps: [chrome-web-store.md](chrome-web-store.md).

The supported product integration is the PostOrca desktop app, using `com.postorca.browser`. Developers building third-party integrations register their own native messaging host and implement the documented protocol. There is no separate companion demo or download to install. There is one selected host per extension/profile. Credentials come only from that installed native host; users cannot point the extension to an arbitrary remote WebSocket server.

The native host response, handshake, message schemas, heartbeat behavior, ownership routing, reconnect cleanup, and child sessions are documented in the public guide. Commands are limited by Chrome's Debugger API. Tab routing checks are not a separate browser profile or security sandbox: companions are trusted local software with access to signed-in page data through supported debugging commands. Each integration needs its own task authorization and privacy controls.
