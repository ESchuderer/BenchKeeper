#!/bin/sh
# Runs one arm over the SkillsBench tasks (PROTOCOL, SkillsBench): Claude Code 2.1.299 on Sonnet 5.5, effort medium, on the
# subscription (CLAUDE_FORCE_OAUTH drops any API key), one task at a time with 4 CPUs and 8 GB per task container.
# bike-rebalance is left out (no-network task, crashes local runs: JetBrains, RTK post). A rerun with the same job name resumes.
# Setup: bench/skillsbench/harbor.sh. Tasks: harbor datasets download benchflow/skillsbench -o ~/.cache/benchkeeper/skillsbench/tasks.
# Arm bundles: bench/skillsbench/arm-tar.sh <arm> ~/.cache/benchkeeper/skillsbench/arms.
# Usage: bench/skillsbench/run-arm.sh <arm> [job name] [harbor run arguments, e.g. -i dialogue-parser]
set -eu
arm=$1 job=${2:-$1}
here=$(dirname "$(realpath "$0")") c=$HOME/.cache/benchkeeper/skillsbench
# Run as its own systemd user unit: containers started from a terminal app's scope (Orca, VS Code) lose their conmon when
# that app restarts or reaps its processes, and the trial dies. Log: jobs/<job>.log, status: systemctl --user status bk-<job>.
if [ -z "${BK_UNIT:-}" ]; then
  mkdir -p "$c/jobs"
  exec systemd-run --user --collect --quiet --unit "bk-$job" -p Nice=10 -p "StandardOutput=append:$c/jobs/$job.log" \
    -p "StandardError=append:$c/jobs/$job.log" -E BK_UNIT=1 -E "BK_TOKEN_FILE=${BK_TOKEN_FILE:-}" -E PATH="$PATH" "$(realpath "$0")" "$@"
fi
shift; [ $# -eq 0 ] || shift
export BK_ARM_TAR=$c/arms/$arm.tgz CLAUDE_FORCE_OAUTH=1
[ -f "$BK_ARM_TAR" ] || { echo "missing $BK_ARM_TAR" >&2; exit 1; }
CLAUDE_CODE_OAUTH_TOKEN=$(cat "${BK_TOKEN_FILE:-$HOME/.config/benchkeeper/oauth-token-team}"); export CLAUDE_CODE_OAUTH_TOKEN
unset ANTHROPIC_API_KEY
cd "$c"
if [ -d "jobs/$job" ]; then exec "$here/harbor.sh" jobs resume -p "jobs/$job" -y; fi
exec "$here/harbor.sh" run -p tasks/skillsbench -a bk_agent:ArmClaudeCode -m anthropic/claude-sonnet-5-5 --effort medium \
  --ak version=2.1.299 -x bike-rebalance -o jobs --job-name "$job" -y "$@"
