import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { managedPolicyDoctor } from "@cedarloom/use-cases";
import { expect, test } from "vitest";
import { testRoot } from "./harness.ts";

const root = testRoot("managed-policy");

test("the doctor warns about a managed policy that switches hooks or the sandbox off, and not about worker-only keys", () => {
  const files = mkdtempSync(join(root, "managed-"));
  mkdirSync(join(files, "managed-settings.d"));
  const home = realpathSync(mkdtempSync(join(root, "claude-")));
  // A host beyond GitHub only loosens a worker's network, which the user's own sessions do not have.
  const policy = { disableAllHooks: true, sandbox: { network: { allowedDomains: ["registry.npmjs.org"] } } };
  writeFileSync(join(files, "managed-settings.json"), JSON.stringify(policy));
  // A policy helper's output replaces every managed source, so what it switches off cannot be told beforehand.
  writeFileSync(
    join(files, "managed-settings.d", "10-helper.json"),
    JSON.stringify({ policyHelper: { command: "x" } }),
  );
  writeFileSync(join(home, "remote-settings.json"), JSON.stringify({ sandbox: { enabled: false } }));
  const places = { files: [files], preferences: null, reg: null };
  expect(managedPolicyDoctor({ CLAUDE_CONFIG_DIR: home }, "linux", { places })).toEqual([
    {
      code: "managed.unreadable",
      params: { path: join(files, "managed-settings.d", "10-helper.json"), error: "policyHelper" },
    },
    { code: "managed.guard-off", params: { path: join(files, "managed-settings.json"), key: "disableAllHooks" } },
    { code: "managed.guard-off", params: { path: join(home, "remote-settings.json"), key: "sandbox.enabled" } },
  ]);
});
