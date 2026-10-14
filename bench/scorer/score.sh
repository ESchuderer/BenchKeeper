#!/bin/sh
# Scores one trial's workspace against a brief's hidden tests. Runs on the host with podman; the workspace is copied, never changed.
# Usage: bench/scorer/score.sh <brief-dir> <workspace> <out-dir>
set -u
brief=$(realpath "$1"); ws=$(realpath "$2"); out=$(realpath -m "$3")
here=$(dirname "$(realpath "$0")")
NODE=docker.io/library/node:22.23.3-bookworm-slim@sha256:efd0ab5780c2d9ab1f0f869571a00d5edb17793bff4cce4a2792e3eb0ffc7562
PW=mcr.microsoft.com/playwright:v1.64.0-noble@sha256:bc72a8df40831ded821e3cbc79c318c21b44d6e51dff9fd89ace7a8249c5b462
pass=$(od -An -N12 -tx1 /dev/urandom | tr -d ' \n')
pod=bk-score-$$
mkdir -p "$out" && app=$(mktemp -d) && cp -a "$ws/." "$app/" && rm -rf "$app/node_modules"
# Hidden tests next to the scorer dependencies, so ESM imports resolve.
hid=$(mktemp -d) && cp -r "$brief/hidden/." "$hid/" && mkdir "$hid/node_modules"
# step <name> <seconds> <command...>: log and exit code per step; 124 means timeout.
step() { name=$1; T=$2; shift 2; "$@" > "$out/$name.log" 2>&1; echo $? > "$out/$name.exit"; }
node_run() { timeout "$T" podman run --rm --userns=keep-id -e HOME=/tmp -e CI=1 -v "$app":/app:Z -w /app "$NODE" "$@"; }

step install 600 node_run npm install --no-audit --no-fund
step build 600 node_run npm run build --if-present
step audit 120 node_run npm audit --json --loglevel=silent

podman pod create --userns=keep-id --name "$pod" >/dev/null
podman run -d --pod "$pod" --name "$pod-app" -e HOME=/tmp -e PORT=3000 -e STAFF_PASSWORD="$pass" \
  -v "$app":/app:Z -w /app "$NODE" npm start > /dev/null
tests() {
  timeout "$T" podman run --rm --pod "$pod" -e HOME=/tmp -e PORT=3000 -e STAFF_PASSWORD="$pass" \
    -e PW_OUT=/out/acceptance.json -e AXE_OUT=/out/axe.json \
    -v "$hid":/w:Z -v "$here/node_modules":/w/node_modules:ro,Z -v "$out":/out:Z -w /w "$PW" sh -c '
    for i in $(seq 60); do node -e "fetch(\"http://127.0.0.1:3000/\").then(r=>process.exit(r.ok?0:1),()=>process.exit(1))" && break; sleep 2; done
    node -e "fetch(\"http://127.0.0.1:3000/\").then(r=>process.exit(r.ok?0:1),()=>process.exit(1))" || { echo app did not start; exit 3; }
    CHROME_PATH=$(node -e "console.log(require(\"playwright-core\").chromium.executablePath())") \
      npx lighthouse http://127.0.0.1:3000/ --quiet --output=json --output-path=/out/lighthouse.json \
      --only-categories=performance,accessibility,best-practices --chrome-flags="--headless=new --no-sandbox"
    npx playwright test -c playwright.config.mjs'
}
step acceptance 900 tests
podman logs "$pod-app" > "$out/start.log" 2>&1
podman pod rm -f "$pod" > /dev/null

# The agent's own tests, if it wrote any, in the image it worked in.
if jq -er '.scripts.test // empty' "$app/package.json" 2>/dev/null | grep -qv 'no test specified'; then
  step agent-tests 600 node_run npm test
fi
rm -rf "$app" "$hid"
