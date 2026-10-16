#!/bin/sh
# Validates the step 1 checks: the reference passes every S1 check, and each mutant fails exactly its check.
# Builds the baseline with prepare.sh, applies reference/step1 as three commits into <scratch-dir>/step1 (left in
# place for later steps), then runs checks/step1.sh on one copy per case.
# Usage: bench/briefs/openballistics/checks/validate-step1.sh <scratch-dir>
set -eu
here=$(dirname "$(realpath "$0")"); brief=$(dirname "$here"); tmp=$(realpath -m "$1"); mkdir -p "$tmp"
NODE=docker.io/library/node:22.23.3-bookworm@sha256:0e5f906573693feaa1e21057ebdcfdb5bd5021f050b2dc7c9deceb629c7da2a8
commit() { # <dir> <message> <paths...>: commits in the node container (the tree is third-party code), fixed author
  d=$1; shift
  podman run --rm --network none --userns=keep-id -e HOME=/tmp -v "$d":/w:Z -w /w \
    -e GIT_AUTHOR_NAME=Reference -e GIT_AUTHOR_EMAIL=reference@benchkeeper.invalid -e GIT_AUTHOR_DATE=2026-10-16T12:00:00Z \
    -e GIT_COMMITTER_NAME=Reference -e GIT_COMMITTER_EMAIL=reference@benchkeeper.invalid -e GIT_COMMITTER_DATE=2026-10-16T12:00:00Z \
    "$NODE" sh -c 'm=$1; shift; git add -A -- "$@" && git -c commit.gpgsign=false commit -q --no-verify -m "$m"' sh "$@"
}
rm -rf "$tmp/step1"; "$brief/prepare.sh" "$tmp/step1" > /dev/null
cp -a "$brief/reference/step1/." "$tmp/step1/"
commit "$tmp/step1" "ci: checks, Pages deployment and tag-triggered release workflows" .github/workflows
commit "$tmp/step1" "ci: Dependabot for npm and GitHub Actions" .github/dependabot.yml
commit "$tmp/step1" "docs: README and Keep a Changelog CHANGELOG" README.md CHANGELOG.md

run() { # <name> <expected failing ids> <file> <sed script, or rm, or empty> [commit message]
  rm -rf "$tmp/$1" "$tmp/$1-out"; cp -a "$tmp/step1" "$tmp/$1"
  case "$4" in rm) rm "$tmp/$1/$3" ;; '') ;; *) sed -i "$4" "$tmp/$1/$3" ;; esac
  [ -z "$4" ] || ! diff -rq -x .git "$tmp/step1" "$tmp/$1" > /dev/null || { echo "$1: mutation not applied"; exit 1; }
  [ $# -lt 5 ] || commit "$tmp/$1" "$5" "$3"
  "$here/step1.sh" "$tmp/$1" "$tmp/$1-out" > /dev/null 2>&1 || { echo "$1: step1.sh failed"; exit 1; }
  got=$(jq -r '[.checks[] | select(.ok | not) | .id] | join(",")' "$tmp/$1-out/checks.json")
  [ "$got" = "$2" ] && echo "$1: ok (failing: ${got:-none})" || { echo "$1: expected '$2', got '$got'"; exit 1; }
}
ci=.github/workflows/ci.yml pages=.github/workflows/pages.yml
run reference "" README.md ""
run invalid-workflow S1-actionlint $ci 's/^    runs-on: ubuntu-latest$/    run-on: ubuntu-latest/'
run ci-no-test S1-ci-checks $ci '/^      - run: npm test$/d'
run unknown-script S1-npm-scripts $ci 's/^      - run: npm run build$/&\n      - run: npm run lint/'
run unpinned S1-sha-pins $ci 's/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1/checkout@v7/'
run write-all S1-permissions $ci '/^permissions:$/{N;s/.*/permissions: write-all/}'
run prt S1-no-prt $ci 's/^  pull_request:$/&\n  pull_request_target:/'
run secret S1-secrets $ci 's/^      - run: npm ci$/&\n        env:\n          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}/'
run deploy-any-branch S1-pages-trigger $pages "s/^    branches: \[main\]$/    branches: ['**']/"
run no-release S1-release .github/workflows/release.yml rm
run no-changelog S1-changelog CHANGELOG.md rm
run no-dependabot S1-dependency-updates .github/dependabot.yml rm
run no-license S1-readme-sections README.md '/^## License$/,$d'
run readme-unknown-script S1-readme-commands README.md 's/npm run preview/npm run serve/'
run unconventional-commit S1-commits README.md 's/browse their dimensions/browse the dimensions/' "Update README"
run dispatch-unguarded S1-pages-trigger $pages 's/^    branches: \[main\]$/&\n  workflow_dispatch:/'
run dispatch-guarded "" $pages "s/^    branches: \\[main\\]\$/&\\n  workflow_dispatch:/; s#^  build:\$#&\\n    if: github.ref == 'refs/heads/main'#"
# Only a harness commit ("chore: project setup") after the baseline: no agent commit.
rm -rf "$tmp/harness-only" "$tmp/harness-only-out"; cp -a "$tmp/step1" "$tmp/harness-only"
podman run --rm --network none --userns=keep-id -e HOME=/tmp -v "$tmp/harness-only":/w:Z -w /w "$NODE" \
  sh -c 'git reset -q --soft HEAD~3 && git -c user.name=Harness -c user.email=harness@benchkeeper.invalid commit -q -m "chore: project setup"'
"$here/step1.sh" "$tmp/harness-only" "$tmp/harness-only-out" > /dev/null 2>&1 || { echo "harness-only: step1.sh failed"; exit 1; }
got=$(jq -r '[.checks[] | select(.ok | not) | .id] | join(",")' "$tmp/harness-only-out/checks.json")
[ "$got" = S1-commits ] && echo "harness-only: ok (failing: $got)" || { echo "harness-only: expected 'S1-commits', got '$got'"; exit 1; }
# The other reading of the step's ambiguity: Pages deployed from release tags instead of main.
run deploy-on-tags "" $pages "s/^    branches: \[main\]$/    tags: ['v*.*.*']/"
