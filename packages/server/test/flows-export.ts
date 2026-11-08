import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { formatExport } from "@cedarloom/contracts";
import { sha256 } from "@cedarloom/ledger";
import type { Fetch } from "@cedarloom/use-cases";

const corpus = join(import.meta.dirname, "..", "..", "contracts", "corpus", "WorkflowDefinition", "1");

/** The Git URL of an export of the corpus's minimal workflow. */
export const FLOWS = "https://git.example.org/acme/flows.git";

/**
 * A fetch that hands over that export's files at a commit (nothing of it runs), and refuses any other URL as the real
 * fetch refuses one.
 */
export const flowsExport = async (): Promise<Fetch> => {
  const texts: [string, string][] = [
    [
      "cedarloom-export.json",
      formatExport({ schemaVersion: 1, kind: "cedarloom.export", name: "Shared", workflows: ["minimal"] }),
    ],
    ["workflows/workflow-minimal.json", await readFile(join(corpus, "valid-minimal.json"), "utf8")],
  ];
  const files = texts.map(([path, text]) => ({
    path,
    mode: "100644" as const,
    sha256: sha256(text),
    content: Buffer.from(text),
  }));
  const tree = { commit: "c".repeat(40), files, digest: "d".repeat(64) };
  return async (source) =>
    source.url === FLOWS
      ? { ok: true, value: tree }
      : { ok: false, finding: { code: "git.refused-source", params: { field: "url" } } };
};
