import type { HandleType, WorkflowDefinition } from "@cedarloom/contracts";
import { NODE_TYPES, own } from "@cedarloom/engine/graph";
import { t } from "../i18n.ts";
import { canConnect, uniqueNodes } from "./document.ts";

type Edge = WorkflowDefinition["edges"][number];

/** A handle to pick in the keyboard dialog: the edge end it names, and how the list shows it. */
export type Choice<End> = { value: string; label: string; end: End };

const choice = <End>(end: End, label: string): Choice<End> => ({ value: JSON.stringify(end), label, end });

// One option per handle: a second node with the same id would give options the same value, which the list refuses.
const handles = (workflow: WorkflowDefinition, side: "inputs" | "outputs") =>
  uniqueNodes(workflow).flatMap((node) =>
    Object.entries(own(NODE_TYPES, node.type)?.[side] ?? {}).map(([handle, { type }]) => ({
      node: node.id,
      handle,
      type,
    })),
  );

const fields = (record: Readonly<Record<string, { type: HandleType }>> | undefined) =>
  Object.entries(record ?? {}).map(([name, { type }]) => ({ name, type }));

/** Every output a connection can start at: each node's outputs, then the workflow's inputs. */
export const sources = (workflow: WorkflowDefinition): Choice<Edge["from"]>[] => [
  ...handles(workflow, "outputs").map(({ node, handle, type }) =>
    choice({ node, handle }, t("editor.handle", { node, handle, type })),
  ),
  ...fields(workflow.inputs).map(({ name, type }) =>
    choice({ input: name }, t("editor.workflowInput", { name, type })),
  ),
];

/** The inputs an edge from `from` may end at, as canConnect decides: each node's inputs, then the workflow's outputs. */
export const targets = (workflow: WorkflowDefinition, from: Edge["from"]): Choice<Edge["to"]>[] =>
  [
    ...handles(workflow, "inputs").map(({ node, handle, type }) =>
      choice<Edge["to"]>({ node, handle }, t("editor.handle", { node, handle, type })),
    ),
    ...fields(workflow.outputs).map(({ name, type }) =>
      choice<Edge["to"]>({ output: name }, t("editor.workflowOutput", { name, type })),
    ),
  ].filter((to) => canConnect(workflow, from, to.end));
