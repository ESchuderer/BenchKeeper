// Releases that have been public for at least 7 days, from a registry document's `time` (version to publish time) and
// `versions` (what is still installable: an unpublished version keeps its time entry). No prereleases, no non-string times.
const WEEK = 7 * 864e5;

export function cooled(time, versions, now = Date.now()) {
  if (!time || typeof time !== 'object' || Array.isArray(time)) return [];
  const live = new Set([].concat(versions ?? []));
  return Object.entries(time).filter(([v, t]) => /^\d+\.\d+\.\d+$/.test(v) && live.has(v) && typeof t === 'string' && Date.parse(t) < now - WEEK).map(([v]) => v);
}

// npm's `before` for a command that installs or runs a package: its dependencies resolve to releases at least 7 days old
// too, and the signature check, the preview and the run (all given this value) resolve the same tree.
// shortcut: an npx folder cached by an earlier run of the same package is reused with the dependencies it was given then.
export const cooldownEnv = (now = Date.now()) => ({ npm_config_before: new Date(now - WEEK).toISOString() });
