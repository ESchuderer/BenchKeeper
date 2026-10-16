#!/bin/sh
# Builds the baseline (fixture repo/, one commit): bench/briefs/skill-common/prepare.sh. Usage: prepare.sh <out-dir>
here=$(dirname "$(realpath "$0")"); exec "$here/../skill-common/prepare.sh" "$here" "$@"
