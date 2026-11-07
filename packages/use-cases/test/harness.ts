import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Result } from "@cedarloom/contracts";
import { afterAll } from "vitest";

/** A folder for one test file's runs, removed after them; under RUNNER_TEMP on CI, where the system temp is slow. */
export const testRoot = (name: string): string => {
  const root = mkdtempSync(join(process.env["RUNNER_TEMP"] ?? tmpdir(), `cedarloom-${name}-`));
  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });
  return root;
};

/** The value of a result; a refusal fails the test with its code. */
export const ok = <T>(result: Result<T>): T => {
  if (!result.ok) throw new Error(`refused: ${result.finding.code}`);
  return result.value;
};
