// Step 3 hidden tests (steps/3.md): restore() does not report state changes, and snapshots are detached from the tree.
import { assert } from "chai";
import { BehaviourTree, State, roundTrip } from "./helpers";

const DEF = "root { sequence { action [a] repeat [3] { action [b] } wait [1000] } }";
const ag = () => ({ a: () => State.SUCCEEDED, b: () => State.SUCCEEDED });

describe("S3-no-events", () => {
    it("restore() does not call onNodeStateChange", () => {
        const tree: any = new BehaviourTree(DEF, ag(), { getDeltaTime: () => 0.1 });
        for (let i = 0; i < 3; i++) tree.step();
        const changes: unknown[] = [];
        const restored: any = new BehaviourTree(DEF, ag(), { getDeltaTime: () => 0.1, onNodeStateChange: (c: unknown) => changes.push(c) });
        restored.restore(roundTrip(tree));
        assert.lengthOf(changes, 0);
        restored.step();
        assert.isAbove(changes.length, 0);
    });
});

describe("S3-detached", () => {
    it("stepping the tree does not change a snapshot taken before", () => {
        const tree: any = new BehaviourTree(DEF, ag(), { getDeltaTime: () => 0.1 });
        tree.step();
        const snap = tree.snapshot();
        const before = JSON.stringify(snap);
        for (let i = 0; i < 5; i++) tree.step();
        assert.strictEqual(JSON.stringify(snap), before);
    });

    it("stepping a restored tree does not change the snapshot object it was restored from", () => {
        const tree: any = new BehaviourTree(DEF, ag(), { getDeltaTime: () => 0.1 });
        tree.step();
        const snap = tree.snapshot();
        const before = JSON.stringify(snap);
        const restored: any = new BehaviourTree(DEF, ag(), { getDeltaTime: () => 0.1 });
        restored.restore(snap);
        for (let i = 0; i < 5; i++) restored.step();
        assert.strictEqual(JSON.stringify(snap), before);
    });

    it("a snapshot taken right after restore() equals the snapshot it was restored from", () => {
        const tree: any = new BehaviourTree(DEF, ag(), { getDeltaTime: () => 0.1 });
        for (let i = 0; i < 3; i++) tree.step();
        const snap = roundTrip(tree);
        const restored: any = new BehaviourTree(DEF, ag(), { getDeltaTime: () => 0.1 });
        restored.restore(snap);
        assert.deepEqual(roundTrip(restored), snap);
    });
});
