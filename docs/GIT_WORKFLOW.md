# Git workflow

How we branch, review, release and deploy PostOrca.

## Branches

| Branch | Purpose | Who writes to it |
| --- | --- | --- |
| `main` | Production. Every commit is a released version and has a tag. | Release and hotfix merges only |
| `develop` | Development. The next release is built up here. | Merged pull requests only |
| `feature/<name>` | New features | You, branched from `develop` |
| `fix/<name>` | Bug fixes that can wait for the next release | You, branched from `develop` |
| `chore/<name>`, `docs/<name>` | Tooling, dependencies, docs | You, branched from `develop` |
| `release/vX.Y.Z` | Preparing a release | Branched from `develop` |
| `hotfix/vX.Y.Z` | Urgent production fixes | Branched from `main` |

Nobody pushes directly to `main` or `develop`. Branch names are short and kebab-case, for example `feature/linkedin-publishing` or `fix/calendar-timezone`.

## Day-to-day work

1. Start from an up-to-date `develop`:
   ```sh
   git switch develop && git pull
   git switch -c feature/<name>
   ```
2. Commit in small steps. Write the subject as an imperative sentence describing the change (for example, "Keep sign-ins for a week"). Keep each commit focused on one thing.
3. Before opening a pull request, run `npm run check` and `npm test`.
4. Push the branch and open a pull request into `develop`. Explain what changed and how you tested it; add screenshots for UI changes.
5. **Squash and merge** after review and passing checks, then delete the branch.

If `develop` moves while your branch is open, rebase onto it (`git pull --rebase origin develop`) instead of merging `develop` in.

## Releases

We use [semantic versioning](https://semver.org): `MAJOR.MINOR.PATCH`. All workspaces share one version.

1. Branch `release/vX.Y.Z` from `develop`.
2. Bump `version` in the root and every `apps/*/package.json`, and add the release notes to `CHANGELOG.md`.
3. Test the release build. Only bug fixes go into the release branch from here on.
4. Open a pull request into `main` and **merge with a merge commit** (no squash), so the release history stays readable.
5. Tag the merge commit and push the tag:
   ```sh
   git switch main && git pull
   git tag -a vX.Y.Z -m "PostOrca vX.Y.Z"
   git push origin vX.Y.Z
   ```
6. Merge `main` back into `develop` so any release fixes are kept.
7. Create a GitHub Release from the tag with the notes and the macOS installer attached.

## Hotfixes

For a production bug that can't wait for the next release:

1. Branch `hotfix/vX.Y.Z` from `main` (bump the PATCH number).
2. Fix the bug, bump the versions, and update `CHANGELOG.md`.
3. Open a pull request into `main`, merge it with a merge commit, and tag it as in a normal release.
4. Merge `main` back into `develop`.

## Deploying

- **Production** (the backend VM and the published desktop build) is deployed only from a tag on `main`, from a clean working tree:
  ```sh
  git switch --detach vX.Y.Z
  git status   # must be clean
  npm run deploy
  ```
- **Development** builds and test environments come from `develop` or a feature branch. They must never point at production data or production credentials.
- Never deploy uncommitted changes to production.

## Rules

- Never commit secrets. `.env` files stay local, and only `.env.example` is tracked.
- Never force-push to `main` or `develop`. Force-pushing your own feature branch is fine.
- Database migrations are append-only. Never edit a migration that has been merged into `develop`.
- Every pull request needs passing checks before it is merged.
