#!/bin/sh
# Fake claude for bench/scripts/trigger-eval.smoke.sh (no network, no credentials). The usage gate's request gets rate-limit
# headers; an eval query triggers the injected command unless the query contains "?", and only when the harness set
# everything up: model claude-fake-1, effort low (added by the wrapper), the fake token, exactly one injected command,
# and the installed copy of the skill hidden from the model.
case "$*" in *"Reply OK"*)
  printf '  "anthropic-ratelimit-unified-5h-utilization": "0.10",\n  "anthropic-ratelimit-unified-5h-reset": "1",\n'
  printf '  "anthropic-ratelimit-unified-7d-utilization": "0.20",\n  "anthropic-ratelimit-unified-7d-reset": "1",\n'
  exit 0 ;;
esac
q= m= e=
while [ $# -gt 0 ]; do
  case $1 in -p) q=$2; shift ;; --model) m=$2; shift ;; --effort) e=$2; shift ;; esac
  shift
done
cmds=$(ls .claude/commands/*-skill-*.md 2>/dev/null)
# Copies for other agents (Ponytail ships `.openclaw/skills/`) are not loaded by Claude Code.
installed=$(find "$HOME/.claude" .claude/skills -path "*/$SKILL/SKILL.md" -not -path "*/.openclaw/*" -not -path "*/.opencode/*" -not -path "*/.codex/*" 2>/dev/null)
ok=yes
[ "$m" = claude-fake-1 ] && [ "$e" = low ] && [ "$CLAUDE_CODE_OAUTH_TOKEN" = fake-smoke-token ] || ok=no
[ "$(printf '%s\n' "$cmds" | grep -c .)" = 1 ] || ok=no
[ -n "$installed" ] && ! printf '%s\n' "$installed" | xargs grep -L '^disable-model-invocation: true' | grep -q . || ok=no
case $q in *'?'*) ok=no ;; esac
if [ "$ok" = yes ]; then
  name=$(basename "$cmds" .md)
  printf '{"type":"stream_event","event":{"type":"content_block_start","content_block":{"type":"tool_use","name":"Skill"}}}\n'
  jq -cn --arg n "$name" '{type:"stream_event",event:{type:"content_block_delta",delta:{type:"input_json_delta",partial_json:({skill:$n}|tojson)}}}'
  printf '{"type":"stream_event","event":{"type":"content_block_stop"}}\n'
else
  printf '{"type":"stream_event","event":{"type":"message_stop"}}\n'
fi
