import type { Finding } from "@cedarloom/contracts";
import { shown as escaped } from "@cedarloom/contracts/escape";
import { t, when } from "../i18n.ts";

type Params = { [F in Finding as F["code"]]: F["params"] };
/** The findings the UI shows: the validator's, why an imported file or a draft was refused, and the profile's lines. */
type Shown = Extract<
  Finding["code"],
  | `workflow.${string}`
  | `draft.${string}`
  | `document.${string}`
  | "run.node-unsupported"
  | "git.failed"
  | "git.refused-source"
  | "git.too-large"
  | "git.unsafe-entry"
  | "extension.digest-mismatch"
  | "import.not-found"
  | "plan.not-approved"
  | "plan.file-changed"
  | "store.busy"
  | "store.moved"
  | "run.failed"
  | "profile.source-waiting"
  | "profile.part-unknown"
  | "profile.part-requires"
  | "profile.binding-missing"
  | "profile.binding-waiting"
  | "profile.when-unmet"
  | "profile.drift"
  | "profile.extra"
  | "profile.owner-changed"
  | "profile.approval-needed"
>;

// A file can break in thousands of places (x and y on 1000 nodes): the first ten show where to start.
const SHOWN = 10;

const issues = (list: { path: string; code: string }[]): string => {
  const named = list
    .slice(0, SHOWN)
    .map((issue) => `${issue.path || "(top)"} ${issue.code}`)
    .join(", ");
  return list.length > SHOWN ? t("problem.moreIssues", { issues: named, count: list.length - SHOWN }) : named;
};

// A node's input, or (node null) one of the workflow's own outputs.
const target = ({ node, handle }: { node: string | null; handle: string }): string =>
  node === null ? t("problem.workflowOutput", { handle }) : t("problem.nodeInput", { node, handle });

const texts: { [C in Shown]: (params: Params[C]) => string } = {
  "document.invalid": (p) => t("problem.documentInvalid", { issues: issues(p.issues) }),
  "document.newer-schema": (p) => t("problem.documentNewer", p),
  "document.unreadable": (p) => t("problem.documentUnreadable", p),
  "draft.not-found": (p) => t("problem.draftNotFound", p),
  "draft.too-large": (p) => t("problem.draftTooLarge", p),
  "workflow.duplicate-id": (p) => t("problem.duplicateId", p),
  "workflow.trigger-count": (p) => t("problem.triggerCount", p),
  "workflow.unknown-node-type": (p) => t("problem.unknownNodeType", p),
  "workflow.invalid-config": (p) => t("problem.invalidConfig", { node: p.node, issues: issues(p.issues) }),
  "workflow.dangling-edge": (p) => t("problem.danglingEdge", p),
  "workflow.duplicate-edge": (p) => t("problem.duplicateEdge", p),
  "workflow.unknown-handle": (p) => t("problem.unknownHandle", p),
  "workflow.incompatible-handles": (p) => t("problem.incompatibleHandles", p),
  "workflow.unchecked-handles": (p) => t("problem.uncheckedHandles", p),
  "workflow.many-sources": (p) => t("problem.manySources", { target: target(p), count: p.count }),
  "workflow.missing-source": (p) => t("problem.missingSource", { target: target(p) }),
  "workflow.cycle": (p) => t("problem.cycle", { nodes: p.nodes.join(", ") }),
  "workflow.join-branches": (p) => t("problem.joinBranches", p),
  "workflow.exclusive-sources": (p) => t("problem.exclusiveSources", p),
  "workflow.optional-input": (p) => t("problem.optionalInput", p),
  "workflow.schedule-input": (p) => t("problem.scheduleInput", p),
  "workflow.report-only-write": (p) => t("problem.reportOnlyWrite", p),
  "workflow.report-only-extension": (p) => t("problem.reportOnlyExtension", p),
  "workflow.extension-missing": (p) => t("problem.extensionMissing", p),
  "workflow.unreachable": (p) => t("problem.unreachable", p),
  "workflow.stray-entry": (p) => t("problem.strayEntry", p),
  "run.node-unsupported": (p) => t("problem.nodeUnsupported", p),
  "git.failed": (p) => t("problem.gitFailed", p),
  "git.refused-source": (p) => t("problem.refusedSource", p),
  // A fetched tree's paths are the source's own: escaped, as the CLI shows them.
  "git.too-large": (p) =>
    t("problem.tooLarge", { ...p, named: p.path === null ? "no" : "yes", path: escaped(p.path ?? "") }),
  "git.unsafe-entry": (p) => t("problem.unsafeEntry", { ...p, path: escaped(p.path) }),
  "extension.digest-mismatch": (p) => t("problem.digestMismatch", p),
  "import.not-found": () => t("problem.importNotFound"),
  "plan.not-approved": () => t("problem.notApproved"),
  "plan.file-changed": (p) => t("problem.fileChanged", { path: escaped(p.path) }),
  "store.busy": () => t("problem.storeBusy"),
  "store.moved": () => t("problem.storeMoved"),
  "run.failed": (p) => t("problem.runFailed", p),
  "profile.source-waiting": (p) =>
    t("problem.sourceWaiting", { source: p.source, commit: p.commit.slice(0, 12), offered: when(p.offered) }),
  "profile.part-unknown": (p) => t("problem.partUnknown", p),
  "profile.part-requires": (p) => t("problem.partRequires", p),
  "profile.binding-missing": (p) => t("problem.bindingMissing", p),
  "profile.binding-waiting": (p) => t("problem.bindingWaiting", p),
  "profile.when-unmet": (p) => t("problem.whenUnmet", p),
  "profile.drift": ({ subject, status, remove }) =>
    remove === null
      ? t("problem.drift", { subject, status: status === "deselected-present" ? "deselected" : status })
      : t("problem.driftRemovable", { subject, remove }),
  "profile.extra": (p) => t("problem.extra", p),
  "profile.owner-changed": (p) => t("problem.ownerChanged", p),
  "profile.approval-needed": (p) => t("problem.approvalNeeded", p),
};

const text = <C extends Shown>(code: C, params: Params[C]): string => texts[code](params);

const shown = (finding: Finding): finding is Extract<Finding, { code: Shown }> => Object.hasOwn(texts, finding.code);

/** The sentence for a finding; a code it has no sentence for shows as the code. */
export const describe = (finding: Finding): string =>
  shown(finding) ? text(finding.code, finding.params) : finding.code;
