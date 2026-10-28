#!/bin/sh
# Usage: valid.sh tag <tag> | package <name> | script <path>
# Exit 0 for a value that may go on a command line, 2 otherwise. tag prints the version: the strict semver after a prefix
# of letters, digits and . _ - that starts with a letter or digit and ends in a letter, _ or -. A package or a prefix
# never starts with - so it cannot pass as an option. script: a relative path to an executable file tracked by git.
case "$1" in
  tag) v=$(printf '%s\n' "$2" | sed -nE '1s/^([A-Za-z]|[A-Za-z0-9][A-Za-z0-9._-]*[A-Za-z_-])?([0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?)$/\2/p')
    [ -n "$v" ] && [ "$(printf '%s\n' "$2" | wc -l)" -eq 1 ] && echo "$v" && exit 0 ;;
  package) printf '%s\n' "$2" | grep -qxE '(@[a-z0-9][a-z0-9._-]*/)?[a-z0-9][a-z0-9._-]*' && [ "$(printf '%s\n' "$2" | wc -l)" -eq 1 ] && exit 0 ;;
  script) case "/$2/" in */../*|//*) ;; *) [ -f "$2" ] && [ -x "$2" ] && git ls-files --error-unmatch -- "$2" >/dev/null 2>&1 && exit 0 ;; esac ;;
esac
echo "not a valid $1: $2" >&2
exit 2
