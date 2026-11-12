#!/bin/sh
# PreToolUse hook of an exported run, on each Bash call (JSON on stdin). It allows git add, git commit and gh issue comment
# only as the exact commands of step 5, with the digest path: $1 with a real date in place of YYYY-MM-DD (or $1 itself
# without it), in mode act ($3) with commit true ($4) or issue $2. It denies every other call with the words git add,
# git commit, gh issue comment or gh pr comment, and answers nothing for the rest, so the run's allow rules decide those.
file=$1 issue=$2 mode=$3 commit=$4
in=$(cat)
# The value of tool_input.command with its JSON escapes: a raw quote or newline never sits inside a JSON string.
c=$(printf '%s\n' "$in" | sed -n -E 's/.*"command"[[:space:]]*:[[:space:]]*"(([^"\\]|\\.)*)".*/\1/p' | head -n 1)
say() { printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"%s","permissionDecisionReason":"%s"}}\n' "$1" "$2"; exit 0; }
# One command key, or the sed above may have read another key's text, or none.
[ -n "$c" ] && [ "$(printf '%s\n' "$in" | grep -o '"command"[[:space:]]*:' | wc -l)" -eq 1 ] || say deny 'The hook found no single command in the input.'
# Words only, an escape (\t, \u0009) as a separator, so a tab or a quoted word does not hide git add.
w=" $(printf '%s\n' "$c" | sed -E 's/\\(u[0-9a-fA-F]{4}|.)/ /g; s/[^A-Za-z]+/ /g' | tr A-Z a-z) "
case $w in *" git add "*|*" git commit "*|*" gh issue comment "*|*" gh pr comment "*) ;; *) exit 0 ;; esac

pre=${file%%YYYY-MM-DD*} suf=${file#*YYYY-MM-DD}
digest() {
  if [ "$pre" = "$file" ]; then [ "$1" = "$file" ]; return; fi
  case $1 in "$pre"[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]"$suf") ;; *) return 1 ;; esac
  d=${1#"$pre"}
  echo "${d%"$suf"}" | awk -F- '{ m = $2 + 0; n = m == 2 ? 28 + ($1 % 4 == 0 && $1 % 100 != 0 || $1 % 400 == 0) : 30 + (m + (m > 7)) % 2; exit !(m >= 1 && m <= 12 && $3 >= 1 && $3 <= n) }'
}
# owner/name of the project's github.com origin, as the precheck reads it; not the current folder's, which follows a cd.
own=$(git -C "${CLAUDE_PROJECT_DIR:?}" remote get-url origin 2>/dev/null | tr A-Z a-z | sed -n -E -e 's#/*$##' -e 's#\.git$##' -e 's#^([a-z+]+://)?([^@/]+@)?([a-z0-9-]+\.)?github\.com(:[0-9]+)?[:/]([^/]+/[^/]+)$#\5#p')

add='git add -- ' msg='git commit -m \"docs: daily digest\" -- '
if [ "$mode $commit" = "act true" ]; then
  case $c in
    "$add"*) digest "${c#"$add"}" && say allow 'the digest file alone' ;;
    "$msg"*) digest "${c#"$msg"}" && say allow 'the digest file alone' ;;
  esac
fi
case $mode/$issue in act/0*|act/*[!0-9]*|*/) ;; act/*)
  case $c in "gh issue comment $issue --repo "*)
    r=${c#"gh issue comment $issue --repo "}; p=${r#* --body-file }; r=${r%% --body-file *}
    [ -n "$own" ] && [ "$(printf '%s' "$r" | tr A-Z a-z)" = "$own" ] && digest "$p" && say allow 'the digest file on the digest issue'
  esac ;;
esac
say deny "In this run git add, git commit and gh issue comment run only as the exact commands of step 5 with the digest path."
