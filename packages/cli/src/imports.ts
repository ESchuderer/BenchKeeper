import { type ImportReview, shown } from "@cedarloom/contracts";
import * as useCases from "@cedarloom/use-cases";
import { change, refused } from "./commands.ts";
import { type Context, EXIT, emit } from "./output.ts";

const AS = {
  new: "new",
  same: "same",
  update: "update",
  conflict: "conflict: edited here since its last import, kept",
} as const;

const unitLine = ({ id, status, stored, version, changes }: ImportReview["units"][number]): string => {
  const { added, removed, changed } = changes;
  const nodes = `nodes: ${added.length} added, ${removed.length} removed, ${changed.length} changed`;
  return `  ${id}  ${stored === null ? "" : `${stored} -> `}${version}  ${AS[status]}  ${nodes}`;
};

/** The review for people: each workflow with its status, every line that runs or writes, the licenses. */
const reviewText = ({ source, units, risks }: ImportReview): string => {
  const from = "folder" in source ? source.folder : `${source.git} ${source.ref} at commit ${source.commit}`;
  const licenses = [...new Set(units.map(({ license }) => license ?? "none stated"))];
  return [
    `\nImport from ${shown(from)}`,
    "Workflows",
    ...units.map(unitLine),
    "What they do",
    // Line by line: a line break shown as a space would show a comment where sh runs the next line.
    ...risks.map(({ workflow, node, kind, text }) => {
      const [first, ...more] = text.split("\n").map((line) => shown(line, Number.POSITIVE_INFINITY));
      return [`  ${workflow} ${node}  ${kind}: ${first}`, ...more.map((line) => `      ${line}`)].join("\n");
    }),
    `Licenses: ${licenses.join(", ")}`,
  ].join("\n");
};

// Shows an import's review and plan; with --yes stores the workflows as one run, which runs undo takes back (P6 a).
export const importCommand = async (ctx: Context, from: useCases.From, yes?: true): Promise<number> => {
  const planned = await useCases.planImport(ctx.state, from, ctx.io.fetch);
  if (!planned.ok) return refused(ctx, "plan", planned.finding);
  const { review, plan } = planned.value;
  if (plan !== null) return change(ctx, plan, { note: reviewText(review), data: { review }, findings: [] }, yes);
  emit(
    ctx,
    "import",
    { review },
    `${reviewText(review)}\nNothing to import: every workflow is stored as it is, or kept.`,
  );
  return EXIT.ok;
};
