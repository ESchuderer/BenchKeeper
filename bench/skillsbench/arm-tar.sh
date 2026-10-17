#!/bin/sh
# Packs one arm's install from its image (benchkeeper-arm-<arm>) for bench/skillsbench/bk_agent.py:
#   claude/   ~/.claude without backups (plugins, rules, user skills, settings)
#   ponytail/ ~/.config/ponytail          openspec/  ~/.config/openspec
#   bench-src/ plugin marketplaces        node, npm/ Node 22 and the global npm packages (OpenSpec), for hooks and the CLI
#   project/  the project template without .devcontainer, .mcp.json and .git, BenchKeeper layer arms only (owner, 2026-10-17)
# Arm O's OpenSpec skills come from its project template into claude/skills (machine level only).
# Usage: bench/skillsbench/arm-tar.sh <arm> <out-dir>
set -eu
arm=$1 out=$(realpath "$2"); mkdir -p "$out"
case $arm in AD|AE|AG|AH) project=1 ;; *) project=0 ;; esac
podman run --rm --userns=keep-id --entrypoint sh -e P=$project -v "$out":/out:Z "benchkeeper-arm-$(echo "$arm" | tr A-Z a-z)" -c '
  set -eu; a=/tmp/a; mkdir -p $a; cd ~
  cp -a .claude $a/claude && rm -rf $a/claude/backups
  for d in ponytail openspec; do [ ! -d .config/$d ] || cp -a .config/$d $a/$d; done
  [ ! -d .bench-src ] || cp -a .bench-src $a/bench-src
  cp /usr/local/bin/node $a/node
  [ ! -d .local/lib/node_modules ] || cp -a .local/lib/node_modules $a/npm
  [ ! -d project-template/openspec ] || [ "$P" = 1 ] || cp -a project-template/.claude/skills/. $a/claude/skills/
  if [ "$P" = 1 ]; then cp -a project-template $a/project && rm -rf $a/project/.devcontainer $a/project/.mcp.json $a/project/.git; fi
  tar czf /out/'"$arm"'.tgz -C $a .'
ls -l "$out/$arm.tgz"
