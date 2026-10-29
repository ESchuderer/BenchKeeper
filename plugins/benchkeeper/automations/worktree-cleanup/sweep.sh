#!/bin/sh
# Usage: sweep.sh <report|act> <tmp limit percent>
# In the Git checkout of the working folder, prints the use of the temporary folder ("tmp <used> <limit> <folder>") and
# per linked worktree and local branch whether it is removable: its pull request is merged, the worktree is clean, the
# head commit is the merged pull request's head, no process works in it and no container of it runs. Containers and
# volumes count only with the devcontainer label of a removable worktree. Mode act removes the removable items
# ("removed ..."). Exit 0 when there is work: a removable item or the temporary space above the limit.
mode=$1 limit=$2
case "$mode" in report|act) ;; *) echo "mode must be report or act" >&2; exit 2 ;; esac
case "$limit" in ''|*[!0-9]*) echo "the limit must be a whole number of percent" >&2; exit 2 ;; esac
top=$(git rev-parse --show-toplevel) || exit 2
work=1
tmp=${TMPDIR:-/tmp}
used=$(df -P "$tmp" | awk 'NR == 2 { sub(/%/, "", $5); print $5 }')
case "$used" in
  ''|*[!0-9]*) echo "cannot read the use of $tmp" >&2 ;;
  *) echo "tmp $used $limit $tmp"; [ "$used" -le "$limit" ] || work=0 ;;
esac
engine=$(command -v podman || command -v docker)
label() { printf 'label=devcontainer.local_folder=%s' "$1"; }
containers() { [ -z "$engine" ] || "$engine" ps "$@"; }
volumes() { [ -z "$engine" ] || "$engine" volume ls -q --filter "$(label "$1")"; }

# A process whose working folder lies in $1: another session works there. Without /proc and lsof every folder is busy.
busy() {
  set -- "$(cd "$1" && pwd -P)" || return 0
  if [ -d /proc/self ]; then
    for c in /proc/[0-9]*/cwd; do
      d=$(readlink "$c" 2>/dev/null) || continue
      case "$d/" in "$1"/*) return 0 ;; esac
    done
    return 1
  fi
  command -v lsof >/dev/null || return 0
  lsof -a -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | awk -v p="$1/" 'index($0 "/", p) == 1 { f = 1 } END { exit !f }'
}

# Prints the reason to keep branch $1 at commit $2, or nothing when its merged pull request has this head commit.
unmerged() {
  heads=$(gh pr list --head "$1" --state merged --limit 100 --json headRefOid --jq '.[].headRefOid') || { echo gh; return; }
  [ -n "$heads" ] || { echo unmerged; return; }
  printf '%s\n' "$heads" | grep -qx "$2" || echo unpushed
}

# Removes worktree $1 of branch $2 at commit $3 with its containers and volumes; stops at the first failure.
remove() {
  [ "$(git -C "$1" rev-parse HEAD)" = "$3" ] || return 1
  for c in $(containers -a -q --filter "$(label "$1")"); do "$engine" rm -v "$c" >/dev/null && echo "removed container $c $1" || return 1; done
  for v in $(volumes "$1"); do "$engine" volume rm "$v" >/dev/null && echo "removed volume $v $1" || return 1; done
  git worktree remove "$1" && echo "removed worktree $1 $2" || return 1
  [ "$(git rev-parse "refs/heads/$2")" = "$3" ] && git branch -D "$2" >/dev/null && echo "removed branch $2"
}

tab=$(printf '\t')
# Linked worktrees as head, flag, branch and path; the first entry is the main worktree.
list=$({ git worktree list --porcelain; echo; } | awk '
  /^worktree / { p = substr($0, 10); h = "-"; b = "-"; f = "ok" }
  /^HEAD / { h = $2 }
  /^branch refs\/heads\// { b = substr($0, 19) }
  /^locked/ { f = "locked" }
  /^prunable/ { f = "locked" }
  /^$/ { if (p != "" && n++) print h "\t" f "\t" b "\t" p; p = "" }')
while IFS=$tab read -r head flag branch path; do
  # Never a path that is empty, relative, the root or the checkout itself.
  case "$path" in /?*) ;; *) continue ;; esac
  [ "$path" != "$top" ] || continue
  if [ "$branch" = - ]; then reason=detached
  elif [ "$flag" != ok ]; then reason=$flag
  elif busy "$path"; then reason=busy
  elif [ -n "$(git -C "$path" status --porcelain 2>&1)" ]; then reason=dirty
  elif [ -n "$(containers -q --filter "$(label "$path")")" ]; then reason=container-running
  else reason=$(unmerged "$branch" "$head")
  fi
  if [ -n "$reason" ]; then echo "keep worktree $path $branch $reason"; continue; fi
  work=0
  if [ "$mode" = act ]; then remove "$path" "$branch" "$head" || echo "failed worktree $path $branch"; continue; fi
  echo "removable worktree $path $branch"
  for c in $(containers -a -q --filter "$(label "$path")"); do echo "removable container $c $path"; done
  for v in $(volumes "$path"); do echo "removable volume $v $path"; done
done <<EOT
$list
EOT

# Local branches checked out nowhere whose tip is the head of their merged pull request, except the default branch.
default=$(git symbolic-ref -q --short refs/remotes/origin/HEAD | sed 's|^origin/||')
branches=$(git for-each-ref --format='%(objectname) %(refname:short) %(worktreepath)' refs/heads/ | while read -r head branch wt; do
  [ -z "$wt" ] || continue
  # The opening parenthesis lets bash 3.2 (sh on macOS) parse this case inside $().
  case "$branch" in ("$default"|main|master) continue ;; esac
  [ -n "$(unmerged "$branch" "$head")" ] || echo "$head $branch"
done)
while read -r head branch; do
  [ -n "$branch" ] || continue
  work=0
  if [ "$mode" = report ]; then echo "removable branch $branch"
  elif [ "$(git rev-parse "refs/heads/$branch")" = "$head" ] && git branch -D "$branch" >/dev/null; then echo "removed branch $branch"
  else echo "failed branch $branch"
  fi
done <<EOT
$branches
EOT
exit $work
