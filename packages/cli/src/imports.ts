import { resolve } from "node:path";
import { GitUrl, type ImportReview, shown } from "@cedarloom/contracts";
import * as useCases from "@cedarloom/use-cases";
import { change, refused } from "./commands.ts";
import { type Context, EXIT, emit } from "./output.ts";

const AS = {
  new: "new",
  same: "same",
  update: "update",
  conflict: "conflict: edited here since its last import, kept",
} as const;

/** The review for people: each workflow with its status, every line that runs or writes, the extensions, the licenses. */
const reviewText = ({ source, units, risks, extensions }: ImportReview): string => {
  const from = "folder" in source ? source.folder : `${source.git} ${source.ref} at ${source.commit.slice(0, 12)}`;
  const licenses = [...new Set(units.map(({ license }) => license ?? "none stated"))];
  return [
    `\nImport from ${shown(from)}`,
    "Workflows",
    ...units.map(
      ({ id, status, stored, version }) =>
        `  ${id}  ${stored === null ? "" : `${stored} -> `}${version}  ${AS[status]}`,
    ),
    "What they do",
    ...risks.map(({ workflow, node, kind, text }) => `  ${workflow} ${node}  ${kind}: ${shown(text, 100_000)}`),
    "Extensions they need (this import installs none)",
    ...extensions.map(
      ({ id, version, status, installed, net }) =>
        `  ${id} ${version}  ${status}  ${installed ? "installed" : "not installed"}${net.length > 0 ? `  network: ${net.join(", ")}` : ""}`,
    ),
    `Licenses: ${licenses.join(", ")}`,
  ].join("\n");
};

/**
 * Shows the review of an import from an export folder or a Git URL, and its plan; with --yes stores the new and updated
 * workflows as one run, which runs undo takes back (P6 a: an import is always reviewed).
 */
export const importCommand = async (
  ctx: Context,
  source: string,
  { ref, yes }: { ref?: string; yes?: true },
): Promise<number> => {
  const from = GitUrl.safeParse(source).success ? { git: source, ref: ref ?? "HEAD" } : { folder: resolve(source) };
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
