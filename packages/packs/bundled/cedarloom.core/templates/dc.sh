#!/bin/sh
# Runs one command in the dev container from any folder of the checkout: scripts/dc npm test
# The arguments pass on as they are; a compound command goes through a shell: scripts/dc sh -lc 'npm ci && npm test'
# scripts/dc up starts the container.
dir="$(cd "$(dirname "$0")/.." && pwd)"
# Compose names a project after the folder, so two checkouts with the same folder name would share containers. A name set
# in the environment or in a .env file is kept. The checksum first: a name starts with a letter or digit.
if [ -z "$COMPOSE_PROJECT_NAME" ] && ! grep -qs '^COMPOSE_PROJECT_NAME=' "$dir/.env" "$dir/.devcontainer/.env"; then
  COMPOSE_PROJECT_NAME="$(printf %s "$dir" | cksum | cut -d ' ' -f 1)-$(basename "$dir" | tr 'A-Z' 'a-z' | tr -cd 'a-z0-9_-')"
  export COMPOSE_PROJECT_NAME
fi
[ "$1" = up ] && shift && exec devcontainer up --workspace-folder "$dir" "$@"
exec devcontainer exec --workspace-folder "$dir" "$@"
