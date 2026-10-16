#!/bin/sh
# Step 1 checks (checks.mjs) through checks/lib/checks.sh. Usage: checks/step1.sh <workspace> <out-dir>
here=$(dirname "$(realpath "$0")"); exec "$here/lib/checks.sh" "$(dirname "$here")" "$@"
