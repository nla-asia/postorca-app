#!/usr/bin/env bash
# Builds the macOS desktop app for the production API from the private deploy settings.
set -euo pipefail
cd "$(cd "$(dirname "$0")/.." && pwd)"
. scripts/deploy-config.sh
VITE_API_URL="$POSTORCA_API_URL" npm run package --workspace @postorca/desktop -- --publish never
