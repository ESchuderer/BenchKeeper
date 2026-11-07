import { Finding } from "@cedarloom/contracts";
import { expect, test } from "vitest";
import "../src/workflow/jitless.ts";
import { describe } from "../src/workflow/problems.ts";

test("a finding the editor has no sentence for shows as its code", () => {
  expect(describe(Finding.parse({ code: "store.busy", params: { dir: "/s" } }))).toBe("store.busy");
});

test("a file refused for thousands of issues names the first ten and counts the rest", () => {
  const issues = Array.from({ length: 2000 }, (_, index) => ({
    path: `nodes.${Math.floor(index / 2)}.${index % 2 === 0 ? "x" : "y"}`,
    code: "unrecognized_keys",
  }));
  const named = issues.slice(0, 10).map((issue) => `${issue.path} unrecognized_keys`);
  expect(describe(Finding.parse({ code: "document.invalid", params: { issues } }))).toBe(
    `It does not match the workflow schema: ${named.join(", ")}, and 1990 more.`,
  );
});
