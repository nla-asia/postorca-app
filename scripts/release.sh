#!/usr/bin/env bash
# Builds a release locally from origin/main and publishes it on GitHub.
# Usage: npm run release -- X.Y.Z [--deploy]
# Run after the release pull request (develop -> main) is merged. Works in a clean, temporary
# worktree of origin/main, so local changes and other agents' work are never included.
set -euo pipefail
version="${1:-}"
deploy=false
[[ "${2:-}" == "--deploy" ]] && deploy=true
if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Usage: npm run release -- X.Y.Z [--deploy]" >&2
  exit 1
fi
tag="v$version"
repo="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo"

gh auth status >/dev/null 2>&1 || { echo "Sign in to GitHub first: gh auth login --web" >&2; exit 1; }
git fetch --quiet --tags origin
if git rev-parse --quiet --verify "refs/tags/$tag" >/dev/null; then
  echo "$tag already exists." >&2
  exit 1
fi
main_version="$(git show origin/main:package.json | node -pe 'JSON.parse(require("fs").readFileSync(0)).version')"
if [[ "$main_version" != "$version" ]]; then
  echo "origin/main is at version $main_version, not $version. Merge the release pull request first." >&2
  exit 1
fi

build="$(mktemp -d -t postorca-release)/$tag"
git worktree add --quiet --detach "$build" origin/main
trap 'git -C "$repo" worktree remove --force "$build"' EXIT
cd "$build"

echo "Installing, checking and testing $tag..."
npm ci --no-audit --no-fund
npm run check
npm test

echo "Building the macOS desktop app..."
npm run desktop:package:gcp
dmg="apps/desktop/release/PostOrca-$version-arm64.dmg"
zip="apps/desktop/release/PostOrca-$version-arm64-mac.zip"
[[ -f "$dmg" && -f "$zip" ]] || { echo "Desktop build output is missing." >&2; exit 1; }

echo "Tagging and publishing $tag..."
git tag -a "$tag" -m "PostOrca $tag"
git push --quiet origin "$tag"
gh release create "$tag" "$dmg" "$zip" --title "PostOrca $tag" --generate-notes --verify-tag

if $deploy; then
  echo "Deploying the backend from $tag..."
  bash scripts/deploy.sh
fi
echo "Released $tag: $(gh release view "$tag" --json url --jq .url)"
