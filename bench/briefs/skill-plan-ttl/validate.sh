#!/bin/sh
# Validates the checks: the baseline fails the task's checks, the reference passes every check and its suite, and each
# mutant of the reference fails exactly its check. Usage: bench/briefs/skill-plan-ttl/validate.sh <scratch-dir>
set -eu
here=$(dirname "$(realpath "$0")"); tmp=$(realpath -m "$1"); mkdir -p "$tmp"
. "$here/../skill-common/validate-lib.sh"
build_reference
case_ baseline S1-ttl,S1-reads,S1-persist
case_ reference ""
case_ get-ignores-expiry S1-ttl "R src/store.js 'get: (key) => (live(entries.get(key)) ? entries.get(key).value : undefined),' 'get: (key) => entries.get(key)?.value,'"
case_ keys-ignore-expiry S1-reads "R src/store.js 'keys: () => [...entries].filter(([, e]) => live(e)).map(([k]) => k),' 'keys: () => [...entries.keys()],'"
case_ expiry-not-saved S1-persist "R src/store.js 'entries: Object.fromEntries(entries)' 'entries: Object.fromEntries([...entries].map(([k, { expiresAt, ...e }]) => [k, e]))'"
case_ format-v2 S1-format "R src/store.js 'version: 1, entries: Object' 'version: 2, entries: Object' 'data.version !== 1' '![1, 2].includes(data.version)'"
case_ old-files-expired S1-old-data "R src/store.js 'e.expiresAt !== undefined && now() >= e.expiresAt' 'e.expiresAt !== null && !(now() < e.expiresAt)' 'ttl === undefined ? undefined :' 'ttl === undefined ? null :'"
case_ dependency S1-no-deps "R package.json '\"type\": \"module\",' '\"type\": \"module\", \"dependencies\": { \"ms\": \"2.1.3\" },'"
case_ delete-result S1-regressions "R src/store.js 'delete: (key) => entries.delete(key),' 'delete: (key) => { entries.delete(key); },'"
