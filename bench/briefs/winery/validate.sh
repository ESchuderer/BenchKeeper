#!/bin/sh
# Validates the hidden tests: the reference passes all tests, and each mutant fails exactly its feature or robustness test
# (a feature mutant also fails the robustness test that probes the same rule).
# Usage: bench/briefs/winery/validate.sh <scratch-dir>
set -eu
here=$(dirname "$(realpath "$0")"); tmp=$(realpath -m "$1"); mkdir -p "$tmp"
# A feature passes only when its test ran and passed; skipped counts as failed.
result() { jq -r '[.. | objects | select(has("specs")) | .specs[] | select([.tests[].results[-1].status] | all(. == "passed") | not) | .title | split(" ")[0]] | join(",")' "$1/acceptance.json"; }
run() { # <name> <expected failing features> <sed script or empty>
  rm -rf "$tmp/$1" "$tmp/$1-out"; cp -r "$here/reference" "$tmp/$1"
  [ -z "$3" ] || sed -i "$3" "$tmp/$1/server.mjs"
  [ -z "$3" ] || ! cmp -s "$here/reference/server.mjs" "$tmp/$1/server.mjs" || { echo "$1: mutation not applied"; exit 1; }
  "$here/../../scorer/score.sh" "$here" "$tmp/$1" "$tmp/$1-out" > /dev/null 2>&1 || true
  got=$(result "$tmp/$1-out"); [ "$got" = "$2" ] && echo "$1: ok (failing: ${got:-none})" || { echo "$1: expected '$2', got '$got'"; exit 1; }
}
run reference "" ""
run capacity F3,R1 's/ : guests > left(t) ? `Only ${left(t)} seats left.` : '"''"'/ : '"''"'/'
run staff-open F5,R7,R12 's/const staff = sid && sessions.has(sid);/const staff = true;/'
run cancel-noop F6 's/if (i >= 0) bookings.splice(i, 1);//'
run email-unchecked F4,R6 's#!/^\[^\\s@\]+@\[^\\s@\]+\\.\[^\\s@\]+$/.test(v.email || '"''"')#false#'
run race R1 's/    if (error) return send(form(t, error, v), 422);/&\n    await new Promise((r) => setTimeout(r, 300));/'
run guests-zero R2 's/guests < 1 ||/guests < 0 ||/'
run guests-nine R3 's/guests > 8 ?/guests > 9 ?/'
run guests-fraction R4,R9 's/!Number.isInteger(guests)/!Number.isFinite(guests)/'
run name-empty R5,R10 "s/!v.name?.trim() ? 'Enter your name.'/false ? 'Enter your name.'/"
run email-empty R6 "s/test(v.email || '')/test(v.email || 'a@b.c')/"
# Bookings in an HTML comment of the sign-in page: not on screen (F5 passes), but in the response.
run staff-leak R7 "s#page('Staff', '<h1>Staff sign-in</h1>#page('Staff', \`<!-- \${bookings.map((b) => b.email).join(' ')} -->\` + '<h1>Staff sign-in</h1>#"
run name-markup R8 's/\${esc(b.name)}, \${esc(b.email)}/${b.name}, ${esc(b.email)}/'
# Guests checked only by the browser (number field with limits), not by the server.
run server-guests R9 "s#<input id=\"g\" name=\"guests\" value=#<input id=\"g\" name=\"guests\" type=\"number\" min=\"1\" max=\"8\" step=\"1\" required value=#; s#!Number.isInteger(guests) || guests < 1 || guests > 8 ?#false ?#"
run name-spaces R10 's/!v.name?.trim() ?/!v.name ?/'
run name-ascii R11 "s/name: v.name.trim(), email/name: v.name.trim().replace(\/[^ -~]\/g, '?'), email/"
run cancel-open R12 "s/kind === 'cancel' \&\& req.method === 'POST' \&\& staff)/kind === 'cancel' \&\& req.method === 'POST')/"
# A correct app with other markup: a table, "1 seat left" in the singular, a guests dropdown, cancelled bookings kept as
# "Cancelled", bound to localhost.
run variant "" 's#<ul>${tastings.map((x) => `<li><h2>${x.title}</h2><p>${x.when}, EUR ${x.price} per guest, ${left(x)} seats left</p><a href="/book/${x.id}">Book ${x.title}</a></li>`).join('"''"')}</ul>#<table><tbody>${tastings.map((x) => `<tr><td>${x.title}</td><td>${x.when}</td><td>EUR ${x.price}</td><td>${left(x)} ${left(x) === 1 ? '"'seat'"' : '"'seats'"'} left</td><td><a href="/book/${x.id}">Book ${x.title}</a></td></tr>`).join('"''"')}</tbody></table>#
s#<input id="g" name="guests" value="${esc(v.guests || '"''"')}">#<select id="g" name="guests">${[1, 2, 3, 4, 5, 6, 7, 8].map((n) => `<option>${n}</option>`).join('"''"')}</select>#
s#bookings.filter((b) => b.tasting === t.id).reduce#bookings.filter((b) => b.tasting === t.id \&\& !b.cancelled).reduce#
s#if (i >= 0) bookings.splice(i, 1);#if (i >= 0) bookings[i].cancelled = true;#
s#${b.guests} guests, ${b.ref} <form#${b.guests} guests, ${b.ref}${b.cancelled ? '"' Cancelled'"' : '"''"'} <form#
s#.listen(Number(process.env.PORT) || 3000);#.listen(Number(process.env.PORT) || 3000, '"'localhost'"');#'
