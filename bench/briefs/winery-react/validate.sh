#!/bin/sh
# Validates the hidden tests against the React reference: it passes all tests, and each mutant fails exactly its feature
# or robustness test (a feature mutant also fails the robustness test that probes the same rule).
# Usage: bench/briefs/winery-react/validate.sh <scratch-dir>
set -eu
here=$(dirname "$(realpath "$0")"); tmp=$(realpath -m "$1"); mkdir -p "$tmp"
result() { jq -r '[.. | objects | select(has("specs")) | .specs[] | select([.tests[].results[-1].status] | all(. == "passed") | not) | .title | split(" ")[0]] | join(",")' "$1/acceptance.json"; }
run() { # <name> <expected failing tests> <sed script or empty> [files, default server.mjs; each must change]
  rm -rf "$tmp/$1" "$tmp/$1-out"; cp -r "$here/reference" "$tmp/$1"
  for f in ${4:-server.mjs}; do
    [ -z "$3" ] || sed -i "$3" "$tmp/$1/$f"
    [ -z "$3" ] || ! cmp -s "$here/reference/$f" "$tmp/$1/$f" || { echo "$1: mutation not applied to $f"; exit 1; }
  done
  "$here/../../scorer/score.sh" "$here" "$tmp/$1" "$tmp/$1-out" > /dev/null 2>&1 || true
  got=$(result "$tmp/$1-out"); [ "$got" = "$2" ] && echo "$1: ok (failing: ${got:-none})" || { echo "$1: expected '$2', got '$got'"; exit 1; }
}
run reference "" ""
run capacity F3,R1 's/  else if (t \&\& guests > left(t)) errors.guests = `Only ${left(t)} seats left.`;//'
run staff-open F5,R7 's/const staff = (req) => sessions.has(.*$/const staff = () => true;/'
run cancel-noop F6 's/  if (i >= 0) bookings.splice(i, 1);//'
run email-unchecked F4,R6 "s#  if (!/^\[^\\\\s@\]+@\[^\\\\s@\]+\\\\.\[^\\\\s@\]+\$/.test(email)) errors.email = 'Enter a valid email address.';##"
run race R1 "s#app.post('/api/bookings', (req, res)#app.post('/api/bookings', async (req, res)#; s#^  bookings.push(b);#  await new Promise((r) => setTimeout(r, 300));\n&#"
run guests-zero R2 's/guests < 1 ||/guests < 0 ||/'
run guests-nine R3 's/guests > 8)/guests > 9)/'
run guests-fraction R4 's/!Number.isInteger(guests)/!Number.isFinite(guests)/'
run name-empty R5 's/  if (!name.trim()) errors.name.*$//'
run email-empty R6 's/.test(email)) errors.email/.test(email) \&\& email) errors.email/'
# The bookings API without a session check, and a staff page that asks for the password before it loads them (F5 passes).
run staff-leak R7 "s#(req, res) => (staff(req) ? res.json(bookings)#(req, res) => (true ? res.json(bookings)#; s#  useEffect(() => { load(); }, \[\]);##" "server.mjs src/main.jsx"
run name-markup R8 's#<li key={b.ref}>{b.name},#<li key={b.ref}><span dangerouslySetInnerHTML={{ __html: b.name }} />,#' src/main.jsx
# A correct app with other behavior: a guests dropdown, and a staff page that shows "Loading" while it checks the session.
run variant "" 's#{field(.guests., .Guests.)}#<p><label htmlFor="guests">Guests</label> <select id="guests" name="guests">{[1, 2, 3, 4, 5, 6, 7, 8].map((n) => <option key={n}>{n}</option>)}</select>{errors.guests \&\& <span role="alert"> {errors.guests}</span>}</p>#
s#  const \[error, setError\] = useState(.*);#&\n  const [ready, setReady] = useState(false);#
s#  const load = () => api(./api/staff/bookings.).then((r) => (r.ok ? r.json().then(setList) : setList(null)));#  const load = () => api("/api/staff/bookings").then((r) => (r.ok ? r.json().then(setList) : setList(null))).finally(() => setReady(true));#
s#  if (!list) {#  if (!ready) return <main><p>Loading</p></main>;\n  if (!list) {#
s#  useEffect(() => { load(); }, \[\]);#  useEffect(() => { setTimeout(load, 800); }, []);#' src/main.jsx
