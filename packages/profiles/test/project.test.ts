import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { usesMantine } from "@cedarloom/profiles";
import { expect, test } from "vitest";

test("a package.json saved with a byte-order mark still tells that the project uses Mantine", () => {
  const project = mkdtempSync(join(process.env["RUNNER_TEMP"] ?? tmpdir(), "cedarloom-project-"));
  writeFileSync(join(project, "package.json"), '\uFEFF{"dependencies":{"@mantine/core":"8.0.0"}}');
  expect(usesMantine(project)).toBe(true);
});
