#!/bin/sh
# SlopCodeBench problem as a step brief: fetches gabeorlanski/scb-problems at the pinned commit into .cache/ (git-ignored:
# the benchmark data carries a canary and stays out of this repository), writes the brief's steps/<k>.md (git-ignored, one
# per checkpoint: the harness's just-solve prompt) and builds the baseline in <out-dir>: an empty
# repository with one commit "chore: baseline" (fixed author and date).
# Usage: bench/briefs/scb/prepare.sh <problem> <brief-dir> <out-dir>
set -eu
problem=$1 brief=$(realpath "$2") out=$(realpath -m "$3")
here=$(dirname "$(realpath "$0")")
. "$here/config.sh"
cache=$here/.cache/problems-$PROBLEMS
if [ ! -d "$cache" ]; then
  rm -rf "$cache.tmp" && mkdir -p "$cache.tmp"
  rm -rf "$cache.src" && git init -q "$cache.src" && git -C "$cache.src" fetch -q --depth 1 https://github.com/gabeorlanski/scb-problems "$PROBLEMS"
  git -C "$cache.src" archive FETCH_HEAD | tar -x -C "$cache.tmp" && rm -rf "$cache.src"
  mv "$cache.tmp" "$cache"
fi
[ "${SKIP_BUILD:-}" = 1 ] || [ "${PROMPTS_ONLY:-}" = 1 ] || podman build -q -t benchkeeper-scb "$here" > /dev/null
p=$cache/$problem
entry=$(awk '$1 == "entry_file:" {print $2}' "$p/config.yaml").py
rm -rf "$brief/steps" && mkdir -p "$brief/steps"
n=$(ls "$p" | grep -cE '^checkpoint_[0-9]+\.md$')
for k in $(seq "$n"); do
  {
    echo 'Implement a program that 100% solves the specification. That is all you need to do.'
    if [ "$k" = 1 ]; then
      echo 'Use a virtual environment and ensure that a `requirements.txt` is present with any dependencies you need to solve the problem.'
    else
      echo 'Keep using the same virtual environment you started with, update `requirements.txt` with any new dependencies you need.'
    fi
    echo
    echo 'Your task is:'
    sed -e "s/%%%ENTRYPOINT:entry_file%%%/$entry/g" -e "s/%%%ENTRYPOINT:entry_command%%%/python $entry/g" "$p/checkpoint_$k.md"
    echo

  } > "$brief/steps/$k.md"
done
[ "${PROMPTS_ONLY:-}" != 1 ] || exit 0
mkdir -p "$out"
[ -z "$(ls -A "$out")" ] || { echo "prepare: $out is not empty" >&2; exit 1; }
git -C "$out" init -q -b main
GIT_AUTHOR_NAME=BenchKeeper GIT_AUTHOR_EMAIL=baseline@benchkeeper.invalid GIT_AUTHOR_DATE=2026-10-18T09:00:00+02:00 \
GIT_COMMITTER_NAME=BenchKeeper GIT_COMMITTER_EMAIL=baseline@benchkeeper.invalid GIT_COMMITTER_DATE=2026-10-18T09:00:00+02:00 \
  git -C "$out" -c commit.gpgsign=false commit -q --allow-empty --no-verify -m "chore: baseline"
