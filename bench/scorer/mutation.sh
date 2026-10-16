#!/bin/sh
# Mutation score of a built app's own tests: Stryker (pinned) on a copy of the workspace, which is never changed.
# Stryker's command runner reruns the suite per mutant (`npx vitest run` for vitest suites, else the `test:unit` script, else `npm test`): its vitest runner
# reported mutants as surviving that the suites demonstrably kill. Text literals are not mutated: the score is about
# behavior, not about whether tests pin every message's wording. No tsconfig rewriting: Stryker 10 calls a TypeScript API
# that TypeScript 7 removed. Tests that run sources in a `vm` context get `process` there (preload below): Stryker's
# instrumented code reads the active mutant from `process.env`, so without it no mutant switches on and the score reads 0.
# MUTATION_EXCLUDE: space-separated extra globs not to mutate (generated data files a test compares byte for byte).
# Usage: bench/scorer/mutation.sh <workspace> <out-dir>   writes mutation.json (Stryker report), mutation.exit, mutation.log
# Exit codes in mutation.exit: 0 report written, 10 npm install failed, 11 no test script, 12 Stryker install failed,
# 13 Stryker failed (for example the tests fail before mutation), 124 or 137 time limit (MUTATION_TIMEOUT, default 2700 s).
set -u
ws=$(realpath "$1"); out=$(realpath -m "$2")
# The full image: Stryker needs `ps`, which the slim image used for scoring lacks.
NODE=docker.io/library/node:22.23.3-bookworm@sha256:0e5f906573693feaa1e21057ebdcfdb5bd5021f050b2dc7c9deceb629c7da2a8
STRYKER=10.0.0
T=${MUTATION_TIMEOUT:-2700}
mkdir -p "$out" && rm -f "$out/mutation.json" "$out/mutation.exit"
app=$(mktemp -d) && trap 'rm -rf "$app"' EXIT
trap 'exit 130' INT TERM HUP
cp -a "$ws/." "$app/" && rm -rf "$app/node_modules" "$app/reports" "$app/.stryker-tmp"
podman run --rm --timeout "$T" --userns=keep-id -e HOME=/tmp -e CI=1 -e STRYKER="$STRYKER" -e MUTATION_EXCLUDE="${MUTATION_EXCLUDE:-}" \
  -v "$app":/app:Z -v "$out":/out:Z -w /app "$NODE" sh -c '
  npm install --no-audit --no-fund > /dev/null 2>&1 || exit 10
  has() { node -e "const p = require(\"./package.json\"); process.exit($1 ? 0 : 1)"; }
  # vitest directly, so a test script that also starts browser tests does not decide the score.
  if has "({ ...p.dependencies, ...p.devDependencies }).vitest"; then cmd="npx vitest run"
  elif has "p.scripts && p.scripts[\"test:unit\"]"; then cmd="npm run test:unit"
  elif has "p.scripts && p.scripts.test && !/no test specified/.test(p.scripts.test)"; then cmd="npm test"
  else exit 11; fi
  extra=""; for g in $MUTATION_EXCLUDE; do extra="$extra, \"!$g\""; done
  printf "%s\n" "const vm = require(\"node:vm\"), create = vm.createContext;" \
    "vm.createContext = (ctx = {}, ...rest) => { if (!(\"process\" in ctx)) ctx.process = process; return create(ctx, ...rest); };" > /tmp/vm-process.cjs
  npm install --no-save --no-audit --no-fund @stryker-mutator/core@$STRYKER > /dev/null 2>&1 || exit 12
  # Application source only: no tests, configuration, build output or dependencies.
  cat > /tmp/stryker.config.json <<EOF
{
  "testRunner": "command",
  "commandRunner": { "command": "NODE_OPTIONS=--require=/tmp/vm-process.cjs $cmd" },
  "coverageAnalysis": "off",
  "mutate": ["{src,lib,server,client,app,api,shared,routes,js}/**/*.{js,jsx,ts,tsx,mjs,cjs,mts,cts}", "*.{js,ts,mjs,cjs,mts,cts}",
    "!**/*.{test,spec}.*", "!**/{__tests__,test,tests,e2e}/**", "!**/{test-setup,setupTests,setup-tests}.*", "!**/*.config.*", "!**/{dist,build,node_modules,coverage}/**"$extra],
  "mutator": { "excludedMutations": ["StringLiteral"] },
  "reporters": ["json"],
  "jsonReporter": { "fileName": "/out/mutation.json" },
  "concurrency": 8,
  "tempDirName": "/tmp/stryker-tmp",
  "tsconfigFile": "/nonexistent/tsconfig.json"
}
EOF
  npx stryker run /tmp/stryker.config.json || exit 13' > "$out/mutation.log" 2>&1
rc=$?
[ "$rc" -ne 0 ] || [ -s "$out/mutation.json" ] || rc=13
echo "$rc" > "$out/mutation.exit"
exit 0
