#!/bin/sh
# Validates the checks: the baseline fails the task's checks, the reference passes every check and its suite, and each
# mutant of the reference fails exactly its check. Usage: bench/briefs/skill-specify-monthly/validate.sh <scratch-dir>
set -eu
here=$(dirname "$(realpath "$0")"); tmp=$(realpath -m "$1"); mkdir -p "$tmp"
. "$here/../skill-common/validate-lib.sh"
build_reference
case_ baseline S1-basic,S1-clamp,S1-anchor,S1-leap,S1-tz,S1-invalid
case_ reference ""
case_ no-year-carry S1-basic "R src/schedule.js 'return formatDate(new Date(Date.UTC(y, m + i, Math.min(day, last))));' 'return \`\${y}-\${String(m + i + 1).padStart(2, \"0\")}-\${String(Math.min(day, last)).padStart(2, \"0\")}\`;'"
case_ february-only S1-clamp "R src/schedule.js 'const last = new Date(Date.UTC(y, m + i + 1, 0)).getUTCDate();' 'const last = (m + i) % 12 === 1 ? new Date(Date.UTC(y, m + i + 1, 0)).getUTCDate() : 31;'"
case_ drift S1-anchor "R src/schedule.js 'const y = d.getUTCFullYear()' 'let prev; const y = d.getUTCFullYear()' 'Math.min(day, last)' '(prev = Math.min(i ? prev : day, last))'"
case_ every-fourth-year S1-leap "R src/schedule.js 'const last = new Date(Date.UTC(y, m + i + 1, 0)).getUTCDate();' 'const last = [31, (y + Math.floor((m + i) / 12)) % 4 ? 28 : 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][(m + i) % 12];'"
case_ local-time S1-tz "R src/schedule.js 'formatDate(new Date(Date.UTC(y, m + i, Math.min(day, last))))' 'formatDate(new Date(y, m + i, Math.min(day, last)))'"
case_ count-unchecked S1-invalid "R src/schedule.js '  checkCount(count);
  const d = parseDate(start);
  const y' '  const d = parseDate(start);
  const y'"
case_ weekly-broken S1-regressions "R src/schedule.js 'i * 7 * DAY' 'i * 6 * DAY'"
