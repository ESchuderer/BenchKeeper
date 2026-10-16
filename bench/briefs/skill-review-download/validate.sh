#!/bin/sh
# Validates the checks: the baseline fails the task's checks, the reference passes every check and its suite, and each
# mutant of the reference (mutants/<name>/, copied over it) fails exactly its check. Usage: bench/briefs/skill-review-download/validate.sh <scratch-dir>
set -eu
here=$(dirname "$(realpath "$0")"); tmp=$(realpath -m "$1"); mkdir -p "$tmp"
. "$here/../skill-common/validate-lib.sh"
build_reference
case_ baseline S1-traversal,S1-missing,S1-encoding
case_ reference ""
# Reverting the commit under review is no fix: the commit's own test fails.
case_ reverted S1-regressions "git checkout -q HEAD~2 -- src/server.js"
m() { case_ "$1" "$2" "cp -a /brief/mutants/$1/. ."; }
m prefix-check S1-traversal
m no-stat S1-missing
m no-decode-guard S1-encoding
m health-changed S1-regressions
