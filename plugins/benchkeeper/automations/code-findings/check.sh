#!/bin/sh
# Usage: <unified diff> | check.sh
# Exit 1 and print each added line that suppresses a finding (an ignore or disable comment, an exclusion), each changed
# configuration file of a linter, scanner or quality gate (under its old name too when renamed) and each changed line
# in a quality tool section of pyproject.toml, setup.cfg or tox.ini; exit 0 for a fix without one.
awk '
/^\+\+\+ / { file = substr($2, 3) }
/^diff --git / { f = $4; sub(/^b\//, "", f); old = $3; sub(/^a\//, "", old)
  ini = f ~ /(^|\/)(pyproject\.toml|setup\.cfg|tox\.ini)$/
  for (i = 0; i < 2; i++) { n = i ? old : f
    if ((!i || n != f) && n ~ /(^|\/)(\.eslintrc[^\/]*|eslint\.config\.[a-z]+|\.eslintignore|\.stylelintrc[^\/]*|biome[^\/]*\.jsonc?|\.?knip\.jsonc?|tsconfig[^\/]*\.json|tsc-baseline\.sh|\.basedpyright\/baseline\.json|\.flake8|\.pylintrc|ruff\.toml|\.ruff\.toml|\.rubocop[^\/]*\.yml|\.golangci\.ya?ml|\.semgrepignore|\.sonarcloud\.properties|sonar-project\.properties|codeql-config\.ya?ml|\.codeclimate\.yml|\.bandit|tslint\.json)$/) { print "config: " n; bad = 1 } } }
# The section header is not part of the hunk header: a hunk that starts below line 1 is in an unknown section until
# one appears, and counts as a tool section.
ini && /^@@ / { split($3, h, ","); tool = substr(h[1], 2) + 0 > 1 }
ini && /^[-+ ]\[/ { tool = tolower($0) ~ /^.\[+(tool[.:])?(ruff|mypy|basedpyright|pyright|coverage|flake8|pylint)/ }
ini && tool && /^[-+]/ && !/^(\+\+\+|---) / { print "config: " file ": " $0; bad = 1 }
/^\+/ && !/^\+\+\+ / && tolower($0) ~ /eslint-disable|biome-ignore|deno-lint-ignore|@ts-ignore|@ts-expect-error|@ts-nocheck|noqa|nosec|nosonar|nolint|pylint: *disable|type: *ignore|rubocop: *disable|phpcs: *ignore|shellcheck +disable|@suppresswarnings|#\[allow\(|codeql\[|lgtm\[|istanbul +ignore|c8 +ignore|v8 +ignore|pragma: *no +cover|stryker-disable|coverage +disable|checkov:skip|semgrep: *ignore|nosemgrep/ { print "suppression: " file ": " substr($0, 2); bad = 1 }
END { exit bad }
'
