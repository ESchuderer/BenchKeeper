#!/bin/sh
# Usage: list.sh <adapter> <linter> <token_var>
# Prints the open findings of the default branch, one line per rule and file: `<count> <rule> <file>`, most first.
#   code-scanning  the open code scanning alerts of the repository of the checkout (gh); none set up or no access: no work
#   linter         the JSON report that <linter> prints, a relative path to an executable file tracked by git, run in the
#                  checkout: ESLint JSON or SARIF
#   quality-gate   prints `gate <token_var>` when the variable <token_var> is set: the run reads the findings from the service
# Exit 0 when it printed a line.
case "$1" in
  code-scanning)
    r=$(gh repo view --json nameWithOwner --jq .nameWithOwner) || exit 1
    json=$(gh api --paginate --slurp "repos/$r/code-scanning/alerts?state=open&per_page=100" 2>/dev/null) || { echo "code scanning cannot be read for $r" >&2; exit 1; } ;;
  linter)
    case "/$2/" in */../*|//*) echo "not a valid linter: $2" >&2; exit 2 ;; esac
    [ -f "$2" ] && [ -x "$2" ] && git ls-files --error-unmatch -- "$2" >/dev/null 2>&1 || { echo "not a valid linter: $2" >&2; exit 2; }
    # A linter exits non-zero when it finds something; only its report counts.
    json=$("./$2") ;;
  quality-gate)
    printf '%s\n' "$3" | grep -qxE '[A-Za-z_][A-Za-z0-9_]*' || { echo "not a variable name: $3" >&2; exit 2; }
    # shortcut: helpers may not use the network, so the service is not asked here; a set token starts the weekly run.
    [ -n "$(printenv "$3")" ] || exit 1
    echo "gate $3"; exit 0 ;;
  *) echo "unknown adapter: $1" >&2; exit 2 ;;
esac
# One `<rule> <file>` per finding from code scanning alerts (pages slurped into one array), SARIF or ESLint JSON.
printf '%s' "$json" | node -e '
let d = JSON.parse(require("fs").readFileSync(0, "utf8") || "[]");
const out = [];
if (Array.isArray(d) && d.every(Array.isArray)) d = d.flat();
if (d.runs) for (const run of d.runs) for (const r of run.results ?? []) out.push([r.ruleId ?? r.rule?.id, r.locations?.[0]?.physicalLocation?.artifactLocation?.uri]);
else for (const f of d) {
  if (f.rule) out.push([f.rule.id, f.most_recent_instance?.location?.path]);
  else for (const m of f.messages ?? []) out.push([m.ruleId ?? "parse-error", require("path").relative(process.cwd(), f.filePath)]);
}
for (const [rule, file] of out) console.log(`${rule ?? "-"} ${file ?? "-"}`);
' | sort | uniq -c | sort -k1,1nr -k2 | awk '{ print $1, $2, $3; n++ } END { exit n ? 0 : 1 }'
