# Agent instructions

Follow [docs/GIT_WORKFLOW.md](docs/GIT_WORKFLOW.md) for every change:

- Before you start, create a worktree with a new branch from `origin/develop`. Never edit the main `postorca-app` folder, `main` or `develop` directly.
- When you're done, run `npm run check` and `npm test`, rebase on `origin/develop`, push, and open a pull request into `develop`.
- Merge only when the owner says so.
- If you lack access (GitHub permissions, a sign-in, a credential), ask the owner instead of working around it.
