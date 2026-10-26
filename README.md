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

The desktop includes five sections:

- **Agent:** chat welcome screen and draft composer. Messages are not sent yet.
- **Inbox:** review, approved, and activity filters with empty work lists.
- **Calendar:** month navigation and a one-time task editor.
- **Routines:** recurring routine cards, weekday/timezone editor, pause, and delete.
- **Brand Profile:** read-only General, Audience, Voice, Colours, and Links tabs with an empty profile.

Calendar and Routines use a temporary in-memory preview adapter. Changes last until the app reloads or restarts; no scheduled tasks or routines execute. These previews make no server requests. Account, agent, and scheduling integration are coming soon.

Settings provides light, dark, and system appearance, saved on this device.
