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

It listens on `http://127.0.0.1:3001` after checking the database connection. `GET /api/health` queries PostgreSQL before returning `{ "ok": true }`. The desktop uses the account, Brand Profile, scheduling, task, and desktop endpoints. With a model configured, messages and follow-ups run Orca (see [Agent loop](#agent-loop)) and saved schedules run on time.

`DATABASE_URL` and `JWT_SECRET` are required. `PORT` and `CLIENT_ORIGINS` are optional. Origins are comma-separated HTTP(S) origins without paths or trailing slashes. Local renderer origins are allowed by default; the `null` origin used by packaged Electron windows is also allowed. The API binds to loopback only.

Migrations run in filename order within one transaction and an advisory lock; applied files are recorded in `schema_migrations`. The initial schema includes `users` and `brand_profiles`, with profiles keyed by user ID and cascading profile deletion. Each migration run also syncs the plugin and skill catalog from code (see [Skills and plugins](#skills-and-plugins)). Run migrations explicitly when setting up or updating the database.

`npm run build` builds both workspaces, including the API's SQL files. After building, `npm run api:start` runs the compiled API; `node apps/api/dist/migrate.js` runs compiled migrations. `npm test` checks the API and database against isolated temporary PostgreSQL instances, including concurrent migrations, constraints, and rollback. Tests do not use your configured database.

## Accounts

| Method | Endpoint | Behavior |
| --- | --- | --- |
| POST | `/api/auth/register` | Accepts `name`, `email`, and `password`; creates an account and empty brand profile; returns `{user, token}`. |
| POST | `/api/auth/login` | Accepts `email` and `password`; returns `{user, token}`. |
| GET | `/api/auth/me` | Accepts `Authorization: Bearer <token>`; returns `{user}` for the signed-in account. |

Emails are trimmed and lowercased. Registration requires an eight-character password; stored passwords use salted scrypt hashes. User responses contain only `id`, `name`, and `email`.

User access tokens use HS256, expire after 15 minutes, and are scoped to the PostOrca desktop app. Each sign-in also starts a session with a rotating refresh token: `POST /api/auth/refresh` spends it and returns a new access and refresh token, a token reused after a 60-second retry window revokes the whole session, sessions end after 30 days without a refresh, and `POST /api/auth/logout` ends one session. Only SHA-256 hashes of refresh tokens are stored. All authentication routes share a limit of 60 requests per IP per 15 minutes. The optional `X-Timezone` header saves a recognized PostgreSQL timezone on registration, login, or session restore; unknown zones are ignored.

The desktop opens with Log in and provides a Sign up form. Successful sign-in opens the workspace and shows the account name/email in the sidebar. Electron encrypts the token and API URL with `safeStorage` in the app's data directory. On restart, the saved token is validated through `/auth/me`. If OS encryption is unavailable, the session stays in memory for that launch. The preload bridge exposes only session get/set/clear to the app's top frame; renderer Node access remains disabled.

Log out clears the current session and removes the saved session file. Saved Calendar schedules and Routines stay with the account. A rejected token returns to Log in and removes the saved session; a network failure retains it for a later retry. Plain-browser development uses `sessionStorage` instead of desktop persistence. Opening the desktop again focuses the existing window rather than starting another process for the same profile.

The renderer uses `http://127.0.0.1:3001/api` by default. To change it, copy `apps/desktop/.env.example` to `apps/desktop/.env`, set `VITE_API_URL`, and restart development or rebuild. Only this API origin is added to the renderer's connection policy. Start the API before signing in.

## Brand Profile

These endpoints require `Authorization: Bearer <token>` and use the signed-in account's profile.

| Method | Endpoint | Behavior |
| --- | --- | --- |
| GET | `/api/brand-profile` | Returns saved name, company, audience, voice, topics, colors, links, project folders, and onboarding status. |
| PUT | `/api/brand-profile` | Validates and saves a partial profile update; returns the saved profile. |
| POST | `/api/brand-profile/projects` | Adds a project folder (`name`, local `path`, optional `description`); 201 with the project and `createdRoutine`. 409 for a folder already added; up to 20 projects. |
| PATCH | `/api/brand-profile/projects/:id` | Renames a project or changes its description; the folder can't change. |
| DELETE | `/api/brand-profile/projects/:id` | Removes a project folder; Orca stops reading it. |

Omitted fields keep their saved values. A supplied `links` array replaces the account's links; existing IDs retain their identity and omitted publishing metadata. Changing a link URL resets its access status to `not_granted`. Foreign or duplicate link IDs are rejected. Names, context, and links save in one transaction.

Colors accept optional `background`, `text`, and `highlight` values in `#RRGGBB` format. Links accept HTTP(S) URLs, a platform kind, publishing method/instructions, and access status. Completing onboarding requires company context, primary topics, and at least one social account link. Completing a profile creates default routines for its social accounts once the account's timezone is known.

Project folders are where the founder builds (code, docs, designs). Their paths are local to the founder's computer and only the desktop app opens them. Adding the first one, once onboarding is complete and the timezone is known, adds an "Ideas from my work" routine at 18:00 on weekdays for the founder's X account, or otherwise their first LinkedIn, Threads, Instagram, or Facebook account. It follows the work-content-ideas skill and is added only once.

The desktop loads saved data whenever Brand Profile opens and offers a retry if loading fails. General, Audience, Voice, Colours, and Links are read-only; Orca changes them through chat. The Projects tab adds a folder with the system folder picker (desktop app only), and edits or removes projects. HTTP(S) links open in the system browser.

## Scheduling API

Recurring routines and one-time Calendar schedules share `/api/routines`. All endpoints require `Authorization: Bearer <token>` and only access the signed-in account's schedules.

| Method | Endpoint | Behavior |
| --- | --- | --- |
| GET | `/api/routines` | Lists recurring routines; `?once=true` lists one-time schedules instead. |
| POST | `/api/routines` | Creates a recurring routine or a one-time schedule and returns it. |
| PATCH | `/api/routines/:id` | Saves a partial update and returns the schedule. |
| DELETE | `/api/routines/:id` | Deletes a recurring routine or cancels a pending one-time schedule. |
| POST | `/api/routines/:id/run` | Runs a recurring routine once now (202 with its task); 409 while it is still running, 400 for one-time schedules, 503 without a model. |

Recurring routines accept `platform` (`X`, `Threads`, `Instagram`, `Facebook`, or `LinkedIn`), `title`, `instructions`, `time` (`HH:MM`), `days` (ISO weekdays 1–7), `timezone`, and optional `active` (defaults to true). Days are deduplicated and sorted. PostgreSQL computes `next_run_at` strictly after now in the chosen timezone, including daylight-saving changes. Pausing clears the next run; resuming recalculates it from now.

One-time schedules accept `title`, `instructions`, `timezone`, an optional nullable `platform`, and a future `run_at` ISO timestamp with a timezone offset. They cannot take recurring fields or be converted into recurring routines. Once a one-time schedule has started, editing and cancellation return 409.

Each account can have up to 50 recurring routines and pending one-time schedules combined; paused recurring routines count toward this limit. Creation is serialized per account to enforce the limit during concurrent requests. Responses include the latest run's task ID, trigger, and live status when available. Deleting a routine keeps any work it previously produced.

When a model is configured, the API's scheduler checks every 30 seconds for due routines and one-time schedules. Each occurrence runs once, even with several schedulers racing: it creates an Inbox work task whose first message is the routine's title, platform, and instructions, then moves the routine to its next run. A one-time schedule runs once and is then finished, including one whose time passed while the server was off. Turns left queued for over a minute (a crash between saving and starting) are started again. Run now starts a routine immediately without changing its schedule. Both Calendar and Routines use these endpoints.

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
| POST | `/api/tasks/:id/artifacts/:artifactId/content` | Turns an idea into content work with an optional `note` (up to 2,000 characters): a one-time schedule five minutes out that follows the `create-content` skill. 201 with the schedule; 404 for other artifacts; 409 when content is already queued for the idea. |
| POST | `/api/tasks/:id/turns` | Validates `message` and ownership, saves a queued turn, and returns it with 202 while Orca runs it in the background. Returns 503 without creating a turn when no model is configured, and 409 while the task is busy or archived. |

Each account has one chat and one onboarding conversation. Repeated creation reuses the existing conversation; work tasks remain independent. Onboarding opens once with a fixed Orca greeting and first question, completes that opening turn without a model call, and marks the profile `in_progress`. Existing history and completed profiles do not receive another opening.

Task lists include live status, the latest nonempty assistant text (up to 280 characters), and the recurring routine's title when applicable. Task details expose assistant text without provider replay data. Messages and artifacts stay associated with their own turns; document edits retain the artifact ID.

Queued or running work cannot be approved or archived. Only completed work can be approved. Repeated review actions retain their first timestamp. The turn repository permits one active turn per task, clears approval when a follow-up starts, and rejects follow-ups to archived tasks.

Inbox uses these endpoints for saved work, details, document editing, review, follow-ups, and turning ideas into content; Agent chat and onboarding use them for their conversations. Each idea's detail includes the content work queued from it: its schedule, and once it runs, its task and live status.

## Inbox

For review shows working, failed, and unapproved work. Approved shows approved work that is not archived. All activity includes archived work. The attention count in the sidebar and For review tab counts unapproved review items and failures; working items appear in the list without increasing that count.

Opening work shows its request, ordered replies, tool activity, status, and artifacts. Markdown renders as React elements without raw HTML; links can open HTTP(S) pages or artifacts belonging to that work. Documents can be copied and edited, with errors preserving the draft. Archived documents are read-only in the desktop. Follow Up sends Orca feedback or a next step on finished or failed work, which continues as a new turn. Opening an idea offers Create content with an optional note; the idea then shows that its content is queued, being created, ready, or failed, and opens the content work once it has run. Images, audio, and video open in a player with Download, and files a tool attached to a step open from that step.

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

File helpers use `STORAGE_DIR` or default to `apps/api/storage/`, which is ignored by Git. The build copies prompt files and skill folders as well as SQL migrations.

`GET /api/files?key=` streams one of the signed-in founder's saved files (screenshots, media, downloads) with range support, `private, no-store` caching, and no MIME sniffing; downloads are always sent as attachments, and other founders' keys return 404. Desktops read the same files at `GET /api/desktop/files?key=` with their device token. `POST /api/desktop/downloads` streams a file a desktop fetched or the founder chose, unchanged, up to 200 MB, with its filename and source URLs in the `X-PostOrca-File` header; the server detects its type from the bytes, records its size and SHA-256 checksum, and never keeps a partial file. `POST /api/desktop/files` also accepts MP3 (50 MB) and MP4 (200 MB) files alongside screenshots.

`create_artifact` delivers images, audio, and video from these saved files: the content is a file ref or key, which must belong to the founder and match the artifact's kind. The artifact stores the validated file metadata, never a URL written by the model. The desktop loads media through the authenticated API as temporary `blob:` URLs, shows a card for files a tool attached in Agent chat (unless they were also delivered as artifacts), and opens images, audio, and video in a player with Download.

## Orca's tools

`apps/api/src/tools` defines the tools Orca can call and runs them for the signed-in founder's task. Each tool keeps its JSON Schema definition next to its handler; arguments are validated again on the server, and refusals come back as messages Orca can act on.

| Group | Tools | Behavior |
| --- | --- | --- |
| Brand Profile | `read_brand_profile`, `update_brand_profile`, `save_brand_link`, `delete_brand_link` | Profile updates never touch links. Links are saved or deleted one at a time with owned IDs; a changed URL resets access. Completing the profile or adding a social link seeds default routines; deleting a link pauses its routines, and deleting the last link reopens onboarding. |
| Artifacts | `create_artifact`, `read_artifact`, `edit_document`, `delete_artifact`, `list_content_ideas` | Documents, ideas, and HTTP(S) links belong to the calling task. Documents are revised in place with exact find/replace edits that must each match once, or replaced whole; a failed edit saves nothing. Ideas list the founder's recent, unarchived ideas and whether content is queued. |
| Memory | `search_memory`, `read_memory`, `save_memory`, `delete_memory` | Markdown files per founder under `STORAGE_DIR/users/<id>/memory/`, each starting with a description line. Search works like `grep -i`. Paths are lowercase, at most three levels deep, and files are written atomically. |
| Desktop | `desktop_status`, `list_dir`, `read_file`, `git_activity`, `recent_files` | Run on the founder's desktop over the desktop connection. `desktop_status` reports the app, platform, plugins, and tools, and answers that the desktop is offline when none is connected. The file tools work only inside the founder's project folders, which the server adds to each call; links pointing outside are refused, and `.env` files, keys, and credentials are never listed, read, or shown in changes. `read_file` returns text and code, or saves a PNG or JPEG and attaches it. `git_activity` lists commits since a time and uncommitted work, or one commit's changes without secrets, lock files, or build folders; `recent_files` finds recently changed files outside git, skipping dependency and build folders. Git runs without a shell. |
| Capture | `list_capture_targets`, `screen_capture`, `screen_record_start`, `screen_record_stop` | Screenshots and silent recordings on the founder's Mac of a display, one app window (even behind others) or the iOS Simulator's own screen, using `screencapture` and `xcrun simctl io`. Targets are checked on the server and again on the desktop. Recordings run one at a time, show a menu bar item with their time and a stop command, stop themselves after 3 minutes, and are saved as H.264 MP4s with the bundled ffmpeg; screenshots and clips are uploaded and attached. Displays and windows need the app's Screen Recording permission, and the tools say how to grant it; the Simulator does not. The `product-demo-capture` skill plans the shots for a product demo, captures what Orca can and writes a step-by-step guide for the rest. |
| Chat only | `start_task`, `get_task`, `follow_up_task`, `request_user_input` | Agent chat and onboarding can start background work, read it, send it a follow-up, or ask one multiple-choice question. Background work is never offered these tools. Starting or following up work requires a running worker and otherwise returns 503. |


## Skills and plugins

A skill is a folder with a `SKILL.md` (YAML frontmatter with its name and description, then Markdown instructions) and optional reference files. Core skills live in `apps/api/src/skills`: `find-content-ideas`, `conversations-to-join`, `weekly-strategy-research`, `create-content`, and `work-content-ideas`. The default routines and "Ideas from my work" name the skill to follow. Orca's instructions list every core skill, and `read_skill` returns a skill's instructions and lists its other files, which it can also read. Only text files inside the skill's own folder can be read.

A plugin bundles tools with the skills that explain them, defined in code in `apps/api/src/plugins`. The browser plugin is registered (see [Browser extension](#browser-extension)). Each migration projects the plugins and core skills into the `tools`, `skills`, `plugins`, `plugin_tools`, and `plugin_skills` tables and disables rows that are no longer defined; at startup the API warns when the database catalog differs from the code. Orca sees the available plugins' codes and descriptions, activates one per task with `activate_plugin` (or `null` to return to its own tools), and from its next response is offered that plugin's tools and can read its skills. Calls to an inactive plugin's tools are refused before they run.

A plugin tool runs either on the server or on the founder's desktop. Desktop tools go over the desktop connection: the signed-in desktop exchanges its session token for a one-hour token bound to its install ID (`POST /api/desktop/device-token`), opens a WebSocket at `/api/desktop/socket`, and receives each call there. It runs the tool in Electron's main process, so tools keep working with the window closed, and posts the result to `POST /api/desktop/tool-result`. Only the device a call was sent to can answer it. Calls go to the founder's most recently connected desktop and fail clearly when none is connected, when the desktop reports an error, or when the call times out. A device can upload JPEG or PNG screenshots to `POST /api/desktop/files` and return their file keys. The desktop reconnects with backoff and pings every 30 seconds; a reconnecting device replaces its previous connection.

To add a plugin, define it in `apps/api/src/plugins/<code>/`, list it in `apps/api/src/plugins/catalog.ts`, and implement its desktop tools under the same names in `apps/desktop/electron/plugins/<code>/`, listed in `apps/desktop/electron/plugins/index.cjs`.

## Browser extension

`apps/browser-extension` lets the desktop work in the founder's own Chrome, Edge, or Brave, with their existing sign-ins. Load it once: open `chrome://extensions` (or `edge://extensions`), turn on Developer mode, choose **Load unpacked**, and select `apps/browser-extension`. Its manifest key fixes the extension ID to `bdfijompoabfinpmaepcpcfhdneghegf`. The popup shows whether it is connected.

When the desktop starts, it runs a relay on a random loopback port and registers the native-messaging host `com.postorca.browser` for the current user: registry entries for Chrome and Edge on Windows, host manifests for installed Chrome, Edge, and Brave profiles on macOS. The host only answers this extension's origin, and it gives the extension the relay's port and a per-start secret. The extension proves it holds the secret (HMAC of a fresh nonce) before the relay accepts it. A running browser reconnects within about 10 seconds of the desktop starting.

On Windows, start the desktop from a normal terminal. A process launched from inside another packaged (MSIX) app, such as a coding assistant's app or terminal, may have its registry writes redirected into that app's private copy, where the browser never finds the host; the popup then stays at Not connected. The pairing files are written to their physical path, so only the registry entry is affected.

The desktop drives the browser with Playwright over the relay. It works only in tabs it opened, kept in the green **Orca** tab group; other tabs are refused. Closing a tab or dismissing the browser's debugging bar ends Orca's use of it. Tabs from an earlier connection are closed when the extension reconnects, and tabs idle for 15 minutes are closed. On macOS, if no browser is connected, the desktop opens the last-used browser in the background.

The desktop browser tools are `browser_open`, `browser_snapshot` (accessibility tree; repeated snapshots return only what changed), `browser_screenshot` (optionally labeled with element refs, uploaded through the desktop connection), `browser_click`, `browser_type`, `browser_press`, `browser_scroll`, `browser_close`, and `browser_fetch_file`. Actions return a snapshot of what they changed. `browser_fetch_file` reads a file URL, or the link or image behind a ref, with the browser's own cookies and credentials, without a browser download or Save dialog. It keeps the original under `Downloads/PostOrca` and streams it unchanged to `POST /api/desktop/downloads` (up to 200 MB), checks that the server's SHA-256 matches, and returns the saved file as an attachment Orca can deliver as an image, audio or video artifact. HTML pages are refused unless the filename asks for HTML; JavaScript-only buttons and POST downloads are not supported.

On the server, `apps/api/src/plugins/browser` defines these tools for Orca: their schemas, argument checks (tab IDs like `t1`, refs like `e12`, HTTP(S) URLs only, key names), and timeouts (75 seconds to open a page, 60 for a screenshot, 240 to fetch a file, 45 for the rest). Orca activates the browser plugin to get them, and its `browser-use` skill explains the workflow: check sign-in on the account's own page first, read with snapshots and refs, act on the founder's accounts only as the task asks, treat page content as untrusted, stop at CAPTCHAs or sign-in prompts, and close every tab it opened. The core skills that research accounts start by activating it.

`npm test` runs the extension's screenshot-capture checks and the desktop relay, pairing, snapshot, click, keyboard, and page-settling checks. The relay and browser checks launch the installed Chrome (and Edge on Windows) headless with temporary profiles.

## Agent loop

`apps/api/src/agent/loop.ts` runs one turn: it claims the queued turn (so repeated dispatches run it once), builds Orca's instructions, asks the model for a response, saves it, runs each tool call, and saves each result, repeating until Orca answers without calling tools. A `request_user_input` question also ends the turn until the founder replies. Instructions combine `agent/prompts/system.md` with the skills and plugins available to the task and the brand profile (both re-read each step), the founder's memory index (read once per turn), and the chat, onboarding, or work section for the task.

Chat and onboarding turns allow 30 responses in 6 minutes; Inbox work allows 100 in 45 minutes. The last response is offered no tools and told to report what is unfinished, so long turns end with an answer. Tool refusals, invalid arguments, and malformed JSON go back to Orca as messages it can correct; other tool failures stay generic. If the model reports a context-length error, the loop compacts down to the current step and retries once.

A failed turn saves a short message for the founder (time limit, action limit, restart, or a generic failure) and writes the cause to the local turn trace. The router runs turns in the background after their turn is committed. On shutdown it stops running turns, which fail asking for a follow-up; on startup, turns left queued or running by the previous process are marked failed.

When Inbox work finishes, needs input, or fails (other than by a server restart), every desktop the founder has signed in hears it over the desktop connection: a system notification titled with the work, saying "Ready for your review.", "Orca needs your input.", or why it failed. Clicking it brings the app forward and opens that work. When the operating system won't show it (notifications are off for the app), the app shows a banner with a chime instead, with Open and dismiss; the newest is shown first. Agent chat and onboarding never notify.

## Workspace

- `apps/desktop/electron`: Electron main process and window.
- `apps/desktop/electron/plugins`: desktop sides of plugins, including the browser relay and tools.
- `apps/browser-extension`: the PostOrca browser extension.
- `apps/desktop/src`: React interface and styles.
- `apps/api/src`: Express app, configuration, startup, and shared error handling.
- `apps/api/tests`: API and configuration checks.

The desktop includes five sections:

- **Agent:** chat with Orca, showing its tool steps as they run, replies, question cards, delivered documents and links, and failed turns.
- **Inbox:** saved work filters, task details, document editing, approval, and archive.
- **Calendar:** month navigation and persistent one-time task creation, editing, and cancellation.
- **Routines:** persistent recurring routines, weekday/timezone editor, next-run times, pause/resume, Run now, and confirmed deletion.
- **Brand Profile:** read-only General, Audience, Voice, Colours, and Links tabs showing saved account data, and a Projects tab to add, edit, and remove project folders.

New accounts first set up their brand in a full-screen conversation with Orca, then see their saved profile and schedule before entering the workspace. Calendar and Routines persist their settings on the server, and Orca runs them on schedule. Inbox displays the work they produce.

Settings provides light, dark, and system appearance, saved on this device.

## Computer Use

Orca can discover desktop apps, open or select a window, observe it, and click, type, press keys or scroll on Windows and macOS. Run `npm run db:migrate` to sync the plugin catalog, then restart the API and desktop. On macOS, grant the desktop Accessibility and Screen Recording permissions when required.

Activating the computer plugin acquires control for one agent turn on one desktop. Input requires the latest screenshot observation; moved windows and stale observations require another observation. Control is released when the turn ends, the plugin changes, or the desktop disconnects. Screenshots can be delivered as image artifacts.

Run these commands from the repository root:

```sh
npm run test:computer
npm run computer:smoke
npm run test:computer-eval
npm run computer:eval -- list
```

The smoke test opens its own temporary window and verifies real desktop discovery, accessibility, screenshot capture, Unicode typing, clicking, scrolling and control release. Its reports and screenshots are saved under `apps/desktop/.data/computer-use-smoke/`. `computer:live-check` starts an interactive loopback tool harness; its private connection file supplies the port and bearer token, and the `quit` command stops it.

The Windows agent eval suite runs Calculator, Notepad, ChatGPT/Codex reading, then Edge/Google. It uses the configured `OPENAI_API_KEY`, `OPENAI_MODEL`, `DATABASE_URL` and `JWT_SECRET` from `apps/api/.env`. Set `POSTORCA_EVAL_EMAIL` to select an existing founder when the database has multiple accounts. Eval tasks appear in that founder's Inbox. Resolve queued/running turns before starting. The conversation-reading case requires the named reference conversation in the desktop app; it cannot pass without that evidence.

```sh
npm run computer:eval -- run calculator
npm run computer:eval -- status
npm run computer:eval -- review <run-folder> passed "Evidence-based review reason"
npm run computer:eval -- regrade <run-folder>
```

Each case needs three consecutive passes on the same runtime before the next case unlocks. The runner uses the production agent and authenticated desktop connection, saves evidence under `.data/computer-evals/`, and independently reads the app after the turn. Conversation and search cases also need an observer review; mechanical failures cannot be overridden. Regrading retains the original result and does not execute the agent. Run-folder arguments can be absolute or relative to the repository root. Model or execution-code changes reset pass streaks; grader-only changes allow retained evidence to be regraded.

## Browser evals

`apps/api/src/evals/browser-cases.ts` defines 20 browser scenarios, from finding flights and hotels to collecting stock media and researching recent posts on X, YouTube, Instagram, LinkedIn and Threads. Each has a natural `brief` and separate `success_criteria`. Only the brief reaches Orca; the criteria are for the reviewer. Being in the catalog does not mean a case has a runner or grader. The observer runs `flights`, `hotels` and `x-post-research` as normal Inbox work tasks; flights and hotels use fixed November 12–19, 2026 dates, and the X case uses a rolling seven-day window anchored at launch.

The observer uses the running API on `PORT`, with `DATABASE_URL`, `JWT_SECRET`, `OPENAI_API_KEY` and `OPENAI_MODEL` from `apps/api/.env`, and `POSTORCA_EVAL_EMAIL` when the database has more than one founder. Before preparing, check that the desktop is signed in and the browser extension is connected, and record that in a readiness file:

```json
{ "checked_at": "2026-10-27T08:00:00Z", "desktop_signed_in": true, "browser_connected": true }
```

```sh
npm run browser:eval -- prepare flights readiness.json
npm run browser:eval -- start <run-folder>
npm run browser:eval -- inspect <run-folder>
npm run browser:eval -- diagnose <run-folder>
```

`prepare` refuses readiness older than five minutes, an unhealthy API, pending migrations, a missing model, or other queued or running turns. It freezes the brief, criteria, model, commit and hashes of the eval and browser runtime files in `run.json`, and starts `judgment.json` with every criterion unreviewed, under `.data/browser-evals/<date>-<case>/<time>/`. `start` is the only step that calls the model: it refuses if anything changed since prepare or another turn is active, then creates the work task and submits the brief once. `inspect` saves the task as `evidence.json`, the paired tool calls as `calls.json`, measured `diagnostics.json` (wall time, model responses, tool calls and errors, tool-interval time counted once for overlapping calls, unchanged snapshots and multipart reads) and `summary.json`. Optional reviewer classifications of individual calls go in `call-review.json` (`useful`, `avoidable`, `low_yield` or `failed`). `diagnose` recomputes the diagnostics offline from the saved evidence and adds token usage from the turn's local traces. Run-folder and readiness paths are relative to where the command is typed.

## Media creation suite

The `media` plugin provides OpenAI image generation/editing plus ElevenLabs voice
search, speech, music, sound effects and transcription. Add `OPENAI_IMAGE_API_KEY`
and `ELEVENLABS_API_KEY` to `apps/api/.env` as needed. Both are optional at startup;
missing credentials produce a tool error. Images use their own credential, with
no fallback to the conversation key. Model choices match the original suite:
`gpt-image-2.5-flare`, `eleven_multilingual_v2`, `music_v1`,
`eleven_text_to_sound_v2` and `scribe_v2`. Account/model access must be verified
with the providers before claiming live availability. Paid requests have no
automatic retries, including after timeouts.

The `video` plugin adds `video_preview_frames` and `video_export` and shares the
media tools needed to make its assets. It composes saved images and text scenes
in Remotion, with optional speech, automatic word-highlighted captions, music
looping/fades/ducking, screenshot framing (browser/laptop/phone), focus regions,
highlights and saved brand colours. Formats are 9:16 (1080×1920), 4:5
(1080×1350), 1:1 (1080×1080) and 16:9 (1920×1080), all at 30 fps. Clips are
limited to 90 seconds and 40 scenes. Previews show up to eight half-resolution
frames; exports produce H.264/AAC MP4s. This is the original agent-driven
composer, without an interactive timeline or video-footage scene inputs.

The API checks file ownership and prepares timing, then uses the existing desktop
connection to render in Electron. Remotion drives Chrome Headless Shell and its
compositor in child processes; only one render runs at a time. The desktop
prepares Headless Shell on startup (a first-use download of about 190 MB).
Narrated clips require ElevenLabs transcription even when visible captions are
disabled, because speech timing also controls duration and music ducking.
Transcripts are cached per immutable file in the API process.

`read_file` now also reads audio or the soundtrack of a video inside existing
project folders. It saves an MP3 excerpt, capped at 300 seconds; optional
`start_seconds` and `duration_seconds` select it. Text/image behavior and folder
boundaries remain the same. Music selection for composed videos uses the
founder's own tracks; if none is available, the agent reports it and avoids
silently substituting generated music. Standalone music generation is available
through the media plugin subject to provider access.

All generated outputs use existing saved file refs, authenticated file reads and
image/audio/video artifacts. Orca delivers each final asset with `create_artifact`;
revisions retain earlier outputs. No new schema or binary persistence format is
introduced. Apply the existing catalog sync with `npm run db:migrate`, then
restart the API and desktop to load the plugins. Image/audio-only generation does
not require a desktop connection.

```sh
npm run check
npm test
npm run build
npm run video:smoke
```

The regular tests mock paid APIs and cover provider requests, ownership,
artifact persistence, plugin activation and video transport/timing. The smoke
check runs the actual Electron video plugin with synthetic screen/audio fixtures,
previews and exports all four formats, then verifies codec, dimensions, frame
rate, audio stream and duration with ffprobe. It spends no generation credits;
outputs and a report are under `apps/desktop/.data/video-smoke/`. Preview frames
do not establish voice quality or final music balance. Full signed-installer
packaging remains outside the current app's configured build; the build does
bundle the templates into `apps/desktop/build/remotion/`.

Live verification follows the original repo: `npm run media:smoke` (paid provider
check), then `npm run video:eval -- M1` (agent generation/revision), followed by
one video case at a time. See [media eval instructions](MEDIA_EVALS.md) for
account selection, all original case IDs, retained reports and acceptance limits.
