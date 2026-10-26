# postorca-app
Personal Brand Agent for Builders

An Electron desktop application with a React and TypeScript interface.

## Development

Use Node.js 22.12 or newer and npm 11.

```sh
npm install
npm run dev
```

The development command starts the renderer at `http://127.0.0.1:5173` and opens the desktop window. Quit the desktop app or press Ctrl+C to stop development.

## Checks and build

```sh
npm run check
npm run build
npm start
```

`npm start` opens the built interface, so run the build first. These commands run from the repository root on Windows, macOS, or Linux. Creating distributable installers is not configured yet.

## Workspace

- `apps/desktop/electron`: Electron main process and window.
- `apps/desktop/src`: React interface and styles.

The desktop shell includes sidebar navigation for Agent, Inbox, Calendar, Routines, and Brand Profile. Each section currently displays a placeholder. Settings provides light, dark, and system appearance, saved on this device. Account and agent features are not connected yet.
