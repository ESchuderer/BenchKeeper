import "./jitless.ts";
import "@xyflow/react/dist/style.css";
import "./editor.css";
import {
  findingInfo,
  formatWorkflow,
  readDocument,
  WORKFLOW_SCHEMA_VERSION,
  WorkflowDefinition,
} from "@cedarloom/contracts";
import { NODE_TYPES } from "@cedarloom/engine/graph";
import { validateWorkflow } from "@cedarloom/engine/validate";
import { Alert, Button, FileButton, Group, List, Select, Stack, Text, Title } from "@mantine/core";
import { useHotkeys } from "@mantine/hooks";
import {
  Background,
  type Connection,
  Controls,
  type Edge,
  type EdgeChange,
  MiniMap,
  type Node,
  type NodeChange,
  ReactFlow,
} from "@xyflow/react";
import { type ReactNode, useMemo, useState } from "react";
import { t } from "../i18n.ts";
import {
  apply,
  canConnect,
  type Change,
  type History,
  newWorkflow,
  open,
  type Position,
  redo,
  undo,
} from "./document.ts";
import { NodeCard } from "./NodeCard.tsx";
import { describe } from "./problems.ts";
import { type CardData, endsOf, project } from "./projection.ts";

const nodeTypes = { card: NodeCard };
const TYPES = Object.keys(NODE_TYPES);

type Edit = { history: History; change: (change: Change) => void; undo: () => void; redo: () => void };

/** The document and its history; Mod+Z undoes, Mod+Shift+Z and Mod+Y redo (not inside text fields). */
const useDocument = (): Edit => {
  const [history, setHistory] = useState<History>(() => open(newWorkflow()));
  const back = (): void => setHistory(undo);
  const forward = (): void => setHistory(redo);
  useHotkeys([
    ["mod+Z", back],
    ["mod+shift+Z", forward],
    ["mod+Y", forward],
  ]);
  return { history, change: (change) => setHistory((current) => apply(current, change)), undo: back, redo: forward };
};

// A new node goes to the next free spot of a grid, five to a row.
const nextSpot = (count: number): Position => ({ x: 240 * (count % 5), y: 200 * Math.floor(count / 5) });

const parse = (text: string): { ok: true; value: unknown } | { ok: false } => {
  try {
    const value: unknown = JSON.parse(text);
    return { ok: true, value };
  } catch {
    return { ok: false };
  }
};

/** Why a file cannot be imported, or the workflow it holds. */
const importOf = (text: string): { workflow: WorkflowDefinition } | { problem: string } => {
  const json = parse(text);
  if (!json.ok) return { problem: t("editor.notJson") };
  const read = readDocument(WorkflowDefinition, WORKFLOW_SCHEMA_VERSION, json.value);
  return read.ok ? { workflow: read.value } : { problem: t("editor.refused", { reason: describe(read.finding) }) };
};

/** Saves the workflow in its canonical file form. */
const download = (workflow: WorkflowDefinition): void => {
  const url = URL.createObjectURL(new Blob([formatWorkflow(workflow)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${workflow.metadata.id}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
};

const Toolbar = ({ edit, onProblem }: { edit: Edit; onProblem: (text: string) => void }): ReactNode => {
  const [type, setType] = useState<string | null>("command.run");
  const { past, present, future } = edit.history;
  const take = async (file: File | null): Promise<void> => {
    if (file === null) return;
    const found = importOf(await file.text());
    onProblem("problem" in found ? found.problem : "");
    if ("workflow" in found) edit.change({ kind: "replace", workflow: found.workflow });
  };
  const add = (): void => {
    if (type !== null) edit.change({ kind: "add-node", type, position: nextSpot(present.nodes.length) });
  };
  return (
    <Group align="end">
      <Select label={t("editor.nodeType")} data={TYPES} value={type} onChange={setType} allowDeselect={false} />
      <Button onClick={add}>{t("editor.addNode")}</Button>
      <Button variant="default" onClick={edit.undo} disabled={past.length === 0}>
        {t("editor.undo")}
      </Button>
      <Button variant="default" onClick={edit.redo} disabled={future.length === 0}>
        {t("editor.redo")}
      </Button>
      <Button variant="default" onClick={() => edit.change({ kind: "replace", workflow: newWorkflow() })}>
        {t("editor.new")}
      </Button>
      <FileButton onChange={(file) => void take(file)} accept="application/json,.json">
        {(props) => (
          <Button variant="default" {...props}>
            {t("editor.import")}
          </Button>
        )}
      </FileButton>
      <Button variant="default" onClick={() => download(present)}>
        {t("editor.export")}
      </Button>
    </Group>
  );
};

type Drag = Record<string, Position>;
type Sizes = Record<string, { width: number; height: number }>;

// React Flow shows a node once it is measured: the sizes it reports are kept with the canvas, not in the workflow.
const measured = (changes: NodeChange<Node<CardData>>[], sizes: Sizes): Sizes => {
  const next = { ...sizes };
  for (const change of changes) {
    if (change.type === "dimensions" && change.dimensions !== undefined) next[change.id] = change.dimensions;
  }
  return next;
};

/** Moves during a drag stay on the canvas; the drop is one move of the document, so one undo step. */
const dragged = (changes: NodeChange<Node<CardData>>[], drag: Drag): { drag: Drag; drop: Drag } => {
  const next = { ...drag };
  const drop: Drag = {};
  for (const change of changes) {
    if (change.type !== "position") continue;
    const at = change.position ?? next[change.id];
    if (at !== undefined) (change.dragging === true ? next : drop)[change.id] = at;
    if (change.dragging !== true) delete next[change.id];
  }
  return { drag: next, drop };
};

const picked = (changes: (NodeChange | EdgeChange)[], selected: Set<string>): Set<string> => {
  const next = new Set(selected);
  for (const change of changes) {
    if (change.type === "select" && change.selected) next.add(change.id);
    if (change.type === "select" && !change.selected) next.delete(change.id);
  }
  return next;
};

const ends = (connection: Connection | Edge) =>
  endsOf({
    source: connection.source,
    sourceHandle: connection.sourceHandle ?? null,
    target: connection.target,
    targetHandle: connection.targetHandle ?? null,
  });

// The workflow's own inputs and outputs sit at the canvas edges: they cannot be moved or deleted.
const boundary = (id: string): boolean => id.startsWith("@");

/** The projected canvas with a drag in progress and the selection applied. */
const onCanvas = (
  projected: ReturnType<typeof project>,
  local: { drag: Drag; sizes: Sizes },
  nodesPicked: Set<string>,
  edgesPicked: Set<string>,
): { nodes: Node<CardData>[]; edges: Edge[] } => ({
  nodes: projected.nodes.map((node) => ({
    ...node,
    position: local.drag[node.id] ?? node.position,
    ...(local.sizes[node.id] === undefined ? {} : { measured: local.sizes[node.id] }),
    selected: nodesPicked.has(node.id),
    draggable: !boundary(node.id),
    deletable: !boundary(node.id),
  })),
  edges: projected.edges.map((edge) => ({ ...edge, selected: edgesPicked.has(edge.id) })),
});

/** The graph, projected from the workflow: React Flow keeps nothing of its own but a drag in progress and the selection. */
const Canvas = ({
  workflow,
  change,
}: {
  workflow: WorkflowDefinition;
  change: (change: Change) => void;
}): ReactNode => {
  const [drag, setDrag] = useState<Drag>({});
  const [sizes, setSizes] = useState<Sizes>({});
  const [nodesPicked, setNodesPicked] = useState<Set<string>>(new Set());
  const [edgesPicked, setEdgesPicked] = useState<Set<string>>(new Set());
  const projected = useMemo(() => project(workflow), [workflow]);
  const { nodes, edges } = onCanvas(projected, { drag, sizes }, nodesPicked, edgesPicked);
  const onNodesChange = (changes: NodeChange<Node<CardData>>[]): void => {
    const moved = dragged(changes, drag);
    setDrag(moved.drag);
    if (Object.keys(moved.drop).length > 0) change({ kind: "move", positions: moved.drop });
    setNodesPicked((current) => picked(changes, current));
    setSizes((current) => measured(changes, current));
  };
  return (
    <div className="cedar-canvas" role="region" aria-label={t("editor.canvas")}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={(changes) => setEdgesPicked((current) => picked(changes, current))}
        onConnect={(connection) => {
          const found = ends(connection);
          if (found !== undefined) change({ kind: "connect", ...found });
        }}
        isValidConnection={(connection) => {
          const found = ends(connection);
          return found !== undefined && canConnect(workflow, found.from, found.to);
        }}
        onDelete={({ nodes: gone, edges: cut }) =>
          change({ kind: "remove", nodes: gone.map((node) => node.id), edges: cut.map((edge) => edge.id) })
        }
        fitView
      >
        <Background />
        <MiniMap pannable zoomable />
        <Controls />
      </ReactFlow>
    </div>
  );
};

/** The validator's findings for the workflow as it stands, updated with every edit. */
const Problems = ({ workflow }: { workflow: WorkflowDefinition }): ReactNode => {
  const findings = useMemo(() => validateWorkflow(workflow), [workflow]);
  return (
    <section aria-labelledby="workflow-problems">
      <Title order={3} size="h5" id="workflow-problems" mb="xs">
        {t("editor.problems")}
      </Title>
      {findings.length === 0 ? (
        <Text>{t("editor.noProblems")}</Text>
      ) : (
        <List>
          {findings.map((finding, index) => (
            <List.Item key={`${finding.code}-${index}`}>
              {t("problem.severity", { severity: findingInfo[finding.code].severity })}: {describe(finding)}
            </List.Item>
          ))}
        </List>
      )}
    </section>
  );
};

/**
 * The visual workflow editor: a local document (new, imported from a file, exported in the canonical file form) with
 * undo and redo, the graph on a React Flow canvas, and the validator's findings below it.
 */
const Editor = (): ReactNode => {
  const edit = useDocument();
  const [problem, setProblem] = useState("");
  return (
    <Stack>
      <Toolbar edit={edit} onProblem={setProblem} />
      {problem !== "" && <Alert color="red">{problem}</Alert>}
      <Canvas workflow={edit.history.present} change={edit.change} />
      <Problems workflow={edit.history.present} />
    </Stack>
  );
};

export default Editor;
