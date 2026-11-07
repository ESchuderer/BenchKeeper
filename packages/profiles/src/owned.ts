import type { Finding, Operation, Result } from "@cedarloom/contracts";
import { errorCode, hashFile } from "@cedarloom/engine";
import { sha256 } from "@cedarloom/ledger";

/** The operations of one level, and the files it leaves alone. */
export interface LevelPlan {
  readonly operations: Operation[];
  readonly findings: Finding[];
}

/** A file a part wants: its text, and the mode a new one gets. */
export type Wanted = { content: string; mode?: number };

const ownerChanged = (path: string): Finding => ({ code: "profile.owner-changed", params: { path } });

// A file's hash, null when it is absent; one that cannot be read, a folder among them, stops the plan by name.
const hashOf = (path: string): Result<string | null> => {
  try {
    return { ok: true, value: hashFile(path) };
  } catch (error) {
    return { ok: false, finding: { code: "document.unreadable", params: { path, error: errorCode(error) } } };
  }
};

// Each wanted file written while it is absent or as CedarLoom last left it.
const writes = (plan: LevelPlan, wanted: ReadonlyMap<string, Wanted>, written: ReadonlyMap<string, string | null>) => {
  for (const [path, { content, mode }] of wanted) {
    const now = hashOf(path);
    if (!now.ok) return now;
    if (now.value === sha256(content)) continue;
    if (now.value !== null && now.value !== written.get(path)) plan.findings.push(ownerChanged(path));
    else
      plan.operations.push({
        kind: "write",
        path,
        before: now.value,
        content,
        ...(mode === undefined ? {} : { mode }),
      });
  }
  return { ok: true as const, value: plan };
};

// Each stale file removed while it is still as CedarLoom last left it.
const removals = (plan: LevelPlan, stale: Iterable<string>, written: ReadonlyMap<string, string | null>) => {
  for (const path of stale) {
    const last = written.get(path);
    const now = last === undefined || last === null ? null : hashOf(path);
    if (now?.ok === false) return now;
    if (now === null || now.value === null) continue;
    if (now.value !== last) plan.findings.push(ownerChanged(path));
    else plan.operations.push({ kind: "delete", path, before: now.value });
  }
  return { ok: true as const, value: plan };
};

/**
 * Writes each wanted file while it is absent or as CedarLoom last left it, and removes each stale one while it still
 * is; a file the owner changed or made stays and is reported. `written` holds what CedarLoom last left at each path
 * (the run store's `written`), which tells its own files from the owner's.
 */
export const ownedFiles = (
  wanted: ReadonlyMap<string, Wanted>,
  stale: Iterable<string>,
  written: ReadonlyMap<string, string | null>,
): Result<LevelPlan> => {
  const plan = writes({ operations: [], findings: [] }, wanted, written);
  return plan.ok ? removals(plan.value, stale, written) : plan;
};
