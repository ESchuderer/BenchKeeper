#!/bin/sh
# See bench/briefs/scb/checks/suite.sh.
exec "$(dirname "$(realpath "$0")")/../../scb/checks/suite.sh" "$@"
