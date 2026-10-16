#!/bin/sh
# The repository's own tests through checks/lib/suite.sh. Usage: checks/suite.sh <workspace> <out-dir>
here=$(dirname "$(realpath "$0")"); exec "$here/lib/suite.sh" "$@"
