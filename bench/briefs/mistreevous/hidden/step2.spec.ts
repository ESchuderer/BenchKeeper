// Step 2 hidden tests (steps/2.md): restore() checks that the snapshot belongs to the tree's definition, rejects input
// that is not a snapshot, and restarts an action whose promise was pending at snapshot time.
import { assert } from "chai";
import { BehaviourTree, State, roundTrip, states } from "./helpers";

const DEF = "root { sequence { action [a] action [b] } }";
const OTHER = "root { sequence { action [a] action [b] action [c] } }";
const JSON_DEF = { type: "root", child: { type: "sequence", children: [{ type: "action", call: "a" }, { type: "action", call: "b" }] } };
const ag = () => ({ a: () => State.SUCCEEDED, b: () => undefined, c: () => State.SUCCEEDED });

describe("S2-reject", () => {
    it("restoring a snapshot of another definition throws an Error naming the definition", () => {
        const tree: any = new BehaviourTree(DEF, ag());
        tree.step();
        const other: any = new BehaviourTree(OTHER, ag());
        assert.throws(() => other.restore(roundTrip(tree)), Error, /definition/i);
    });

    it("a definition that differs only in an action name is rejected too", () => {
        const tree: any = new BehaviourTree(DEF, ag());
        tree.step();
        const other: any = new BehaviourTree("root { sequence { action [a] action [c] } }", ag());
        assert.throws(() => other.restore(roundTrip(tree)), Error, /definition/i);
    });
});

describe("S2-unchanged", () => {
    it("after a rejected restore the tree keeps its own state and runs on normally", () => {
        const tree: any = new BehaviourTree(DEF, ag());
        tree.step();
        const other: any = new BehaviourTree(OTHER, ag());
        other.step();
        const before = states(other);
        assert.isFunction(other.restore);
        assert.throws(() => other.restore(roundTrip(tree)));
        assert.deepEqual(states(other), before);
        other.step();
        assert.strictEqual(other.getState(), State.RUNNING);
    });
});

describe("S2-equivalent", () => {
    it("an MDSL definition and its JSON equivalent count as the same definition, both ways", () => {
        const fromMdsl: any = new BehaviourTree(DEF, ag());
        fromMdsl.step();
        const fromJson: any = new BehaviourTree(JSON_DEF as any, ag());
        assert.doesNotThrow(() => fromJson.restore(roundTrip(fromMdsl)));
        assert.deepEqual(states(fromJson), states(fromMdsl));
        const back: any = new BehaviourTree(DEF, ag());
        assert.doesNotThrow(() => back.restore(roundTrip(fromJson)));
    });
});

describe("S2-invalid", () => {
    for (const [label, value] of [["null", null], ["an empty object", {}], ["a string", "snapshot"], ["an array", []], ["a number", 42]] as const) {
        it(`restore(${label}) throws an Error and leaves the tree unchanged`, () => {
            const tree: any = new BehaviourTree(DEF, ag());
            tree.step();
            const before = states(tree);
            assert.isFunction(tree.restore);
            assert.throws(() => tree.restore(value as any), Error);
            assert.deepEqual(states(tree), before);
        });
    }
});

describe("S2-async", () => {
    it("an action whose promise is pending at snapshot time is called again on the restored tree's next step", async () => {
        const def = "root { sequence { action [fetch] action [after] } }";
        let calls = 0, after = 0;
        const tree: any = new BehaviourTree(def, { fetch: () => new Promise(() => {}), after: () => State.SUCCEEDED });
        tree.step();
        assert.strictEqual(tree.getState(), State.RUNNING);
        let resolve!: (s: State) => void;
        const restored: any = new BehaviourTree(def, {
            fetch: () => (calls++, new Promise<State>((r) => (resolve = r))),
            after: () => (after++, State.SUCCEEDED)
        });
        restored.restore(roundTrip(tree));
        restored.step();
        assert.strictEqual(calls, 1);
        resolve(State.SUCCEEDED);
        await Promise.resolve();
        await Promise.resolve();
        restored.step();
        assert.strictEqual(after, 1);
        assert.strictEqual(restored.getState(), State.SUCCEEDED);
    });
});
