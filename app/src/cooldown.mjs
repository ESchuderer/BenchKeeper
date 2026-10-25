// Releases that have been public for at least 7 days, from a registry document's `time` (version to publish time) and
// `versions` (what is still installable: an unpublished version keeps its time entry). No prereleases, no non-string times.
const WEEK = 7 * 864e5;

export function cooled(time, versions, now = Date.now()) {
  if (!time || typeof time !== 'object' || Array.isArray(time)) return [];
  const live = new Set([].concat(versions ?? []));
  return Object.entries(time).filter(([v, t]) => /^\d+\.\d+\.\d+$/.test(v) && live.has(v) && typeof t === 'string' && Date.parse(t) < now - WEEK).map(([v]) => v);
}
