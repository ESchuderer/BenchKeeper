import type { AutomationSettings } from "@cedarloom/contracts";
import { levelAt, routeQuestion, waitsForOwner } from "@cedarloom/engine";
import { expect, test } from "vitest";

const GATES = ["before-implementation", "after-verdict", "before-merge"] as const;

test("Supervised waits at every gate, Checkpoint only before a merge, Auto at none", () => {
  const waits = (level: "supervised" | "checkpoint" | "auto") => GATES.filter((gate) => waitsForOwner(level, gate));
  expect(waits("supervised")).toEqual(GATES);
  expect(waits("checkpoint")).toEqual(["before-merge"]);
  expect(waits("auto")).toEqual([]);
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
