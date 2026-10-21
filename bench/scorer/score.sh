#!/bin/sh
# Scores one trial's workspace against a brief's hidden tests. Runs on the host with podman; the workspace is copied, never changed.
# Usage: bench/scorer/score.sh <brief-dir> <workspace> <out-dir>   HIDDEN_FILES: only these test files (iterative briefs)
set -u
brief=$(realpath "$1"); ws=$(realpath "$2"); out=$(realpath -m "$3")
here=$(dirname "$(realpath "$0")")
NODE=docker.io/library/node:22.23.3-bookworm-slim@sha256:efd0ab5780c2d9ab1f0f869571a00d5edb17793bff4cce4a2792e3eb0ffc7562
PW=mcr.microsoft.com/playwright:v1.64.0-noble@sha256:bc72a8df40831ded821e3cbc79c318c21b44d6e51dff9fd89ace7a8249c5b462
pass=$(od -An -N12 -tx1 /dev/urandom | tr -d ' \n')
pod=bk-score-$$
# Remove the scoring pod and temp copies on any exit, including INT, TERM and HUP.
trap 'podman pod rm -f "$pod" > /dev/null 2>&1; rm -rf "${app:-}" "${hid:-}" "${site:-}" "${cur:-}" "${prev:-}"' EXIT
trap 'exit 130' INT TERM HUP
# The built app as delivered (source and git history, without node_modules), for download and manual comparison.
mkdir -p "$out/screenshots" && tar --exclude=node_modules --exclude=.venv --exclude=__pycache__ -czf "$out/app.tar.gz" -C "$ws" . || exit 1
# Step briefs (brief.json "steps": "sessions") are scored per step: on the snapshot bench/run-brief.sh saved after step <k>
# (<out-dir>/../steps/<k>/repo.tar.gz), the step's checks, the repository's suite and, from step 2 on, the cross-step
# checks against the previous step's snapshot, into steps/<k>/. The hash covers the hidden tests and the checks.
if [ "$(jq -r '.steps // empty' "$brief/brief.json" 2>/dev/null)" = sessions ]; then
  set -- checks
  [ ! -d "$brief/hidden" ] || set -- "$@" hidden
  case ${brief##*/} in scb-xjq|scb-mvvault) set -- "$@" ../scb/checks ../scb/config.sh ../scb/Containerfile ;; esac
  (cd "$brief" && find -L "$@" -type f | LC_ALL=C sort | xargs sha256sum | sha256sum | cut -c1-16) > "$out/hidden.sha256"
  prev=
  failed=0
  for k in $(ls "$(dirname "$out")/steps" 2>/dev/null | grep -E '^[0-9]+$' | sort -n); do
    s=$(dirname "$out")/steps/$k
    [ -f "$s/repo.tar.gz" ] || continue
    # A check that fails to start must not leave the results of an earlier scoring (cross.sh appends to checks.json).
    rm -f "$s/checks.json" "$s/suite.json" "$s/playwright.json" "$s/diff.json" "$s/scb.json"
    cur=$(mktemp -d) || exit 1
    if ! tar -xzf "$s/repo.tar.gz" -C "$cur"; then
      echo '{"infrastructure_error":"checkpoint archive extraction failed","checks":[]}' > "$s/checks.json"
      echo 1 > "$s/checks.exit"
      exit 1
    fi
    "$brief/checks/step$k.sh" "$cur" "$s" > "$s/checks.log" 2>&1
    rc=$?
    rm -f "$s/checks.exit" && echo "$rc" > "$s/checks.exit"
    [ "$rc" = 0 ] || failed=1
    "$brief/checks/suite.sh" "$cur" "$s" > "$s/suite.log" 2>&1
    [ -z "$prev" ] || [ ! -f "$brief/checks/cross.sh" ] || "$brief/checks/cross.sh" "$cur" "$s" "$prev" > "$s/cross.log" 2>&1
    rm -rf "$prev" && prev=$cur
  done
  rm -rf "$prev"
  exit "$failed"
fi
app=$(mktemp -d) && cp -a "$ws/." "$app/" && rm -rf "$app/node_modules"
# Hidden tests next to the scorer dependencies, so ESM imports resolve.
hid=$(mktemp -d) && cp -rL "$brief/hidden/." "$hid/" && mkdir "$hid/node_modules"
# Which version of the hidden tests scored this trial.
(cd "$brief/hidden/" && find -L . -type f | LC_ALL=C sort | xargs sha256sum | sha256sum | cut -c1-16) > "$out/hidden.sha256"
# step <name> <seconds> <command...>: log and exit code per step; podman --timeout stops the container itself.
step() { name=$1; T=$2; shift 2; "$@" > "$out/$name.log" 2>&1; echo $? > "$out/$name.exit"; }
node_run() { podman run --rm --timeout "$T" --userns=keep-id -e HOME=/tmp -e CI=1 -v "$app":/app:Z -w /app "$NODE" "$@"; }

# Per-brief settings (brief.json, optional): "serve": "static" serves the files instead of running npm start.
serve=$(jq -r '.serve // "npm"' "$brief/brief.json" 2>/dev/null || echo npm)
[ ! -f "$brief/brief.json" ] || cp "$brief/brief.json" "$out/brief.json"

if [ "$serve" = static ]; then
  # The app as delivered, served and opened without node_modules: the install below is only for the agent's own tests
  # and the audit.
  site=$(mktemp -d) && cp -a "$app/." "$site/"
  if [ -f "$app/package.json" ]; then
    step install 600 node_run npm install --no-audit --no-fund
    step audit 120 node_run npm audit --json --loglevel=silent
  fi
else
  step install 600 node_run npm install --no-audit --no-fund
  step build 600 node_run npm run build --if-present
  step audit 120 node_run npm audit --json --loglevel=silent
fi
# Code metrics of the agent's own source: complexity and erosion (erosion.mjs), duplicated lines (jscpd, 50 tokens or more).
metrics() {
  podman run --rm --timeout "$T" --userns=keep-id -e HOME=/tmp -v "$app":/app:ro,Z -v "$here":/s:ro,Z -v "$out":/out:Z -w /s "$NODE" sh -c '
    node erosion.mjs /app > /out/erosion.json && node node_modules/jscpd/run-jscpd.js --silent --reporters json --output /out/jscpd \
      --min-tokens 50 --format javascript,jsx,typescript,tsx --ignore "**/node_modules/**,**/dist/**,**/build/**,**/coverage/**,**/*.test.*,**/*.spec.*,**/tests/**,**/test/**,**/e2e/**,**/*.config.*" /app'
}
step metrics 300 metrics

podman pod create --userns=keep-id --name "$pod" >/dev/null
if [ "$serve" = static ]; then
  # Shared label (z): the app container and the test container mount the same copy at once, both read-only.
  podman run -d --pod "$pod" --name "$pod-app" -e HOME=/tmp -e PORT=3000 \
    -v "$site":/app:ro,z -v "$here/static.mjs":/static.mjs:ro,Z "$NODE" node /static.mjs /app > /dev/null
  appmount="-v $site:/app:ro,z -e APP_DIR=/app"
else
  podman run -d --pod "$pod" --name "$pod-app" -e HOME=/tmp -e PORT=3000 -e STAFF_PASSWORD="$pass" \
    -v "$app":/app:Z -w /app "$NODE" npm start > /dev/null
  appmount=
fi
tests() {
  # shellcheck disable=SC2086 # $appmount holds several flags
  podman run --rm --timeout "$T" --pod "$pod" -e HOME=/tmp -e PORT=3000 -e STAFF_PASSWORD="$pass" $appmount \
    -e PW_OUT=/out/acceptance.json -e AXE_OUT=/out/axe.json -e SHOT_DIR=/out/screenshots -e HIDDEN_FILES="${HIDDEN_FILES:-}" \
    -v "$hid":/w:Z -v "$here/node_modules":/w/node_modules:ro,Z -v "$out":/out:Z -w /w "$PW" sh -c '
    for i in $(seq 60); do node -e "fetch(\"http://localhost:3000/\").then(r=>process.exit(r.ok?0:1),()=>process.exit(1))" && break; sleep 2; done
    node -e "fetch(\"http://localhost:3000/\").then(r=>process.exit(r.ok?0:1),()=>process.exit(1))" || { echo app did not start; exit 3; }
    CHROME_PATH=$(node -e "console.log(require(\"playwright-core\").chromium.executablePath())") \
      npx lighthouse http://localhost:3000/ --quiet --output=json --output-path=/out/lighthouse.json \
      --only-categories=performance,accessibility,best-practices --chrome-flags="--headless=new --no-sandbox"
    npx playwright test -c playwright.config.mjs $HIDDEN_FILES'
}
step acceptance 900 tests
podman logs "$pod-app" > "$out/start.log" 2>&1
podman pod rm -f "$pod" > /dev/null

# The agent's own tests, if it wrote any, in the base image of the arm images (no browsers: browser tests fail here).
if jq -er '.scripts.test // empty' "$app/package.json" 2>/dev/null | grep -qv 'no test specified'; then
  step agent-tests 600 node_run npm test
fi
rm -rf "$app" "$hid" "${site:-}"
# Mutation score of the agent's own tests (bench/scorer/mutation.sh, on its own copy of the workspace); MUTATION=0 skips it
# (iterative briefs: only the last step gets it).
[ "${MUTATION:-1}" = 0 ] || "$here/mutation.sh" "$ws" "$out"
