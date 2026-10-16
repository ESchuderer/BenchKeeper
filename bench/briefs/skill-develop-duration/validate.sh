#!/bin/sh
# Validates the checks: the baseline fails the task's checks, the reference passes every check and its suite, and each
# mutant of the reference fails exactly its check. Usage: bench/briefs/skill-develop-duration/validate.sh <scratch-dir>
set -eu
here=$(dirname "$(realpath "$0")"); tmp=$(realpath -m "$1"); mkdir -p "$tmp"
. "$here/../skill-common/validate-lib.sh"
build_reference
case_ baseline S1-parse,S1-config,S1-cli
case_ reference ""
case_ last-part-only S1-parse "R src/duration.js 'ms += Number(n)' 'ms = Number(n)'"
case_ config-own-check S1-config "R src/config.js 'if (!DURATION.test(value))' 'if (!/^\\d+(ms|s|m|h)\$/.test(value))'"
case_ cli-own-check S1-cli "R src/cli.js 'if (!DURATION.test(v' 'if (!/^\\d+(ms|s|m|h)\$/.test(v'"
case_ leftovers-ignored S1-invalid "R src/duration.js 'if (!DURATION.test(s))' 'if (!/^\\d+(ms|s|m|h)/.test(s))'"
case_ config-message S1-regressions "R src/config.js 'throw new Error(\`config: jobs[\${i}].\${key}: invalid duration \${value}\`)' 'throw new RangeError(\`invalid duration \${value}\`)'"
