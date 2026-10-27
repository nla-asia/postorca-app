# Git workflow

PostOrca is built by one owner working with AI agents (Claude, Codex), often several at once and on more than one computer. The owner decides what to build and reviews and merges pull requests; agents do everything else.

## Branches

- `main`: production. Changes only through releases, and every release is tagged `vX.Y.Z`.
- `develop`: development. All work is merged here through pull requests.
- Task branches: `feature/<name>`, `fix/<name>`, `chore/<name>` or `docs/<name>`, in kebab-case.

Nobody pushes directly to `main` or `develop`.

## Starting a task

One task = one branch = one worktree. Agents never work in the main `postorca-app` folder, which stays on `develop`, so agents on the same computer never touch each other's files.

```sh
cd postorca-app
git fetch origin
git worktree add -b feature/<name> ../worktrees/<name> origin/develop
cd ../worktrees/<name>
npm install
cp ../../postorca-app/apps/api/.env apps/api/.env   # and any other .env files you need
```

If the user asks for a change to work that already has an open pull request, continue on that pull request's branch instead of starting a new one.

## Finishing a task

1. Run `npm run check` and `npm test`; fix anything that fails.
2. Rebase on the latest `develop`: `git fetch origin && git rebase origin/develop`.
3. Push the branch and open a pull request into `develop`. In it, say what changed, why, and how it was tested, with screenshots for UI changes.
4. Tell the owner the pull request is ready, with its link.

## Merging

Only when the owner says to merge:

1. Squash and merge the pull request, and delete the branch.
2. Remove the worktree: `git worktree remove ../worktrees/<name>`.
3. Update the main folder: `git switch develop && git pull`.

## Releasing

When the owner asks for a release (for example, "release v0.2.0"):

Releases are built on this Mac, not on GitHub.

1. Set the new version everywhere with `npm run version:set -- X.Y.Z` on a `chore/release-vX.Y.Z` branch, and merge it into `develop` through a pull request.
2. Open a pull request from `develop` into `main` titled `Release vX.Y.Z`, and merge it with a merge commit once the owner approves.
3. Build and publish:
   ```sh
   npm run release -- X.Y.Z --deploy
   ```
   This checks out `origin/main` in a clean temporary worktree, runs checks and tests, builds the macOS installer, tags `vX.Y.Z`, creates the GitHub Release with the installer attached and generated notes, and with `--deploy` deploys the backend from that same tree (see [DEPLOY.md](../DEPLOY.md)). Leave out `--deploy` to publish without deploying.

Never deploy uncommitted changes or anything that isn't a tag on `main`.

## Urgent production fixes

1. Branch `fix/<name>` from `origin/main` instead of `develop`.
2. In the same branch, set the next patch version (for example, `npm run version:set -- 0.2.1`), then open the pull request into `main`. Once it's merged, run `npm run release -- 0.2.1 --deploy`.
3. Merge `main` back into `develop` with a pull request.

## Rules

- Never commit secrets: `.env` files stay local.
- Never force-push `main` or `develop`. Force-pushing your own task branch after a rebase is fine.
- Never edit a database migration once it is on `develop`; add a new one.
- When two agents run the app at the same time, use different ports.
- If you need access you don't have (GitHub permissions, a sign-in, a credential), stop and ask the owner. Don't work around it.
