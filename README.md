# PostOrca

**A personal brand agent for builders.**

PostOrca is a desktop app with an AI agent, Orca, that helps founders and builders grow their personal brand while they keep building. Orca learns your brand (what you're building, your audience, your voice), then researches ideas, finds conversations to join, and drafts posts, images, audio and video for X, LinkedIn, Threads, Instagram and Facebook. Work runs on a schedule in the background and lands in your Inbox for review.

## Preview

| Agent chat | Calendar |
| --- | --- |
| ![Agent chat](docs/screenshots/agent.png) | ![Calendar](docs/screenshots/calendar.png) |

| Routines | Brand Profile |
| --- | --- |
| ![Routines](docs/screenshots/routines.png) | ![Brand Profile](docs/screenshots/brand-profile.png) |

## Features

- **Agent**: chat with Orca, who onboards you, edits your Brand Profile and does work on request.
- **Inbox**: review, edit, approve or follow up on everything Orca produces.
- **Calendar**: schedule one-time tasks.
- **Routines**: recurring work such as daily content ideas and weekly strategy research. They run on the server even when the app is closed.
- **Brand Profile**: your audience, voice, colours, social links and project folders.
- **Tools**: browser control through your own browser, computer use on macOS and Windows, media creation (images, voice, music, video), and Gmail/Google Drive connectors.

## Project structure

| Path | What it is |
| --- | --- |
| [`apps/desktop`](apps/desktop) | Electron + React + TypeScript desktop app |
| [`apps/api`](apps/api) | Express API, Orca's agent loop, tools, skills and scheduler (PostgreSQL) |
| [`apps/connectors`](apps/connectors) | MCP service for Gmail and Google Drive tools |
| [`apps/browser-extension`](apps/browser-extension) | Chrome/Edge/Brave extension that lets Orca work in your browser |
| [`apps/website`](apps/website) | Next.js marketing site |

## Getting started

Requires Node.js 22.12+ and npm 11.

```sh
npm install
cp apps/api/.env.example apps/api/.env
```

In `apps/api/.env`, set `JWT_SECRET` to a random string of at least 32 characters, and add `META_MODEL_API_KEY` to turn Orca and image generation on. The models themselves (Meta's `muse-spark-1.3` for Orca and `muse-image-1.0` for images) are chosen in `apps/api/src/settings.ts`; keys never choose a model. `ELEVENLABS_API_KEY` adds audio. `.env` holds secrets and values that differ between environments (URLs, client IDs, price IDs); settings that are the same everywhere, like the models and welcome credits, live in `apps/api/src/settings.ts`.

Then start each of these in its own terminal:

```sh
npm run db:local
```

```sh
npm run db:migrate && npm run api:dev
```

```sh
npm run dev
```

`db:local` runs a project-local PostgreSQL (no install needed); to use your own database, set `DATABASE_URL` and skip it. The API runs on `http://127.0.0.1:3001` and `npm run dev` opens the desktop app.

To let Orca use your browser, open `chrome://extensions`, turn on Developer mode, choose **Load unpacked** and select `apps/browser-extension`.

## Scripts

| Command | Description |
| --- | --- |
| `npm test` | Run all tests |
| `npm run check` | Type-check every workspace |
| `npm run build` | Build every workspace |
| `npm run desktop:package` | Build the macOS installer |
| `npm run connectors:start` | Start the Gmail/Drive connector service |
| `npm run web:dev` | Start the website at `http://127.0.0.1:3000` |
| `npm run credits:add -- <email> <credits>` | Add credits to an account, e.g. a local test account |

Deployment is covered in [DEPLOY.md](DEPLOY.md).

## Contributing

We work on `develop` and release to `main`. See [docs/GIT_WORKFLOW.md](docs/GIT_WORKFLOW.md) for branching, pull requests and releases.
