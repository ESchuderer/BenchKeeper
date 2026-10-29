#!/bin/sh
# Usage: <unified diff> | check.sh
# Exit 1 and print each added line that suppresses a finding (an ignore or disable comment, an exclusion) and each changed
# configuration file of a linter, scanner or quality gate; exit 0 for a fix without one.
awk '
/^\+\+\+ / { file = substr($2, 3) }
/^diff --git / { f = $4; sub(/^b\//, "", f)
  if (f ~ /(^|\/)(\.eslintrc[^\/]*|eslint\.config\.[a-z]+|\.eslintignore|\.stylelintrc[^\/]*|biome\.jsonc?|\.flake8|\.pylintrc|ruff\.toml|\.ruff\.toml|\.rubocop[^\/]*\.yml|\.golangci\.ya?ml|\.semgrepignore|\.sonarcloud\.properties|sonar-project\.properties|codeql-config\.ya?ml|\.codeclimate\.yml|\.bandit|tslint\.json)$/) { print "config: " f; bad = 1 } }
/^\+/ && !/^\+\+\+ / && tolower($0) ~ /eslint-disable|biome-ignore|deno-lint-ignore|@ts-ignore|@ts-expect-error|@ts-nocheck|noqa|nosec|nosonar|nolint|pylint: *disable|type: *ignore|rubocop: *disable|phpcs: *ignore|shellcheck +disable|@suppresswarnings|#\[allow\(|codeql\[|lgtm\[|istanbul +ignore|c8 +ignore|coverage +disable|checkov:skip|semgrep: *ignore|nosemgrep/ { print "suppression: " file ": " substr($0, 2); bad = 1 }
END { exit bad }
'
