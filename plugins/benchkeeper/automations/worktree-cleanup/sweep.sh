#!/bin/sh
# Usage: sweep.sh <report|act> <tmp limit percent> [rebuildable folders, comma-separated]
# In the Git checkout of the working folder, prints the use of the temporary folder ("tmp <used> <limit> <folder>") and
# per linked worktree and local branch whether it is removable: its pull request is merged, the worktree is clean and
# holds no ignored file that cannot be rebuilt, the head commit is the merged pull request's head, no process works in
# it and no container of it runs. Containers and volumes count only with the devcontainer label of a removable worktree.
# Mode act removes the removable items ("removed ..."). Exit 0 when there is work: a removable item or the temporary
# space above the limit.
mode=$1 limit=$2 rebuildable=${3-node_modules,dist,build,.cache}
case "$mode" in report|act) ;; *) echo "mode must be report or act" >&2; exit 2 ;; esac
case "$limit" in ''|*[!0-9]*) echo "the limit must be a whole number of percent" >&2; exit 2 ;; esac
top=$(git rev-parse --show-toplevel) || exit 2
work=1 moved=
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

# Whether path $2 of worktree $1 is a copy: it, or a folder it lies in, is a .worktreeinclude entry of the checkout, and it
# still equals the checkout's copy.
copy() {
  e=$2
  until grep -qxF -- "$e" "$top/.worktreeinclude" 2>/dev/null; do
    case $e in */*) e=${e%/*} ;; *) return 1 ;; esac
  done
  diff -rq -- "$top/$2" "$1/$2" >/dev/null 2>&1
}

# Prints the ignored paths of worktree $1 that cannot be rebuilt: outside every folder named in $rebuildable and not a
# copy. A folder Git ignores as a whole counts as a copy when every file in it is one: project setup lists the state file
# .benchkeeper/state.json, not the folder, whose other files are per worktree. git worktree remove deletes them.
# Fails when Git cannot list them. Only a folder counts as rebuildable: Git marks one with a trailing slash, so the last
# path component of a file is never checked.
ignored() {
  s=$(git -C "$1" status --porcelain --ignored=matching --untracked-files=normal) || return 1
  printf '%s\n' "$s" | sed -n 's|^!! ||p' |
    awk -F/ -v r="$rebuildable" 'BEGIN { n = split(r, a, ","); for (i = 1; i <= n; i++) keep[a[i]] = 1 }
      { for (i = 1; i < NF; i++) if ($i in keep) next; sub(/\/+$/, ""); print }' |
    while IFS= read -r p; do
      copy "$1" "$p" && continue
      if [ -d "$1/$p" ] && [ ! -L "$1/$p" ]; then
        (cd "$1" && find "./$p" ! -type d) | while IFS= read -r f; do copy "$1" "${f#./}" || { echo x; break; }; done | grep -q x || continue
      fi
      printf '%s\n' "$p"
    done
}

# Prints the reason to keep branch $1 at commit $2, or nothing when its merged pull request has this head commit.
unmerged() {
  heads=$(gh pr list --head "$1" --state merged --limit 100 --json headRefOid --jq '.[].headRefOid') || { echo gh; return; }
  [ -n "$heads" ] || { echo unmerged; return; }
  printf '%s\n' "$heads" | grep -qx "$2" || echo unpushed
}

# Removes worktree $1 of branch $2 at commit $3 with its containers and volumes; stops at the first failure. Keeps the
# branch when its tip moved away from $3 meanwhile, and lists it in $moved so the branch sweep below keeps it too.
remove() {
  [ "$(git -C "$1" rev-parse HEAD)" = "$3" ] || return 1
  for c in $(containers -a -q --filter "$(label "$1")"); do "$engine" rm -v "$c" >/dev/null && echo "removed container $c $1" || return 1; done
  for v in $(volumes "$1"); do "$engine" volume rm "$v" >/dev/null && echo "removed volume $v $1" || return 1; done
  git worktree remove "$1" && echo "removed worktree $1 $2" || return 1
  if [ "$(git rev-parse "refs/heads/$2")" = "$3" ]; then git branch -D "$2" >/dev/null && echo "removed branch $2"
  else echo "kept branch $2 moved"; moved="$moved $2"
  fi
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
  elif [ -n "$(git -C "$path" status --porcelain --untracked-files=normal 2>&1)" ]; then reason=dirty
  elif ! files=$(ignored "$path"); then reason=ignored-scan
  elif [ -n "$files" ]; then reason=ignored-files
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
  case "$moved " in (*" $branch "*) continue ;; esac
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
