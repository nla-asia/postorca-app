#!/usr/bin/env bash
# Deploy the current backend working tree (including local changes) to the existing GCP VM.
# Secrets and stored user files remain at their existing VM paths. No backup is created.
set -euo pipefail
cd "$(cd "$(dirname "$0")/.." && pwd)"
# Host, key and API URL come from a private file outside the repository.
. scripts/deploy-config.sh
DEPLOY_HOST="$POSTORCA_DEPLOY_HOST"
DEPLOY_KEY="$POSTORCA_DEPLOY_KEY"
DEPLOY_USER="${DEPLOY_HOST%@*}"
DEPLOY_ROOT=/opt/postorca
SSH=(ssh -i "$DEPLOY_KEY" -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=15)

# Build before interrupting any service. The backend outputs are platform-neutral JS.
npm run build --workspace @postorca/api
npm run build --workspace @postorca/connectors
stage="$(mktemp -d -t postorca-deploy)"
trap 'rm -rf "$stage"' EXIT
mkdir -p "$stage/apps"
cp package.json package-lock.json "$stage/"
cp -R deploy "$stage/"
for app in api connectors; do
  rsync -a --exclude=node_modules --exclude='.env*' --exclude=.data --exclude=storage --exclude=tests \
    "apps/$app/" "$stage/apps/$app/"
done
# npm's workspace resolver needs manifests for the unselected desktop/website workspaces.
for app in desktop website browser-extension; do
  mkdir -p "$stage/apps/$app"
  cp "apps/$app/package.json" "$stage/apps/$app/"
done
printf '%s working-tree %s\n' "$(git rev-parse HEAD)" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$stage/REVISION"

"${SSH[@]}" "$DEPLOY_HOST" "sudo -n install -d -m 700 -o $DEPLOY_USER -g $DEPLOY_USER $DEPLOY_ROOT && sudo -n systemctl stop pba-api pba-connectors"
# The old /opt/pba tree is left in place; its environment files are the existing secret source.
rsync -az --delete --exclude=node_modules --exclude=.env --exclude=.data --exclude=storage \
  -e "ssh -i $DEPLOY_KEY -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=15" \
  "$stage/" "$DEPLOY_HOST:$DEPLOY_ROOT/"

"${SSH[@]}" "$DEPLOY_HOST" "bash -s -- $DEPLOY_USER" <<'REMOTE'
set -euo pipefail
service_user="$1"
cd /opt/postorca
ln -sfn /opt/pba/.env apps/api/.env
ln -sfn /opt/pba/connectors/.env apps/connectors/.env
# Only server workspaces: no Electron download or desktop native modules on Linux.
npm ci --workspace @postorca/api --workspace @postorca/connectors --include-workspace-root=false \
  --omit=dev --ignore-scripts --no-audit --no-fund --loglevel=error
node apps/api/dist/upgrade-legacy.js
# The service files leave the account to run as to be filled in here.
for service in pba-api pba-connectors; do
  sed "s/__SERVICE_USER__/$service_user/" "deploy/$service.service" | sudo -n tee "/etc/systemd/system/$service.service" >/dev/null
  sudo -n chmod 644 "/etc/systemd/system/$service.service"
done
sudo -n systemctl daemon-reload
sudo -n systemctl start pba-connectors pba-api
for attempt in $(seq 1 30); do
  if curl --max-time 2 -fsS http://127.0.0.1:3001/api/health >/dev/null 2>&1 &&
     curl --max-time 2 -fsS http://127.0.0.1:3100/health >/dev/null 2>&1; then
    echo "Healthy: $(cat REVISION)"
    exit 0
  fi
  sleep 1
done
echo 'Backend health verification failed; inspect systemd service logs.' >&2
exit 1
REMOTE
