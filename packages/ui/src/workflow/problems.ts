import type { Finding } from "@cedarloom/contracts";
import { t } from "../i18n.ts";

type Params = { [F in Finding as F["code"]]: F["params"] };
/** The findings the editor shows: the validator's, and why an imported file or a draft was refused. */
type Shown = Extract<Finding["code"], `workflow.${string}` | `draft.${string}` | `document.${string}`>;

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
};

const text = <C extends Shown>(code: C, params: Params[C]): string => texts[code](params);

const shown = (finding: Finding): finding is Extract<Finding, { code: Shown }> => Object.hasOwn(texts, finding.code);

/** The sentence for a finding in the problems panel; a code it has no sentence for shows as the code. */
export const describe = (finding: Finding): string =>
  shown(finding) ? text(finding.code, finding.params) : finding.code;
