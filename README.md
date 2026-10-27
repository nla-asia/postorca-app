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

It listens on `http://127.0.0.1:3001` after checking the database connection. `GET /api/health` queries PostgreSQL before returning `{ "ok": true }`. The desktop uses the account, Brand Profile, scheduling, and task endpoints. With a model configured, task follow-ups run Orca (see [Agent loop](#agent-loop)); saved schedules do not run yet.

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

The desktop opens with Log in and provides a Sign up form. Successful sign-in opens the workspace and shows the account name/email in the sidebar. Electron encrypts the token and API URL with `safeStorage` in the app's data directory. On restart, the saved token is validated through `/auth/me`. If OS encryption is unavailable, the session stays in memory for that launch. The preload bridge exposes only session get/set/clear to the app's top frame; renderer Node access remains disabled.

Log out clears the current session and removes the saved session file. Saved Calendar schedules and Routines stay with the account. A rejected token returns to Log in and removes the saved session; a network failure retains it for a later retry. Plain-browser development uses `sessionStorage` instead of desktop persistence. Opening the desktop again focuses the existing window rather than starting another process for the same profile.

The renderer uses `http://127.0.0.1:3001/api` by default. To change it, copy `apps/desktop/.env.example` to `apps/desktop/.env`, set `VITE_API_URL`, and restart development or rebuild. Only this API origin is added to the renderer's connection policy. Start the API before signing in.

## Brand Profile

Both endpoints require `Authorization: Bearer <token>` and use the signed-in account's profile.

| Method | Endpoint | Behavior |
| --- | --- | --- |
| GET | `/api/brand-profile` | Returns saved name, company, audience, voice, topics, colors, links, and onboarding status. |
| PUT | `/api/brand-profile` | Validates and saves a partial profile update; returns the saved profile. |

Omitted fields keep their saved values. A supplied `links` array replaces the account's links; existing IDs retain their identity and omitted publishing metadata. Changing a link URL resets its access status to `not_granted`. Foreign or duplicate link IDs are rejected. Names, context, and links save in one transaction.

Colors accept optional `background`, `text`, and `highlight` values in `#RRGGBB` format. Links accept HTTP(S) URLs, a platform kind, publishing method/instructions, and access status. Completing onboarding requires company context, primary topics, and at least one social account link. Completing a profile creates default routines for its social accounts once the account's timezone is known.

The desktop loads saved data whenever Brand Profile opens and offers a retry if loading fails. General, Audience, Voice, Colours, and Links remain read-only; editing through Orca will follow with chat integration. HTTP(S) links open in the system browser.

## Scheduling API

Recurring routines and one-time Calendar schedules share `/api/routines`. All endpoints require `Authorization: Bearer <token>` and only access the signed-in account's schedules.

| Method | Endpoint | Behavior |
| --- | --- | --- |
| GET | `/api/routines` | Lists recurring routines; `?once=true` lists one-time schedules instead. |
| POST | `/api/routines` | Creates a recurring routine or a one-time schedule and returns it. |
| PATCH | `/api/routines/:id` | Saves a partial update and returns the schedule. |
| DELETE | `/api/routines/:id` | Deletes a recurring routine or cancels a pending one-time schedule. |
| POST | `/api/routines/:id/run` | Returns 503 while execution is unavailable; creates no work. |

Recurring routines accept `platform` (`X`, `Threads`, `Instagram`, `Facebook`, or `LinkedIn`), `title`, `instructions`, `time` (`HH:MM`), `days` (ISO weekdays 1–7), `timezone`, and optional `active` (defaults to true). Days are deduplicated and sorted. PostgreSQL computes `next_run_at` strictly after now in the chosen timezone, including daylight-saving changes. Pausing clears the next run; resuming recalculates it from now.

One-time schedules accept `title`, `instructions`, `timezone`, an optional nullable `platform`, and a future `run_at` ISO timestamp with a timezone offset. They cannot take recurring fields or be converted into recurring routines. Once a one-time schedule has started, editing and cancellation return 409.

Each account can have up to 50 recurring routines and pending one-time schedules combined; paused recurring routines count toward this limit. Creation is serialized per account to enforce the limit during concurrent requests. Responses include the latest run's task ID, trigger, and live status when available. Deleting a routine keeps any work it previously produced.

The API stores schedules but does not execute them yet. Both Calendar and Routines use these endpoints. Run now stays disabled in the desktop until execution is connected.

Calendar saves one-time tasks to the signed-in account, including edits and confirmed cancellation. Schedules survive logout and app restarts. Dates are entered and displayed in the device's local timezone and sent as absolute timestamps with the timezone name. Calendar refreshes every ten seconds, or every two seconds while work is queued or running. Failed loads offer a retry, and failed saves keep the form open. Calendar and Routines work links open the corresponding Inbox detail.

Routines saves recurring work, weekday/timezone settings, pause/resume, and confirmed deletion. Cards show the next run in the routine's timezone. The list refreshes every thirty seconds, or every two seconds while work is queued or running. Failed loads offer a retry; failed edits preserve the form.

After profile completion, each social account receives its defaults once: Content ideas at 09:00 on weekdays and Weekly strategy research at 10:00 on Mondays. X, Threads, and LinkedIn also receive Conversations to join at 13:00 on weekdays. Each uses the account's timezone at creation. Website and other links have no defaults. A missing timezone postpones seeding until a valid timezone is learned through authentication.

Editing, pausing, or deleting a default does not recreate it on later profile saves or timezone changes. Social accounts added later receive their own defaults. Removing a profile link pauses its routines and clears their link reference. Seeding respects the shared 50-schedule cap and defers a link's entire set of defaults if there is insufficient room; a later profile save or timezone change can retry it.

## Tasks and review API

All task endpoints require `Authorization: Bearer <token>` and check account ownership.

| Method | Endpoint | Behavior |
| --- | --- | --- |
| POST | `/api/tasks` | Accepts `kind` (`chat`, `onboarding`, or `work`) and `title`; returns the task. |
| GET | `/api/tasks` | Lists the newest 100 tasks, optionally filtered by `?kind=work`, `chat`, or `onboarding`. |
| GET | `/api/tasks/:id` | Returns task status, ordered turns/messages, and artifacts grouped by turn. |
| PATCH | `/api/tasks/:id` | Accepts `action: "approve"` or `"archive"`; returns the task. |
| PATCH | `/api/tasks/:id/artifacts/:artifactId` | Accepts `content` and edits a document belonging to this task. Other artifact kinds are read-only. |
| POST | `/api/tasks/:id/turns` | Validates `message` and ownership, saves a queued turn, and returns it with 202 while Orca runs it in the background. Returns 503 without creating a turn when no model is configured, and 409 while the task is busy or archived. |

Each account has one chat and one onboarding conversation. Repeated creation reuses the existing conversation; work tasks remain independent. Onboarding opens once with a fixed Orca greeting and first question, completes that opening turn without a model call, and marks the profile `in_progress`. Existing history and completed profiles do not receive another opening.

Task lists include live status, the latest nonempty assistant text (up to 280 characters), and the recurring routine's title when applicable. Task details expose assistant text without provider replay data. Messages and artifacts stay associated with their own turns; document edits retain the artifact ID.

Queued or running work cannot be approved or archived. Only completed work can be approved. Repeated review actions retain their first timestamp. The turn repository permits one active turn per task, clears approval when a follow-up starts, and rejects follow-ups to archived tasks. Model-backed follow-ups and scheduled execution are not enabled yet.

Inbox uses these endpoints for saved work, details, document editing, and review. Agent chat and onboarding have not yet been connected in the desktop. Artifact generation and idea-to-content queue actions will follow with execution.

## Inbox

For review shows working, failed, and unapproved work. Approved shows approved work that is not archived. All activity includes archived work. The attention count in the sidebar and For review tab counts unapproved review items and failures; working items appear in the list without increasing that count.

Opening work shows its request, ordered replies, tool activity, status, and artifacts. Markdown renders as React elements without raw HTML; links can open HTTP(S) pages or artifacts belonging to that work. Documents can be copied and edited, with errors preserving the draft. Archived documents are read-only in the desktop. Ideas can be read, while follow-up execution and Create content remain disabled. Media viewing will follow with file delivery.

Approve and Archive save through the task API and refresh the lists. Load failures offer a retry. The Inbox list refreshes every twenty seconds, or every three seconds while work is active; an active detail refreshes every 1.5 seconds. Saved reviews and document edits survive logout and app restarts. New accounts have an empty Inbox until work is created; no example results are inserted automatically.

## Model provider

The API package includes an OpenAI Responses adapter using the pinned `openai@7.39.0` SDK. It accepts an explicit API key and model, timestamps founder messages, preserves response replay and function-call outputs, and returns text plus tool calls. Requests use `store: false` with encrypted reasoning replay, consistent with the [official Responses guidance](https://developers.openai.com/api/docs/guides/migrate-to-responses).

The adapter retains a three-minute request timeout and three SDK retries for transient failures, accepts an abort signal, distinguishes context-length failures, and rejects incomplete responses. Token statistics use a rough text estimate or the provider's reported input count against the application's 100,000-token context budget.

When a turn trace is supplied, local request/result diagnostics are written under `apps/api/.data/agent-traces/<taskId>/<turnId>/`. Traces include the prompt, conversation input, tools, usage, and short failure metadata; SDK credentials and HTTP headers are omitted. Diagnostic write failures do not interrupt execution. This directory is ignored by Git.

Set `OPENAI_API_KEY` and `OPENAI_MODEL` in `apps/api/.env` to enable it; both are required together, and without them the API starts with Orca off. Provider and loop tests use mocked transports or scripted providers and require no live credentials or model calls.

## Model context

The context layer preserves the full task history for Inbox while building a shorter model view. Once the estimated history and instructions exceed the application's 100,000-token budget, it asks the provider for a summary and saves that summary with a message checkpoint in `task_context`. The most recent four assistant steps stay verbatim, including their tool calls and results. Explicit compaction can keep fewer steps for a context-length retry. Generated summaries carry no send timestamp; real founder messages retain their timestamps.

Individual tool results are capped at 80,000 characters in the model view. Compaction clips long assistant/tool excerpts while retaining founder instructions and carries the earlier summary into its replacement. Empty summaries do not advance a checkpoint. Failed compaction leaves the history available, and cancellation still propagates. Stored messages are never replaced by the summary.

Recent PNG/JPEG tool attachments are loaded only from files owned by the task's user. Their image payloads appear for one assistant step by default, then only their references and descriptions remain. `AGENT_IMAGE_STEPS` can extend this window. Original downloads are not automatically loaded as model images, and missing files are skipped. Short file references are scoped to each user's files; ambiguous references do not resolve.

File helpers use `STORAGE_DIR` or default to `apps/api/storage/`, which is ignored by Git. The build copies prompt files as well as SQL migrations. File delivery routes are not connected yet.

## Orca's tools

`apps/api/src/tools` defines the tools Orca can call and runs them for the signed-in founder's task. Each tool keeps its JSON Schema definition next to its handler; arguments are validated again on the server, and refusals come back as messages Orca can act on.

| Group | Tools | Behavior |
| --- | --- | --- |
| Brand Profile | `read_brand_profile`, `update_brand_profile`, `save_brand_link`, `delete_brand_link` | Profile updates never touch links. Links are saved or deleted one at a time with owned IDs; a changed URL resets access. Completing the profile or adding a social link seeds default routines; deleting a link pauses its routines, and deleting the last link reopens onboarding. |
| Artifacts | `create_artifact`, `read_artifact`, `edit_document`, `delete_artifact`, `list_content_ideas` | Documents, ideas, and HTTP(S) links belong to the calling task. Documents are revised in place with exact find/replace edits that must each match once, or replaced whole; a failed edit saves nothing. Ideas list the founder's recent, unarchived ideas and whether content is queued. |
| Memory | `search_memory`, `read_memory`, `save_memory`, `delete_memory` | Markdown files per founder under `STORAGE_DIR/users/<id>/memory/`, each starting with a description line. Search works like `grep -i`. Paths are lowercase, at most three levels deep, and files are written atomically. |
| Chat only | `start_task`, `get_task`, `follow_up_task`, `request_user_input` | Agent chat and onboarding can start background work, read it, send it a follow-up, or ask one multiple-choice question. Background work is never offered these tools. Starting or following up work requires a running worker and otherwise returns 503. |

Image, audio, and video artifacts arrive with file tools.

## Agent loop

`apps/api/src/agent/loop.ts` runs one turn: it claims the queued turn (so repeated dispatches run it once), builds Orca's instructions, asks the model for a response, saves it, runs each tool call, and saves each result, repeating until Orca answers without calling tools. A `request_user_input` question also ends the turn until the founder replies. Instructions combine `agent/prompts/system.md` with the brand profile (re-read each step), the founder's memory index (read once per turn), and the chat, onboarding, or work section for the task.

Chat and onboarding turns allow 30 responses in 6 minutes; Inbox work allows 100 in 45 minutes. The last response is offered no tools and told to report what is unfinished, so long turns end with an answer. Tool refusals, invalid arguments, and malformed JSON go back to Orca as messages it can correct; other tool failures stay generic. If the model reports a context-length error, the loop compacts down to the current step and retries once.

A failed turn saves a short message for the founder (time limit, action limit, restart, or a generic failure) and writes the cause to the local turn trace. The router runs turns in the background after their turn is committed. On shutdown it stops running turns, which fail asking for a follow-up; on startup, turns left queued or running by the previous process are marked failed.

Agent chat and onboarding are not yet connected in the desktop, routine runs and the scheduler are not connected, and desktop notifications for finished work are not implemented.

## Workspace

- `apps/desktop/electron`: Electron main process and window.
- `apps/desktop/src`: React interface and styles.
- `apps/api/src`: Express app, configuration, startup, and shared error handling.
- `apps/api/tests`: API and configuration checks.

The desktop includes five sections:

- **Agent:** chat welcome screen and draft composer. Messages are not sent yet.
- **Inbox:** saved work filters, task details, document editing, approval, and archive.
- **Calendar:** month navigation and persistent one-time task creation, editing, and cancellation.
- **Routines:** persistent recurring routines, weekday/timezone editor, next-run times, pause/resume, and confirmed deletion.
- **Brand Profile:** read-only General, Audience, Voice, Colours, and Links tabs showing saved account data.

Calendar and Routines persist their settings on the server. Inbox displays saved work. No scheduled tasks or routines execute yet; agent execution is coming soon.

Settings provides light, dark, and system appearance, saved on this device.
