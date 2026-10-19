// Shared helpers of the hidden tests: they call the public API only (BehaviourTree, State from src/index), and every
// snapshot goes through JSON.stringify and JSON.parse, as a process restart would.
import { BehaviourTree, State } from "../src/index";

export { BehaviourTree, State };

export const roundTrip = (tree: any) => JSON.parse(JSON.stringify(tree.snapshot()));

// The node states of a tree from getTreeNodeDetails, depth first, without the per-tree node ids.
export function states(tree: any): string[] {
    const out: string[] = [];
    const walk = (n: any) => {
        out.push(`${n.type}:${n.name}:${n.state}`);
        (n.children || []).forEach(walk);
    };
    walk(tree.getTreeNodeDetails());
    return out;
}

