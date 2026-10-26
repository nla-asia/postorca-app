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

Copy `apps/api/.env.example` to `apps/api/.env`, set `DATABASE_URL` to your PostgreSQL database, and replace the example `JWT_SECRET` with a random secret of at least 32 characters. Generate one with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. For the optional project-local database, the example URL uses port 55433 and the `postorca` database. Start it in a separate terminal:

```sh
npm run db:local
```

This uses embedded PostgreSQL without a global installation and keeps its cluster in `apps/api/.data/postgres`. It only manages the `postorca` database on `127.0.0.1`. Keep this process running while using the API. An external PostgreSQL database can be used instead by setting `DATABASE_URL` and skipping `db:local`.

Apply migrations, then start the API from another terminal:

```sh
npm run db:migrate
npm run api:dev
```

It listens on `http://127.0.0.1:3001` after checking the database connection. `GET /api/health` queries PostgreSQL before returning `{ "ok": true }`. Account endpoints are available; the desktop login flow and agent execution are not connected yet. The desktop continues to use its local previews.

`DATABASE_URL` and `JWT_SECRET` are required. `PORT` and `CLIENT_ORIGINS` are optional. Origins are comma-separated HTTP(S) origins without paths or trailing slashes. Local renderer origins are allowed by default; the `null` origin used by packaged Electron windows is also allowed. The API binds to loopback only.

Migrations run in filename order within one transaction and an advisory lock; applied files are recorded in `schema_migrations`. The initial schema includes `users` and `brand_profiles`, with profiles keyed by user ID and cascading profile deletion. Run migrations explicitly when setting up or updating the database.

`npm run build` builds both workspaces, including the API's SQL files. After building, `npm run api:start` runs the compiled API; `node apps/api/dist/migrate.js` runs compiled migrations. `npm test` checks the API and database against isolated temporary PostgreSQL instances, including concurrent migrations, constraints, and rollback. Tests do not use your configured database.

## Accounts

| Method | Endpoint | Behavior |
| --- | --- | --- |
| POST | `/api/auth/register` | Accepts `name`, `email`, and `password`; creates an account and empty brand profile; returns `{user, token}`. |
| POST | `/api/auth/login` | Accepts `email` and `password`; returns `{user, token}`. |
| GET | `/api/auth/me` | Accepts `Authorization: Bearer <token>`; returns `{user}` for the signed-in account. |

Emails are trimmed and lowercased. Registration requires an eight-character password; stored passwords use salted scrypt hashes. User responses contain only `id`, `name`, and `email`.

User tokens use HS256, expire after 12 hours, and are scoped to the PostOrca desktop app. Token refresh and revocation are not implemented. All authentication routes share a limit of 60 requests per IP per 15 minutes. The optional `X-Timezone` header saves a recognized PostgreSQL timezone on registration, login, or session restore; unknown zones are ignored.

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
