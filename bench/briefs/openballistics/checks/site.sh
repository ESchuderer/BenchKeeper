# Shared by step2.sh and step3.sh (sourced, not run): a copy of the workspace, its baseline tree, the site build and
# the hidden Playwright tests against the built site. Expects $ws and $out; sets $app, $base, $sha, $built.
NODE=docker.io/library/node:22.23.3-bookworm-slim@sha256:efd0ab5780c2d9ab1f0f869571a00d5edb17793bff4cce4a2792e3eb0ffc7562
GIT=docker.io/library/node:22.23.3-bookworm@sha256:0e5f906573693feaa1e21057ebdcfdb5bd5021f050b2dc7c9deceb629c7da2a8
PW=mcr.microsoft.com/playwright:v1.64.0-noble@sha256:bc72a8df40831ded821e3cbc79c318c21b44d6e51dff9fd89ace7a8249c5b462
here=$(dirname "$(realpath "$0")"); brief=$(dirname "$here"); scorer=$(realpath "$brief/../../scorer")
tmp=$(mktemp -d); app=$tmp/app; base=$tmp/base; hid=$tmp/hidden; pod=bk-ob-$$
trap 'podman pod rm -f "$pod" > /dev/null 2>&1; rm -rf "$tmp"' EXIT
trap 'exit 130' INT TERM HUP
mkdir -p "$out" "$app" "$base" "$out/screenshots"

# The workspace as delivered, uncommitted changes included. Expected values come from the baseline commit, which
# prepare.sh makes identical on every run (baseline.sha), never from the agent's history: a rewritten history without it
# leaves the baseline tree empty and the checks fail. Git runs in a container without network or credentials, since the
# copy's .git/config is agent-written. Also writes $tmp/added.diff and $tmp/numstat (the change against the baseline).
tar -C "$ws" --exclude=node_modules -cf - . | tar -C "$app" -xf -
sha=$(cat "$brief/baseline.sha")
podman run --rm --network none --userns=keep-id -e HOME=/tmp -v "$app":/app:Z -v "$base":/base:Z -v "$tmp":/t:Z -w /app "$GIT" sh -c '
  g() { git -c safe.directory="*" -c core.fsmonitor=false "$@"; }
  g add -A > /dev/null 2>&1
  g archive "$1" lib data | tar -x -C /base
  g diff --cached --no-renames --no-ext-diff --no-textconv -U0 "$1" -- site lib ":(exclude)*.test.*" ":(exclude)*.spec.*" > /t/added.diff
  g diff --cached --no-renames --no-ext-diff --no-textconv --numstat "$1" > /t/numstat' sh "$sha" > /dev/null 2>&1

# The site as CI builds it, at the root path (step 1 may set another Pages base).
build() {
  podman run --rm --timeout 900 --userns=keep-id -e HOME=/tmp -e CI=1 -e PAGES_BASE=/ -e ASTRO_TELEMETRY_DISABLED=1 \
    -v "$app":/repo:Z -w /repo/site "$NODE" sh -c 'npm ci --no-audit --no-fund && npm run build' > "$out/build.log" 2>&1
  built=$?; [ -f "$app/site/dist/index.html" ] || built=1
}

# tests <spec files...>: serves site/dist and writes $out/playwright.json.
tests() {
  cp -r "$brief/hidden" "$hid" && mkdir "$hid/node_modules"
  podman pod create --userns=keep-id --name "$pod" > /dev/null
  podman run -d --pod "$pod" --name "$pod-app" -e HOME=/tmp -e PORT=3000 \
    -v "$app/site/dist":/app:ro,z -v "$scorer/static.mjs":/static.mjs:ro,Z "$NODE" node /static.mjs /app > /dev/null
  podman run --rm --timeout 900 --pod "$pod" -e HOME=/tmp -e PORT=3000 -e BASE_DIR=/base -e PW_OUT=/out/playwright.json \
    -e SHOT_DIR=/out/screenshots -v "$hid":/w:Z -v "$scorer/node_modules":/w/node_modules:ro,Z -v "$base":/base:ro,Z \
    -v "$out":/out:Z -w /w "$PW" sh -c '
    for i in $(seq 30); do node -e "fetch(\"http://localhost:3000/\").then(r=>process.exit(r.ok?0:1),()=>process.exit(1))" && break; sleep 1; done
    npx playwright test -c playwright.config.mjs "$@"' sh "$@" > "$out/playwright.log" 2>&1
  podman pod rm -f "$pod" > /dev/null 2>&1
}

# results <ids...>: one check per id from playwright.json; a test that did not run or did not pass fails.
results() {
  jq -n --argjson ids "$(printf '%s\n' "$@" | jq -R . | jq -s .)" --slurpfile pw "$out/playwright.json" '
    [$pw[0] | .. | objects | select(has("specs")) | .specs[]] as $specs |
    [$ids[] as $id | ($specs | map(select(.title | split(" ")[0] == $id)) | first) as $s |
      if $s == null then {id: $id, ok: false, detail: "did not run"}
      else ($s.tests[0].results[-1]) as $r |
        {id: $id, ok: ($s.tests | all(.results[-1].status == "passed")),
         detail: (if $r.status == "passed" then "passed" else (($r.error.message // $r.status) | gsub("\u001b\\[[0-9;]*m"; "") | .[0:400]) end)}
      end]' 2>/dev/null || printf '%s\n' "$@" | jq -R '{id: ., ok: false, detail: "no test results"}' | jq -s .
}

# unbuilt <ids...>: every check failed because the site did not build.
unbuilt() { printf '%s\n' "$@" | jq -R --arg d "site build failed: $(tail -c 300 "$out/build.log" | tr -d '\033')" '{id: ., ok: false, detail: $d}' | jq -s .; }
