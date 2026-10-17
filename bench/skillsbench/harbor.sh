#!/bin/sh
# Runs Harbor 0.24.0 under podman for the SkillsBench runs (PROTOCOL, SkillsBench) at low CPU priority, BK_PARALLEL tasks at a time (default 1).
# Setup (once, outside the repository): python3 -m venv ~/.cache/benchkeeper/harbor-0.24.0 && ~/.cache/benchkeeper/harbor-0.24.0/bin/pip install harbor==0.24.0;
# docker-compose v5.5.1 (sha256-checked release binary) at ~/.cache/benchkeeper/bin/docker-compose-linux-x86_64;
# systemctl --user start podman.socket. Harbor 0.24.0 runs `podman compose ls`, which podman-compose lacks: the Compose v2
# provider on the podman socket supports it.
# Usage: bench/skillsbench/harbor.sh run|jobs ... (Harbor arguments)
set -eu
c=$HOME/.cache/benchkeeper
export PODMAN_COMPOSE_PROVIDER=$c/bin/docker-compose-linux-x86_64 PODMAN_COMPOSE_WARNING_LOGS=false
export PYTHONPATH=$(dirname "$(realpath "$0")")  # bk_agent.py
export DOCKER_HOST=unix://${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/podman/podman.sock
[ -S "${DOCKER_HOST#unix://}" ] || { echo "podman socket missing: systemctl --user start podman.socket" >&2; exit 1; }
[ "${1:-}" = run ] && { shift; set -- run -e podman --cpus limit --override-cpus 4 --override-memory-mb 8192 -n "${BK_PARALLEL:-1}" "$@"; }
exec nice -n 10 "$c/harbor-0.24.0/bin/harbor" "$@"  # run-arm.sh starts it in its own systemd unit
