#!/bin/sh
# Skill authoring check (#58): extracts the skills installed in the pinned arm images and runs bench/scripts/skill-lint.mjs
# on each collection, BenchKeeper's own from skills/. Arm A (plain Claude Code) has no skills, so each arm's skills are its
# framework's. Usage: bench/scripts/skill-lint.sh <out-dir>   writes <out-dir>/skill-lint.json and skill-lint.md
set -eu
repo=$(dirname "$(dirname "$(dirname "$(realpath "$0")")")"); out=$(realpath -m "$1"); x=$(mktemp -d)
trap 'rm -rf "$x"' EXIT
NODE=docker.io/library/node:22.23.3-bookworm-slim@sha256:efd0ab5780c2d9ab1f0f869571a00d5edb17793bff4cce4a2792e3eb0ffc7562
mkdir -p "$out"
for arm in B F G H V AB AC; do
  mkdir -p "$x/$arm"
  # Whole plugin folders, so evaluations and shared references next to `skills/` count; the template's `.specify/` too.
  podman run --rm "benchkeeper-arm-$(echo "$arm" | tr A-Z a-z)" sh -c 'cd "$HOME" && ls -d .claude/plugins/cache .claude/skills project-template/.claude \
    project-template/.specify 2>/dev/null | tar -c --exclude="*/node_modules/*" --exclude="*/.git/*" -T -' | tar -x -C "$x/$arm"
done
cp -r "$repo/skills" "$x/BK"
set -- agent-skills=/x/F/.claude/plugins/cache/addy-agent-skills/agent-skills/0.6.13 \
  Superpowers=/x/G/.claude/plugins/cache/superpowers-dev/superpowers/7.0.0 ECC=/x/H/.claude/skills \
  Matt-Pocock=/x/V/.claude/plugins/cache/mattpocock/mattpocock-skills/1.3.1 Ponytail=/x/B/.claude/plugins/cache/ponytail/ponytail/5.2.0 \
  OpenSpec=/x/AB/project-template/.claude/skills Spec-Kit=/x/AC/project-template/.claude/skills BenchKeeper=/x/BK
for d in "$@"; do [ -d "$x/${d#*=/x/}" ] || { echo "skill-lint: ${d%%=*} not found at ${d#*=} (image or version changed?)" >&2; exit 1; }; done
podman run --rm --userns=keep-id -e HOME=/tmp -v "$repo":/repo:ro,Z -v "$x":/x:ro,Z -w /repo "$NODE" node bench/scripts/skill-lint.mjs "$@" > "$out/skill-lint.json"
podman run --rm --userns=keep-id -e HOME=/tmp -v "$repo":/repo:ro,Z -v "$x":/x:ro,Z -w /repo "$NODE" node bench/scripts/skill-lint.mjs --md "$@" > "$out/skill-lint.md"
