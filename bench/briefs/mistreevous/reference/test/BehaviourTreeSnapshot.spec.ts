import { assert } from "chai";

import { BehaviourTree, State } from "../src/index";

describe("A BehaviourTree snapshot", () => {
    it("restores a repeat node's progress into a new tree", () => {
        const definition = "root { repeat [3] { action [tick] } }";
        const tree = new BehaviourTree(definition, { tick: () => State.SUCCEEDED });
        tree.step();
        tree.step();

        let ticks = 0;
        const restored = new BehaviourTree(definition, { tick: () => (ticks++, State.SUCCEEDED) });
        restored.restore(JSON.parse(JSON.stringify(tree.snapshot())));
        restored.step();
        restored.step();

        assert.strictEqual(ticks, 1);
        assert.strictEqual(restored.getState(), State.SUCCEEDED);
    });

    it("rejects a snapshot of another definition", () => {
        const tree = new BehaviourTree("root { action [a] }", { a: () => State.SUCCEEDED });
        const other = new BehaviourTree("root { action [b] }", { b: () => State.SUCCEEDED });
        assert.throws(() => other.restore(tree.snapshot()), Error, "snapshot does not match the definition of this tree");
    });
});
