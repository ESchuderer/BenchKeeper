import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";
import type { ReactNode } from "react";
import { t } from "../i18n.ts";
import type { CardData } from "./projection.ts";
import { INPUTS, OUTPUTS } from "./projection.ts";

type Row = CardData["inputs"][number];

// One handle with its name and type as text: the canvas never shows a type by color alone.
const HandleRow = ({ handle, side }: { handle: Row; side: "target" | "source" }): ReactNode => (
  <div className={`cedar-handle cedar-handle-${side}`}>
    <Handle type={side} position={side === "target" ? Position.Left : Position.Right} id={handle.name} />
    <span>
      {handle.name} <small>{handle.type}</small>
    </span>
  </div>
);

const titleOf = (id: string): string => {
  if (id === INPUTS) return t("editor.inputs");
  return id === OUTPUTS ? t("editor.outputs") : id;
};

/** A workflow node on the canvas: its id and type, its inputs on the left and its outputs on the right. */
export const NodeCard = ({ id, data }: NodeProps<Node<CardData>>): ReactNode => (
  <div className="cedar-card">
    <div className="cedar-card-title">
      <strong>{titleOf(id)}</strong>
      {id.startsWith("@") ? null : <small>{data.type}</small>}
    </div>
    {data.inputs.map((handle) => (
      <HandleRow key={`in-${handle.name}`} handle={handle} side="target" />
    ))}
    {data.outputs.map((handle) => (
      <HandleRow key={`out-${handle.name}`} handle={handle} side="source" />
    ))}
  </div>
);
