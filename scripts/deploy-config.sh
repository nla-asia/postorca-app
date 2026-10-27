# Loads the private production settings, kept outside the repository.
# Source it from other scripts: . "$(dirname "$0")/deploy-config.sh"
config="${POSTORCA_DEPLOY_ENV:-$HOME/.config/postorca/deploy.env}"
if [[ ! -f "$config" ]]; then
  echo "Missing $config. Copy deploy/deploy.env.example there and fill it in." >&2
  exit 1
fi
set -a
# shellcheck source=/dev/null
. "$config"
set +a
for name in POSTORCA_DEPLOY_HOST POSTORCA_DEPLOY_KEY POSTORCA_API_URL; do
  if [[ -z "${!name:-}" ]]; then
    echo "$name is not set in $config." >&2
    exit 1
  fi
done
