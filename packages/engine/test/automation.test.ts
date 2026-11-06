import type { AutomationSettings } from "@cedarloom/contracts";
import { levelAt, type OwnerOnly, routeQuestion, stricterLevel, waitsForOwner } from "@cedarloom/engine";
import { expect, test } from "vitest";

const GATES = ["before-implementation", "after-verdict", "before-merge"] as const;
const LEVELS = ["supervised", "checkpoint", "auto"] as const;
const OWNER_ONLY: readonly OwnerOnly[] = ["release", "publish", "deploy", "repository", "settings", "secret", "public"];
const waits = (level: (typeof LEVELS)[number], ownerOnly: readonly OwnerOnly[] = []) =>
  GATES.filter((gate) => waitsForOwner(level, gate, ownerOnly));

test("Supervised waits at every gate, Checkpoint only before a merge, Auto at none", () => {
  expect(waits("supervised")).toEqual(GATES);
  expect(waits("checkpoint")).toEqual(["before-merge"]);
  expect(waits("auto")).toEqual([]);
});

test("a step that touches anything owner-only waits at every gate of every level, Auto included", () => {
  for (const kind of OWNER_ONLY) {
    expect(LEVELS.map((level) => waits(level, [kind]))).toEqual([GATES, GATES, GATES]);
  }
});

test("the stricter of two levels is the one that waits for the owner more often", () => {
  expect(stricterLevel("auto", "supervised")).toBe("supervised");
  expect(stricterLevel("checkpoint", "auto")).toBe("checkpoint");
  expect(stricterLevel("supervised", "checkpoint")).toBe("supervised");
  expect(stricterLevel("auto", "auto")).toBe("auto");
});

test("Supervised parks every question; Checkpoint and Auto park the owner's and default the facts", () => {
  expect(routeQuestion("supervised", "fact")).toBe("park");
  expect(routeQuestion("checkpoint", "owner")).toBe("park");
  expect(routeQuestion("auto", "owner")).toBe("park");
  expect(routeQuestion("checkpoint", "fact")).toBe("default");
  expect(routeQuestion("auto", "fact")).toBe("default");
});

test("the level at a gate: the switch for running work, else the project's, else the default; Supervised when unset", () => {
  const settings: AutomationSettings = { schemaVersion: 1, default: "checkpoint", projects: { "/work/app": "auto" } };
  expect(levelAt(settings, "/work/app", "supervised")).toBe("supervised");
  expect(levelAt(settings, "/work/app", null)).toBe("auto");
  expect(levelAt(settings, "/work/other", null)).toBe("checkpoint");
  expect(levelAt(settings, "constructor", null)).toBe("checkpoint");
  expect(levelAt(null, "/work/app", null)).toBe("supervised");
});
