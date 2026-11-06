import "./jitless.ts";
import "@xyflow/react/dist/style.css";
import "./editor.css";
import type { Api } from "@cedarloom/client";
import type { ELK } from "elkjs/lib/elk-api.js";
import {
  findingInfo,
  formatWorkflow,
  readDocument,
  WORKFLOW_SCHEMA_VERSION,
  WorkflowDefinition,
} from "@cedarloom/contracts";
import { NODE_TYPES } from "@cedarloom/engine/graph";
import { validateWorkflow } from "@cedarloom/engine/validate";
import { Alert, Anchor, Button, FileButton, Group, List, Select, Stack, Text, Title } from "@mantine/core";
import { useDisclosure, useHotkeys } from "@mantine/hooks";
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
import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { t } from "../i18n.ts";
import {
  apply,
  canConnect,
  type Change,
  edit as editWorkflow,
  type History,
  newWorkflow,
  open,
  type Position,
  redo,
  undo,
} from "./document.ts";
import { ConnectDialog } from "./ConnectDialog.tsx";
import { useDrafts } from "./Drafts.tsx";
import { autoLayout, type Size } from "./layout.ts";
import { NodeCard } from "./NodeCard.tsx";
import { describe } from "./problems.ts";
import { type CardData, endsOf, isBoundary, project } from "./projection.ts";

const nodeTypes = { card: NodeCard };
const TYPES = Object.keys(NODE_TYPES);

/** The document, its history, and how many documents were opened (New, Import): the canvas starts over for each. */
type Edit = { history: History; loads: number; change: (change: Change) => void; undo: () => void; redo: () => void };

// The document outlives the view: Runs and back keeps the workflow and its undo history (a reload does not).
let kept: History | undefined;

/** The document and its history; Mod+Z undoes, Mod+Shift+Z and Mod+Y redo (not inside text fields). */
const useDocument = (): Edit => {
  const [history, setHistory] = useState<History>(() => kept ?? open(newWorkflow()));
  const [loads, setLoads] = useState(0);
  useEffect(() => {
    kept = history;
  }, [history]);
  const back = (): void => setHistory(undo);
  const forward = (): void => setHistory(redo);
  useHotkeys([
    ["mod+Z", back],
    ["mod+shift+Z", forward],
    ["mod+Y", forward],
  ]);
  const change = (next: Change): void => {
    if (next.kind === "replace") setLoads((count) => count + 1);
    setHistory((current) => apply(current, next));
  };
  return { history, loads, change, undo: back, redo: forward };
};

// A new node goes to a grid spot by the node count, five to a row.
// shortcut: after a delete a new node can cover another, look for a free spot if Auto layout is not enough.
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

// Disabled but focusable, so focus stays on the button when its stack runs empty; a press then does nothing.
const off = (disabled: boolean) => ({ "data-disabled": disabled, "aria-disabled": disabled });

type Layout = { elk: ELK; failed: Promise<never> };

let engine: Promise<Layout> | undefined;

// ELK loads on the first auto layout and runs in a Web Worker, unmodified from its package, so the page stays responsive.
// elk-api listens to the worker's messages only, so the worker's `error` (a script that cannot load, a crash) is turned
// into `failed` here, raced against each layout.
const start = async (): Promise<Layout> => {
  const [api, worker] = await Promise.all([import("elkjs/lib/elk-api.js"), import("elkjs/lib/elk-worker.min.js?url")]);
  const { promise: failed, reject } = Promise.withResolvers<never>();
  // Handled where it is raced; a worker that fails while no layout runs is no unhandled rejection.
  failed.catch(() => undefined);
  const workerFactory = (url = worker.default): Worker => {
    const created = new Worker(url);
    created.addEventListener("error", (event) => reject(new Error(event.message || t("editor.workerStopped"))));
    return created;
  };
  // elk-api is CommonJS: its default export is the module, whose `default` is the constructor again (ELK.default = ELK).
  return { elk: new api.default.default({ workerUrl: worker.default, workerFactory }), failed };
};

/** New positions from ELK; any failure ends the worker, and the next layout starts a new one. */
const layOut = async (workflow: WorkflowDefinition, sizes: Sizes): Promise<Record<string, Position>> => {
  engine ??= start();
  const started = engine;
  try {
    const { elk, failed } = await started;
    return await Promise.race([autoLayout(elk, workflow, sizes), failed]);
  } catch (error) {
    engine = undefined;
    void started.then(({ elk }) => elk.terminateWorker()).catch(() => undefined);
    throw error;
  }
};

type Notes = { onProblem: (text: string) => void; onStatus: (text: string) => void };

/** Auto layout (one undo step that writes only positions) and the keyboard path to a connection. */
const Arrange = ({ edit, sizes, onProblem, onStatus }: { edit: Edit; sizes: Sizes } & Notes): ReactNode => {
  const [busy, setBusy] = useState(false);
  const [connecting, dialog] = useDisclosure(false);
  // The document as it stands when the layout answers: one changed meanwhile (New, Import, an edit) drops the layout.
  // Set in the commit, so a render React discards never counts as the document.
  const latest = useRef(edit.history.present);
  useLayoutEffect(() => {
    latest.current = edit.history.present;
  }, [edit.history.present]);
  const lay = async (): Promise<void> => {
    if (busy) return;
    const laid = edit.history.present;
    setBusy(true);
    try {
      const move: Change = { kind: "move", positions: await layOut(laid, sizes) };
      if (latest.current !== laid) return;
      // Positions it already has are no edit and no undo step, and the status says so.
      edit.change(move);
      onStatus(t(editWorkflow(laid, move) === laid ? "editor.alreadyLaidOut" : "editor.laidOut"));
    } catch (error) {
      onProblem(t("editor.layoutFailed", { reason: error instanceof Error ? error.message : String(error) }));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      {/* Busy but focusable, so the keyboard focus stays on the button while ELK works. */}
      <Button variant="default" onClick={() => void lay()} {...off(busy)}>
        {t("editor.autoLayout")}
      </Button>
      <Button variant="default" onClick={dialog.open}>
        {t("editor.connectHandles")}
      </Button>
      <ConnectDialog
        workflow={edit.history.present}
        opened={connecting}
        onClose={dialog.close}
        change={edit.change}
        onDone={onStatus}
      />
    </>
  );
};

const UndoRedo = ({ edit }: { edit: Edit }): ReactNode => (
  <>
    <Button
      variant="default"
      onClick={edit.undo}
      {...off(edit.history.past.length === 0)}
      aria-keyshortcuts="Control+Z Meta+Z"
    >
      {t("editor.undo")}
    </Button>
    <Button
      variant="default"
      onClick={edit.redo}
      {...off(edit.history.future.length === 0)}
      aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z Control+Y Meta+Y"
    >
      {t("editor.redo")}
    </Button>
  </>
);

type ToolbarProps = { edit: Edit; sizes: Sizes; onRelease: () => void } & Notes;

const Toolbar = ({ edit, sizes, onProblem, onStatus, onRelease }: ToolbarProps): ReactNode => {
  const [type, setType] = useState<string | null>("command.run");
  // The file input forgets its file, so picking the same file again (fixed after a refusal) imports it again.
  const reset = useRef<() => void>(null);
  const { present } = edit.history;
  const take = async (file: File | null): Promise<void> => {
    reset.current?.();
    if (file === null) return;
    const found = await file.text().then(importOf, () => ({ problem: t("editor.unreadable") }));
    if ("problem" in found) onProblem(found.problem);
    else edit.change({ kind: "replace", workflow: found.workflow });
  };
  const add = (): void => {
    if (type !== null) edit.change({ kind: "add-node", type, position: nextSpot(present.nodes.length) });
  };
  // An export ends this tab's draft of the workflow open now; a new workflow keeps it, as an import does.
  const fresh = (): void => {
    edit.change({ kind: "replace", workflow: newWorkflow() });
  };
  const exported = (): void => {
    download(present);
    onRelease();
  };
  return (
    <Group align="end">
      <Select label={t("editor.nodeType")} data={TYPES} value={type} onChange={setType} allowDeselect={false} />
      <Button onClick={add}>{t("editor.addNode")}</Button>
      <UndoRedo edit={edit} />
      <Button variant="default" onClick={fresh}>
        {t("editor.new")}
      </Button>
      <FileButton resetRef={reset} onChange={(file) => void take(file)} accept="application/json,.json">
        {(props) => (
          <Button variant="default" {...props}>
            {t("editor.import")}
          </Button>
        )}
      </FileButton>
      <Button variant="default" onClick={exported}>
        {t("editor.export")}
      </Button>
      <Arrange edit={edit} sizes={sizes} onProblem={onProblem} onStatus={onStatus} />
    </Group>
  );
};

type Drag = Record<string, Position>;
type Sizes = Record<string, Size>;

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

// The selected ids still on the canvas: an id that left (deleted, undone) is not selected again when given out anew.
const useSelection = (items: { id: string }[]) => {
  const [ids, setIds] = useState<Set<string>>(new Set());
  const live = new Set(items.map((item) => item.id));
  const still = [...ids].filter((id) => live.has(id));
  if (still.length !== ids.size) setIds(new Set(still));
  return [ids, (changes: (NodeChange | EdgeChange)[]) => setIds((current) => picked(changes, current))] as const;
};

const DELETE_KEYS = ["Backspace", "Delete"];

const ends = (connection: Connection | Edge) =>
  endsOf({
    source: connection.source,
    sourceHandle: connection.sourceHandle ?? null,
    target: connection.target,
    targetHandle: connection.targetHandle ?? null,
  });

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
    draggable: !isBoundary(node.id),
    deletable: !isBoundary(node.id),
  })),
  edges: projected.edges.map((edge) => ({ ...edge, selected: edgesPicked.has(edge.id) })),
});

/** The graph, projected from the workflow: React Flow keeps nothing of its own but a drag in progress and the selection. */
type CanvasProps = {
  workflow: WorkflowDefinition;
  change: (change: Change) => void;
  onProblem: (text: string) => void;
  sizes: Sizes;
  onSizes: (update: (current: Sizes) => Sizes) => void;
};

/** A delete as one remove; a delete of every node is refused, since a workflow keeps one, and the page says why. */
const remover =
  ({ workflow, change, onProblem }: CanvasProps) =>
  ({ nodes: gone, edges: cut }: { nodes: Node[]; edges: Edge[] }): void => {
    const ids = new Set(gone.map((node) => node.id));
    if (workflow.nodes.every((node) => ids.has(node.id))) onProblem(t("editor.keepOne"));
    else change({ kind: "remove", nodes: [...ids], edges: cut.map((edge) => edge.id) });
  };

const Canvas = (props: CanvasProps): ReactNode => {
  const { workflow, change, sizes, onSizes } = props;
  const [drag, setDrag] = useState<Drag>({});
  const projected = useMemo(() => project(workflow), [workflow]);
  const [nodesPicked, pickNodes] = useSelection(projected.nodes);
  const [edgesPicked, pickEdges] = useSelection(projected.edges);
  const { nodes, edges } = onCanvas(projected, { drag, sizes }, nodesPicked, edgesPicked);
  const onNodesChange = (changes: NodeChange<Node<CardData>>[]): void => {
    const moved = dragged(changes, drag);
    setDrag(moved.drag);
    if (Object.keys(moved.drop).length > 0) change({ kind: "move", positions: moved.drop });
    pickNodes(changes);
    onSizes((current) => measured(changes, current));
  };
  return (
    <div className="cedar-canvas" role="region" aria-label={t("editor.canvas")}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={pickEdges}
        deleteKeyCode={DELETE_KEYS}
        onConnect={(connection) => {
          const found = ends(connection);
          if (found !== undefined) change({ kind: "connect", ...found });
        }}
        isValidConnection={(connection) => {
          const found = ends(connection);
          return found !== undefined && canConnect(workflow, found.from, found.to);
        }}
        onDelete={remover(props)}
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
      {/* The count is announced after each edit; the list is not, so an edit does not read every finding out. */}
      <Text role="status">
        {findings.length === 0 ? t("editor.noProblems") : t("editor.problemCount", { count: findings.length })}
      </Text>
      {findings.length > 0 && (
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

type Status = { text: string; count: number; at?: History };

/**
 * The status line's sentence. It is keyed by its count, so the same sentence again is a new node that a screen reader
 * reads again; it belongs to the document it first showed with, so the next change of the document ends it.
 */
const useStatus = (history: History): [Status, (text: string) => void] => {
  const [status, setStatus] = useState<Status>({ text: "", count: 0 });
  useEffect(() => {
    setStatus((last) => {
      if (last.at === undefined) return { ...last, at: history };
      return last.at === history ? last : { text: "", count: last.count };
    });
  }, [history, status.count]);
  return [status, (text) => setStatus((last) => ({ text, count: last.count + 1 }))];
};

/**
 * The visual workflow editor: a document (new, imported from a file, exported in the canonical file form) with undo and
 * redo and a draft in the state folder, the graph on a React Flow canvas, and the validator's findings below it.
 */
const Editor = ({ api }: { api: Api }): ReactNode => {
  const edit = useDocument();
  // A refusal shows until the document changes: it is kept with the history it was raised on.
  const [problem, setProblem] = useState<{ text: string; at: History } | null>(null);
  const raise = (text: string): void => setProblem({ text, at: edit.history });
  const [status, say] = useStatus(edit.history);
  const announced = useRef<HTMLParagraphElement>(null);
  // Node sizes as React Flow measured them: the canvas shows nodes with them, the auto layout spaces nodes by them.
  const [sizes, setSizes] = useState<Sizes>({});
  const workflow = edit.history.present;
  const focus = (): void => announced.current?.focus();
  const drafts = useDrafts({ api, workflow, loads: edit.loads, change: edit.change, onStatus: say, focus });
  return (
    <Stack>
      {drafts.offers}
      <Toolbar edit={edit} sizes={sizes} onProblem={raise} onStatus={say} onRelease={drafts.release} />
      {problem?.at === edit.history && <Alert color="red">{problem.text}</Alert>}
      <Text role="status" size="sm" ref={announced} tabIndex={-1}>
        {status.text === "" ? null : <span key={status.count}>{status.text}</span>}
      </Text>
      <Text size="sm">{drafts.saved}</Text>
      <Canvas
        key={edit.loads}
        workflow={workflow}
        change={edit.change}
        onProblem={raise}
        sizes={sizes}
        onSizes={setSizes}
      />
      <Anchor href="licenses/elkjs.txt" target="_blank" rel="noreferrer" size="sm">
        {t("editor.license")}
      </Anchor>
      <Problems workflow={workflow} />
    </Stack>
  );
};

export default Editor;
