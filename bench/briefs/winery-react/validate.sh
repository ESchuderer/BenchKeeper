#!/bin/sh
# Validates the hidden tests against the React reference: it passes all features, and each mutant fails exactly its feature.
# Usage: bench/briefs/winery-react/validate.sh <scratch-dir>
set -eu
here=$(dirname "$(realpath "$0")"); tmp=$(realpath -m "$1"); mkdir -p "$tmp"
result() { jq -r '[.. | objects | select(has("specs")) | .specs[] | select([.tests[].results[-1].status] | all(. == "passed") | not) | .title | split(" ")[0]] | join(",")' "$1/acceptance.json"; }
run() { # <name> <expected failing features> <sed script or empty> [file, default server.mjs]
  rm -rf "$tmp/$1" "$tmp/$1-out"; cp -r "$here/reference" "$tmp/$1"
  f=${4:-server.mjs}
  [ -z "$3" ] || sed -i "$3" "$tmp/$1/$f"
  [ -z "$3" ] || ! cmp -s "$here/reference/$f" "$tmp/$1/$f" || { echo "$1: mutation not applied"; exit 1; }
  "$here/../../scorer/score.sh" "$here" "$tmp/$1" "$tmp/$1-out" > /dev/null 2>&1 || true
  got=$(result "$tmp/$1-out"); [ "$got" = "$2" ] && echo "$1: ok (failing: ${got:-none})" || { echo "$1: expected '$2', got '$got'"; exit 1; }
}
run reference "" ""
run capacity F3 's/  else if (t \&\& guests > left(t)) errors.guests = `Only ${left(t)} seats left.`;//'
run staff-open F5 's/const staff = (req) => sessions.has(.*$/const staff = () => true;/'
run cancel-noop F6 's/  if (i >= 0) bookings.splice(i, 1);//'
run email-unchecked F4 "s#  if (!/^\[^\\\\s@\]+@\[^\\\\s@\]+\\\\.\[^\\\\s@\]+\$/.test(email)) errors.email = 'Enter a valid email address.';##"
# A correct app with other behavior: a guests dropdown, and a staff page that shows "Loading" while it checks the session.
run variant "" 's#{field(.guests., .Guests.)}#<p><label htmlFor="guests">Guests</label> <select id="guests" name="guests">{[1, 2, 3, 4, 5, 6, 7, 8].map((n) => <option key={n}>{n}</option>)}</select>{errors.guests \&\& <span role="alert"> {errors.guests}</span>}</p>#
s#  const \[error, setError\] = useState(.*);#&\n  const [ready, setReady] = useState(false);#
s#  const load = () => api(./api/staff/bookings.).then((r) => (r.ok ? r.json().then(setList) : setList(null)));#  const load = () => api("/api/staff/bookings").then((r) => (r.ok ? r.json().then(setList) : setList(null))).finally(() => setReady(true));#
s#  if (!list) {#  if (!ready) return <main><p>Loading</p></main>;\n  if (!list) {#
s#  useEffect(() => { load(); }, \[\]);#  useEffect(() => { setTimeout(load, 800); }, []);#' src/main.jsx
