// Step 1 hidden tests (steps/1.md): snapshot() and restore() resume a tree as if it had never stopped.
// One describe per check id; the check passes when every test in it passes.
import { assert } from "chai";
import sinon from "sinon";
import { BehaviourTree, State, roundTrip, states } from "./helpers";

const SEQ = `root {
    sequence {
        action [first]
        selector {
            condition [isFalse]
            action [second]
        }
        parallel {
            action [third]
            action [fourth]
        }
    }
}`;

// An agent whose actions finish after a fixed number of calls; `calls` records every call in order, `left` the calls each
// action still needs, so a second agent can continue from the same point.
function agent(steps: Record<string, number>) {
    const calls: string[] = [];
    const left = { ...steps };
    const a: any = { calls, left, isFalse: () => false };
    for (const name of Object.keys(steps)) {
        a[name] = () => {
            calls.push(name);
            return --left[name] <= 0 ? State.SUCCEEDED : undefined;
        };
    }
    return a;
}

describe("S1-api", () => {
    it("snapshot() returns a plain object that survives JSON.stringify and JSON.parse", () => {
        const tree: any = new BehaviourTree(SEQ, agent({ first: 2, second: 2, third: 3, fourth: 1 }));
        tree.step();
        const snap = tree.snapshot();
        assert.isObject(snap);
        assert.deepEqual(JSON.parse(JSON.stringify(snap)), snap);
        assert.notInclude(JSON.stringify(snap, (_k, v) => (typeof v === "function" ? "FUNCTION" : v)), "FUNCTION");
    });

    it("restore() accepts the parsed snapshot on a new tree of the same definition", () => {
        const tree: any = new BehaviourTree(SEQ, agent({ first: 2, second: 2, third: 3, fourth: 1 }));
        tree.step();
        const copy: any = new BehaviourTree(SEQ, agent({ first: 2, second: 2, third: 3, fourth: 1 }));
        assert.doesNotThrow(() => copy.restore(roundTrip(tree)));
    });
});

describe("S1-resume", () => {
    for (const at of [1, 2, 3, 4]) {
        it(`a tree restored after ${at} step(s) continues exactly like the uninterrupted tree`, () => {
            const a = agent({ first: 2, second: 2, third: 3, fourth: 1 });
            const original: any = new BehaviourTree(SEQ, a);
            for (let i = 0; i < at; i++) original.step();
            const b = agent(a.left);
            const restored: any = new BehaviourTree(SEQ, b);
            restored.restore(roundTrip(original));
            assert.deepEqual(states(restored), states(original));
            a.calls.length = 0;
            for (let i = 0; i < 8 && original.isRunning(); i++) {
                original.step();
                restored.step();
                assert.deepEqual(states(restored), states(original));
            }
            assert.deepEqual(b.calls, a.calls);
            assert.strictEqual(restored.getState(), State.SUCCEEDED);
        });
    }
});

describe("S1-counters", () => {
    it("a repeat node keeps its iteration count", () => {
        let n = 0;
        const def = "root { repeat [3] { action [tick] } }";
        const tree: any = new BehaviourTree(def, { tick: () => (n++, State.SUCCEEDED) });
        tree.step();
        tree.step();
        let m = 0;
        const restored: any = new BehaviourTree(def, { tick: () => (m++, State.SUCCEEDED) });
        restored.restore(roundTrip(tree));
        restored.step();
        assert.strictEqual(m, 1);
        restored.step();
        assert.strictEqual(restored.getState(), State.SUCCEEDED);
        assert.strictEqual(m, 1);
    });

    it("a retry node keeps its attempt count", () => {
        const def = "root { retry [3] { action [attempt] } }";
        const tree: any = new BehaviourTree(def, { attempt: () => State.FAILED });
        tree.step();
        tree.step();
        let m = 0;
        const restored: any = new BehaviourTree(def, { attempt: () => (m++, State.FAILED) });
        restored.restore(roundTrip(tree));
        restored.step();
        assert.strictEqual(m, 1);
        restored.step();
        assert.strictEqual(restored.getState(), State.FAILED);
        assert.strictEqual(m, 1);
    });
});

describe("S1-random", () => {
    it("random iteration and attempt counts picked before the snapshot are kept", () => {
        // parallel: both nodes pick their counts on the first step
        const def = "root { parallel { repeat [2, 6] { action [tick] } retry [2, 6] { action [fail] } } }";
        // 0.99 picks the maximum (6) for both
        const tree: any = new BehaviourTree(def, { tick: () => State.SUCCEEDED, fail: () => State.FAILED }, { random: () => 0.99 });
        tree.step();
        let ticks = 0, fails = 0;
        // 0 would pick the minimum (2) if the restored tree drew again
        const restored: any = new BehaviourTree(def, { tick: () => (ticks++, State.SUCCEEDED), fail: () => (fails++, State.FAILED) }, { random: () => 0 });
        restored.restore(roundTrip(tree));
        for (let i = 0; i < 20 && restored.isRunning(); i++) restored.step();
        assert.strictEqual(ticks, 5);
        assert.strictEqual(fails, 5);
    });

    it("the child a lotto node picked before the snapshot stays picked", () => {
        const def = "root { lotto { action [a] action [b] } }";
        const tree: any = new BehaviourTree(def, { a: () => undefined, b: () => undefined }, { random: () => 0.99 });
        tree.step();
        const calls: string[] = [];
        const restored: any = new BehaviourTree(def, { a: () => (calls.push("a"), undefined), b: () => (calls.push("b"), undefined) }, { random: () => 0 });
        restored.restore(roundTrip(tree));
        restored.step();
        restored.step();
        assert.deepEqual(calls, ["b", "b"]);
    });

    it("a random wait duration picked before the snapshot is kept", () => {
        const def = "root { wait [100, 1100] }";
        let delta = 0;
        // 0.9999999 picks 1100 ms
        const tree: any = new BehaviourTree(def, {}, { random: () => 0.9999999, getDeltaTime: () => delta });
        tree.step();
        const restored: any = new BehaviourTree(def, {}, { random: () => 0, getDeltaTime: () => delta });
        restored.restore(roundTrip(tree));
        delta = 0.5;
        restored.step();
        assert.strictEqual(restored.getState(), State.RUNNING);
        delta = 0.599;
        restored.step();
        assert.strictEqual(restored.getState(), State.RUNNING);
        delta = 0.001;
        restored.step();
        assert.strictEqual(restored.getState(), State.SUCCEEDED);
    });
});

describe("S1-wait-clock", () => {
    let clock: sinon.SinonFakeTimers;
    beforeEach(() => (clock = sinon.useFakeTimers(1_000_000)));
    afterEach(() => clock.restore());

    it("a restored wait finishes after the remaining time; time between snapshot and restore does not count", () => {
        const def = "root { wait [1000] }";
        const tree: any = new BehaviourTree(def, {});
        tree.step();
        clock.tick(400);
        tree.step();
        const snap = roundTrip(tree);
        clock.tick(60_000);
        const restored: any = new BehaviourTree(def, {});
        restored.restore(snap);
        restored.step();
        assert.strictEqual(restored.getState(), State.RUNNING);
        clock.tick(599);
        restored.step();
        assert.strictEqual(restored.getState(), State.RUNNING);
        clock.tick(1);
        restored.step();
        assert.strictEqual(restored.getState(), State.SUCCEEDED);
    });
});

describe("S1-wait-delta", () => {
    it("with getDeltaTime the waited time is kept", () => {
        const def = "root { wait [1000] }";
        let delta = 0.3;
        const tree: any = new BehaviourTree(def, {}, { getDeltaTime: () => delta });
        tree.step();
        tree.step();
        const restored: any = new BehaviourTree(def, {}, { getDeltaTime: () => delta });
        restored.restore(roundTrip(tree));
        delta = 0.3;
        restored.step();
        assert.strictEqual(restored.getState(), State.RUNNING);
        delta = 0.1;
        restored.step();
        assert.strictEqual(restored.getState(), State.SUCCEEDED);
    });
});

describe("S1-details", () => {
    it("getTreeNodeDetails() of the restored tree shows the same node states", () => {
        const def = "root { sequence { action [a] repeat [2] { action [b] } wait } }";
        const ag = { a: () => State.SUCCEEDED, b: () => State.SUCCEEDED };
        const tree: any = new BehaviourTree(def, ag);
        for (let i = 0; i < 3; i++) tree.step();
        const restored: any = new BehaviourTree(def, ag);
        restored.restore(roundTrip(tree));
        assert.deepEqual(states(restored), states(tree));
        assert.strictEqual(restored.getState(), tree.getState());
    });

    it("a snapshot of a finished tree restores as finished, and the next step starts a new run", () => {
        let n = 0;
        const def = "root { action [once] }";
        const tree: any = new BehaviourTree(def, { once: () => State.SUCCEEDED });
        tree.step();
        const restored: any = new BehaviourTree(def, { once: () => (n++, State.SUCCEEDED) });
        restored.restore(roundTrip(tree));
        assert.strictEqual(restored.getState(), State.SUCCEEDED);
        restored.step();
        assert.strictEqual(n, 1);
    });
});

describe("S1-fresh-run", () => {
    it("after a restored run finishes, the next run draws its random counts again", () => {
        const def = "root { repeat [1, 5] { action [tick] } }";
        const values = [0.99];
        let ticks = 0;
        const tree: any = new BehaviourTree(def, { tick: () => State.SUCCEEDED }, { random: () => values[0] });
        tree.step();
        const restored: any = new BehaviourTree(def, { tick: () => (ticks++, State.SUCCEEDED) }, { random: () => values[0] });
        restored.restore(roundTrip(tree));
        for (let i = 0; i < 10 && restored.isRunning(); i++) restored.step();
        assert.strictEqual(ticks, 4);
        values[0] = 0;
        ticks = 0;
        restored.step();
        for (let i = 0; i < 10 && restored.isRunning(); i++) restored.step();
        assert.strictEqual(ticks, 1);
    });
});
