import { Finding } from "@cedarloom/contracts";
import { expect, test } from "vitest";
import "../src/workflow/jitless.ts";
import { describe } from "../src/workflow/problems.ts";

// Parameters of each finding code, made up from its schema: numbers for counts and versions, lists, the rest text.
const sample = (code: string): Record<string, unknown> => {
  const shape = Finding.options.find((option) => option.shape.code.value === code)?.shape.params.shape ?? {};
  const value = (key: string): unknown => {
    if (/count|found|known/.test(key)) return 2;
    if (key === "nodes") return ["a", "b"];
    if (key === "issues") return [{ path: "", code: "invalid_type" }];
    if (key === "kind") return "node";
    if (key === "end") return "from";
    if (key === "section") return "layout";
    return /from|to$/.test(key) && code.includes("handles") ? "string" : key;
  };
  return Object.fromEntries(Object.keys(shape).map((key) => [key, value(key)]));
};

test("every workflow finding and import refusal has a sentence in the problems panel; other codes show as the code", () => {
  const codes = Finding.options.map((option) => option.shape.code.value);
  const shown = codes.filter(
    (code) => code.startsWith("workflow.") || code.startsWith("document.i") || code === "document.newer-schema",
  );
  expect(shown.length).toBe(19);
  for (const code of shown) {
    const finding = Finding.parse({ code, params: sample(code) });
    expect([code, describe(finding)]).toEqual([code, expect.stringMatching(/^\S.{15,}/s)]);
    expect(describe(finding)).not.toContain(code);
  }
  expect(describe(Finding.parse({ code: "store.busy", params: { dir: "/s" } }))).toBe("store.busy");
  // A workflow output names itself as such; a node input names its node.
  const output = Finding.parse({ code: "workflow.missing-source", params: { node: null, handle: "report" } });
  expect(describe(output)).toBe("The workflow output report gets no edge, but it needs one.");
});
