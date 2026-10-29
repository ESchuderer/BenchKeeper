#!/bin/sh
# Usage: <unified diff> | check.sh
# Exit 1 and print each added line that suppresses a finding (an ignore or disable comment, an exclusion), each changed
# configuration file of a linter, scanner or quality gate (under its old name too when renamed) and each changed line
# in a quality tool section of pyproject.toml, setup.cfg or tox.ini; exit 0 for a fix without one.
awk '
# git quotes a path with non-ASCII characters ("b/caf\303\251/tsconfig.json"): the match needs it without the quotes.
function unquote(s) { return s ~ /^".*"$/ ? substr(s, 2, length(s) - 2) : s }
function istool(s) { return tolower(s) ~ /^[ \t]*\[+(tool[.:])?(ruff|mypy|basedpyright|pyright|coverage|flake8|pylint)/ }
# Whether the section above line at of a blob (from the index line) is a tool section, -1 when git does not have the blob.
function intool(blob, at,   cmd, l, n, t, ok) {
  if (blob !~ /^[0-9a-f]+$/ || blob ~ /^0+$/) return -1
  cmd = "git cat-file -p " blob " 2>/dev/null"
  while (n < at - 1 && (cmd | getline l) > 0) { n++; ok = 1; if (l ~ /^[ \t]*\[/) t = istool(l) }
  close(cmd); return ok ? t + 0 : -1
}
/^\+\+\+ / { file = substr(unquote($2), 3) }
/^diff --git / { split("", blob); f = unquote($4); sub(/^b\//, "", f); old = unquote($3); sub(/^a\//, "", old)
  ini = f ~ /(^|\/)(pyproject\.toml|setup\.cfg|tox\.ini)$/
  if (old != f && old ~ /(^|\/)(pyproject\.toml|setup\.cfg|tox\.ini)$/) { print "config: " old; bad = 1 }
  for (i = 0; i < 2; i++) { n = i ? old : f
    if ((!i || n != f) && n ~ /(^|\/)(\.eslintrc[^\/]*|eslint\.config\.[a-z]+|\.eslintignore|\.stylelintrc[^\/]*|biome[^\/]*\.jsonc?|\.?knip\.jsonc?|tsconfig[^\/]*\.json|tsc-baseline\.sh|\.basedpyright\/baseline\.json|\.flake8|\.pylintrc|ruff\.toml|\.ruff\.toml|\.rubocop[^\/]*\.yml|\.golangci\.ya?ml|\.semgrepignore|\.sonarcloud\.properties|sonar-project\.properties|codeql-config\.ya?ml|\.codeclimate\.yml|\.bandit|tslint\.json)$/) { print "config: " n; bad = 1 } } }
/^index / { split($2, blob, /\.\./) }
# The section header is not part of the hunk header: a hunk that starts below line 1 is in the section above it in the blob of
# either side, else in an unknown section until one appears, which counts as a tool section.
ini && /^@@ / { split($2, o, ","); split($3, h, ","); at = substr(h[1], 2) + 0
  tool = at > 1 && ((t = intool(blob[2], at)) >= 0 || (t = intool(blob[1], substr(o[1], 2) + 0)) >= 0 ? t : 1) }
ini && /^[-+ ][ \t]*\[/ { tool = istool(substr($0, 2)) }
ini && tool && /^[-+]/ && !/^(\+\+\+|---) / { print "config: " file ": " $0; bad = 1 }
/^\+/ && !/^\+\+\+ / && tolower($0) ~ /eslint-disable|biome-ignore|deno-lint-ignore|@ts-ignore|@ts-expect-error|@ts-nocheck|noqa|nosec|nosonar|nolint|pylint: *disable|type: *ignore|rubocop: *disable|phpcs: *ignore|shellcheck +disable|@suppresswarnings|#\[allow\(|codeql\[|lgtm\[|istanbul +ignore|c8 +ignore|v8 +ignore|pragma: *no +cover|stryker[- ]+disable|coverage +(disable|ignore)|checkov:skip|semgrep: *ignore|nosemgrep/ { print "suppression: " file ": " substr($0, 2); bad = 1 }
END { exit bad }
'
