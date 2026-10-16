#!/bin/sh
# Validates the checks: the baseline fails the task's checks, the reference passes every check and its suite, and each
# mutant of the reference fails exactly its check. Usage: bench/briefs/skill-ship-release/validate.sh <scratch-dir>
set -eu
here=$(dirname "$(realpath "$0")"); tmp=$(realpath -m "$1"); mkdir -p "$tmp"
. "$here/../skill-common/validate-lib.sh"
build_reference
case_ baseline S1-version,S1-changelog,S1-package,S1-tag
case_ reference ""
retag='git -c commit.gpgsign=false commit -qa --amend -m "chore(release): $v" && git tag -d v2.0.0 > /dev/null && git -c tag.gpgsign=false tag -a "v$v" -m "v$v"'
case_ minor-version S1-version "v=1.3.0; sed -i 's/2\.0\.0/1.3.0/g' package.json package-lock.json src/version.js CHANGELOG.md && $retag"
case_ lock-stale S1-sync "R package-lock.json '\"version\": \"2.0.0\",
      \"license\"' '\"version\": \"1.2.0\",
      \"license\"'"
case_ changelog-not-moved S1-changelog "R CHANGELOG.md '## [2.0.0] - 2026-10-16

' '' '## [1.2.0]' '## [2.0.0] - 2026-10-16

## [1.2.0]'"
case_ tests-packed S1-package "R package.json '  \"files\": [
    \"src\"
  ],
' ''"
case_ lightweight-tag S1-tag "git tag -d v2.0.0 > /dev/null && git tag v2.0.0"
case_ convert-broken S1-regressions "R src/index.js '(v * 9) / 5 + 32' '(v * 9) / 5 + 31'"
