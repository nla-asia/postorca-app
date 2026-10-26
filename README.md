# postorca-app
Personal Brand Agent for Builders

An Electron desktop application with a React and TypeScript interface and an Express API.

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
npm test
npm start
```

`npm start` opens the built interface, so run the build first. These commands run from the repository root on Windows, macOS, or Linux. Creating distributable installers is not configured yet.

## API

Run the API separately from the desktop:

```sh
npm run api:dev
```

It listens on `http://127.0.0.1:3001`. `GET /api/health` returns `{ "ok": true }` as a process liveness check. Database readiness, authentication, and agent execution are not connected yet; the desktop continues to use its local previews.

Configuration is optional. To customize it, copy `apps/api/.env.example` to `apps/api/.env` and set `PORT` or `CLIENT_ORIGINS`. Origins are comma-separated HTTP(S) origins without paths or trailing slashes. Local renderer origins are allowed by default; the `null` origin used by packaged Electron windows is also allowed. The API binds to loopback only.

`npm run build` builds both workspaces. After building, `npm run api:start` runs the compiled API. `npm test` checks configuration, HTTP responses, CORS, and error handling without external services.

## Workspace

- `apps/desktop/electron`: Electron main process and window.
- `apps/desktop/src`: React interface and styles.
- `apps/api/src`: Express app, configuration, startup, and shared error handling.
- `apps/api/tests`: API and configuration checks.

The desktop includes five sections:

- **Agent:** chat welcome screen and draft composer. Messages are not sent yet.
- **Inbox:** review, approved, and activity filters with empty work lists.
- **Calendar:** month navigation and a one-time task editor.
- **Routines:** recurring routine cards, weekday/timezone editor, pause, and delete.
- **Brand Profile:** read-only General, Audience, Voice, Colours, and Links tabs with an empty profile.

Calendar and Routines use a temporary in-memory preview adapter. Changes last until the app reloads or restarts; no scheduled tasks or routines execute. These previews make no server requests. Account, agent, and scheduling integration are coming soon.

Settings provides light, dark, and system appearance, saved on this device.
