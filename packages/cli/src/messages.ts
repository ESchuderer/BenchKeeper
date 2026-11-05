import type { Finding, FindingCode } from "@cedarloom/contracts";

type Params = { [F in Finding as F["code"]]: F["params"] };

const short = (hash: string | null): string => (hash === null ? "no file" : hash.slice(0, 12));
// An undo run that stopped is not undone itself: planning the undo of its target again starts from the files as they are.
const undoHint = (p: { runId: string; undoes: string | null }): string =>
  p.undoes === null
    ? `Undo it with: cedarloom runs undo ${p.runId} --yes`
    : `Plan the undo of run ${p.undoes} again with: cedarloom runs undo ${p.undoes} --yes`;

const issueList = (issues: { path: string; code: string }[]): string =>
  issues.map((i) => `${i.path || "(top)"} ${i.code}`).join(", ");
// A node's input, or (node null) one of the workflow's own outputs.
const handleName = (p: { node: string | null; handle: string }): string =>
  p.node === null ? `The workflow output ${p.handle}` : `Input ${p.handle} of node ${p.node}`;

// shortcut: English text in code until the Lingui catalog package exists; the codes and parameters are the contract.
const messages: { [C in FindingCode]: (params: Params[C]) => string } = {
  "document.unreadable": (p) => `${p.path} cannot be read (${p.error}).`,
  "document.newer-schema": (p) => `The document has schema version ${p.found}; this CedarLoom reads up to ${p.known}.`,
  "document.invalid": (p) => `The document does not match its schema: ${issueList(p.issues)}.`,
  "plan.not-approved": (p) => `The approval names plan ${short(p.approvedHash)}, not ${short(p.planHash)}.`,
  "plan.path-not-absolute": (p) =>
    `${p.path} is not an absolute, normalized path; plans name every file by its full path.`,
  "plan.not-a-file": (p) => `${p.path} is not a regular file (${p.error}); plans change files only.`,
  "plan.chain-broken": (p) =>
    `Operation ${p.index + 1} on ${p.path} expects ${short(p.found)}, but the operations before it leave ${short(p.expected)}; the plan is inconsistent and nothing was written.`,
  "plan.file-changed": (p) =>
    `${p.path} changed since the plan was made (${short(p.expected)} expected, ${short(p.actual)} found); make the plan again.`,
  "apply.symlink": (p) =>
    `${p.path} is a symbolic link; CedarLoom changes regular files only, so the link stays as it is.`,
  "apply.not-text": (p) => `${p.path} is not UTF-8 text; CedarLoom changes text files only, so it stays as it is.`,
  "apply.backup-failed": (p) => `The backup of ${p.path} failed (${p.error}); nothing was written to it.`,
  "apply.write-failed": (p) => `Changing ${p.path} failed (${p.error}).`,
  "apply.write-mismatch": (p) =>
    `${p.path} does not hold what was written (${short(p.expected)} expected, ${short(p.actual)} found); another program may write it.`,
  "run.not-found": (p) => `No run ${p.runId} in this state folder.`,
  "run.interrupted": (p) => `Run ${p.runId} was interrupted. ${undoHint(p)}`,
  "run.failed": (p) => `Run ${p.runId} stopped before its end; earlier changes of it stay. ${undoHint(p)}`,
  "undo.file-edited": (p) => `${p.path} was edited after run ${p.runId} wrote it; it is left as it is.`,
  "undo.backup-missing": (p) => `The backup of ${p.path} from run ${p.runId} is gone; nothing was undone.`,
  "undo.backup-changed": (p) => `The backup of ${p.path} from run ${p.runId} was changed; nothing was undone.`,
  "store.busy": (p) => `Another CedarLoom process is applying changes in ${p.dir}; try again when it ends.`,
  "store.network-filesystem": (p) =>
    `The state folder ${p.dir} is on a network filesystem (${p.fsType}); use a local folder.`,
  "store.newer-schema": (p) => `The run store has schema version ${p.found}; this CedarLoom reads up to ${p.known}.`,
  "workflow.duplicate-id": (p) => `More than one ${p.kind} has the id ${p.id}; ids are unique within a workflow.`,
  "workflow.trigger-count": (p) => `The workflow has ${p.count} trigger nodes; it needs exactly one.`,
  "workflow.unknown-node-type": (p) => `Node ${p.node} has the type ${p.type}, which this CedarLoom does not know.`,
  "workflow.invalid-config": (p) =>
    `The configuration of node ${p.node} does not match its type: ${issueList(p.issues)}.`,
  "workflow.dangling-edge": (p) =>
    `Edge ${p.edge} starts or ends at ${p.ref} (its ${p.end} end), which does not exist.`,
  "workflow.unknown-handle": (p) =>
    `Edge ${p.edge} uses the handle ${p.handle} at its ${p.end} end, which that node type lacks.`,
  "workflow.incompatible-handles": (p) =>
    `Edge ${p.edge} joins a ${p.from} output to a ${p.to} input, which cannot take it.`,
  "workflow.unchecked-handles": (p) =>
    `Edge ${p.edge} passes ${p.from} to a ${p.to} input; the value is checked only when the workflow runs.`,
  "workflow.many-sources": (p) => `${handleName(p)} gets ${p.count} edges; a data input takes one.`,
  "workflow.missing-source": (p) => `${handleName(p)} gets no edge, but it needs one.`,
  "workflow.cycle": (p) => `The nodes ${p.nodes.join(", ")} form a cycle; repeats need an explicit loop node.`,
  "workflow.join-branches": (p) => `Join ${p.node} has ${p.count} incoming branch edges; a join needs at least two.`,
  "workflow.duplicate-edge": (p) =>
    `Edge ${p.edge} joins the same output to the same input as edge ${p.of}; remove one.`,
  "workflow.exclusive-sources": (p) =>
    `Input ${p.handle} of node ${p.node} waits for outputs of ${p.from} of which only one fires, so ${p.node} is always skipped; merge them in a join with policy any.`,
  "workflow.optional-input": (p) =>
    `Input ${p.handle} of node ${p.node} needs a value, but the workflow input ${p.input} it comes from is optional and has no default.`,
  "workflow.schedule-input": (p) =>
    `A schedule starts this workflow without inputs, so the required input ${p.input} needs a default.`,
  "workflow.unreachable": (p) => `Nothing leads to node ${p.node} from the trigger or an input, so it never runs.`,
  "workflow.stray-entry": (p) => `The ${p.section} section names node ${p.node}, which the workflow does not have.`,
  "accounts.registry-exists": (p) =>
    `${p.path} exists: BenchKeeper's registry is imported once, into a new registry; nothing was changed.`,
  "accounts.unknown-pool": (p) => `The registry has no ${p.agent} pool named ${p.pool}.`,
  "accounts.codex-switching-off": (p) =>
    `Pool ${p.pool} cannot be confirmed: switching between Codex accounts stays off until OpenAI's terms are reviewed.`,
};

const text = <C extends FindingCode>(code: C, params: Params[C]): string => messages[code](params);

/** The English sentence for a finding. */
export const describe = (finding: Finding): string => text(finding.code, finding.params);
