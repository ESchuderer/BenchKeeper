import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatInstalled, type Result } from "@cedarloom/contracts";
import {
  applyPlan,
  bundledExtensions,
  extensionChecks,
  extensionToStart,
  planSwitch,
  undoRun,
} from "@cedarloom/use-cases";
import { afterAll, expect, test } from "vitest";

const root = mkdtempSync(join(process.env["RUNNER_TEMP"] ?? tmpdir(), "cedarloom-bundled-"));
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

const ok = <T>(result: Result<T>): T => {
  if (!result.ok) throw new Error(`refused: ${result.finding.code}`);
  return result.value;
};
const ID = "cedarloom.example";
const manifest = (id: string): string =>
  JSON.stringify({
    schemaVersion: 1,
    kind: "cedarloom.extension",
    id,
    version: "1.0.0",
    name: "Example",
    api: "1.0",
    runtime: { kind: "node", entry: "main.mjs" },
    contributes: { actions: { status: { title: "Status" } } },
  });
// An extension's folder: its manifest and an entry nothing here runs.
const extensionIn = (folder: string, id = ID): string => {
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "cedarloom-extension.json"), manifest(id));
  writeFileSync(join(folder, "main.mjs"), "");
  return folder;
};
// The state, configuration and app folders of one machine, the app shipping the example.
const machine = (): { state: string; config: string; app: string } => {
  const at = mkdtempSync(join(root, "machine-"));
  extensionIn(join(at, "app", ID));
  return { state: join(at, "state"), config: join(at, "config"), app: join(at, "app") };
};

test("the app's own extension loads from its folder without consent; a copy installed in the state folder is community", () => {
  const paths = machine();
  const own = ok(bundledExtensions(paths.app, paths.config)).map(({ id, state }) => ({ id, state }));
  const bundled = ok(extensionToStart(paths, ID));
  // The same extension installed from elsewhere, on a machine whose app does not ship it.
  const digest = "a".repeat(64);
  const copy = extensionIn(join(paths.state, "extensions", ID, digest));
  const pin = { version: "1.0.0", source: { git: "https://example.org/x.git", commit: "b".repeat(40) }, digest };
  const installed = {
    schemaVersion: 1,
    kind: "cedarloom.extensions",
    extensions: { [ID]: { ...pin, ref: "HEAD", consented: "c".repeat(64) } },
  } as const;
  writeFileSync(join(paths.state, "extensions.json"), formatInstalled(installed));
  const community = ok(extensionToStart({ ...paths, app: join(root, "no-app") }, ID));
  expect([own, bundled.trust, bundled.folder, community.trust, community.folder]).toEqual([
    [{ id: ID, state: "auto" }],
    "bundled",
    join(paths.app, ID),
    "community",
    copy,
  ]);
});

test("an extension switched off starts nothing, and runs undo switches it back", () => {
  const paths = machine();
  const off = ok(applyPlan(paths.state, ok(planSwitch(paths.app, paths.config, ID, "off")), { yes: true }));
  const refused = extensionToStart(paths, ID);
  ok(undoRun(paths.state, String(off.runId), { yes: true }));
  const unknown = planSwitch(paths.app, paths.config, "acme.other", "off");
  expect([refused, ok(extensionToStart(paths, ID)).trust, unknown]).toEqual([
    { ok: false, finding: { code: "extension.refused", params: { extension: ID, reason: "off" } } },
    "bundled",
    { ok: false, finding: { code: "extension.unknown", params: { extension: "acme.other" } } },
  ]);
});

test("a components map CedarLoom cannot read refuses the start, and an app folder not named by its cedarloom id is refused", () => {
  const paths = machine();
  mkdirSync(paths.config, { recursive: true });
  const map = { schemaVersion: 1, kind: "cedarloom.components", components: { [ID]: "on" } };
  writeFileSync(join(paths.config, "components.json"), JSON.stringify(map));
  const unreadable = extensionToStart(paths, ID);
  const renamed = machine();
  extensionIn(join(renamed.app, "renamed"));
  // Named by its id, but not of the cedarloom publisher: it would hide an extension installed from Git.
  const foreign = machine();
  extensionIn(join(foreign.app, "acme.example"), "acme.example");
  const listings = [renamed, foreign].map(({ app, config }) => bundledExtensions(app, config));
  const invalidId = {
    ok: false,
    finding: { code: "document.invalid", params: { issues: [{ path: "id", code: "custom" }] } },
  };
  expect([unreadable, ...listings]).toEqual([
    {
      ok: false,
      finding: {
        code: "document.invalid",
        params: { issues: [expect.objectContaining({ path: "components.cedarloom.example" })] },
      },
    },
    invalidId,
    invalidId,
  ]);
});

test("the doctor asks the app's own extensions that are on for their checks, stops them, and starts none switched off", async () => {
  const paths = machine();
  const folder = join(paths.app, ID);
  const contributes = { actions: { status: { title: "Status" } }, doctor: { setup: { title: "Setup" } } };
  writeFileSync(join(folder, "cedarloom-extension.json"), JSON.stringify({ ...JSON.parse(manifest(ID)), contributes }));
  copyFileSync(join(import.meta.dirname, "fixtures", "doctor", "main.mjs"), join(folder, "main.mjs"));
  const on = await extensionChecks(paths);
  const pid = Number(/\d+$/.exec(String(Reflect.get(Object(on[0]?.params), "message")))?.[0]);
  ok(applyPlan(paths.state, ok(planSwitch(paths.app, paths.config, ID, "off")), { yes: true }));
  expect([on, await gone(pid), await extensionChecks(paths)]).toEqual([
    [
      {
        code: "extension.finding",
        params: { extension: ID, check: "setup", severity: "info", code: "example.ready", message: `ready ${pid}` },
      },
    ],
    true,
    [],
  ]);
});

// Whether the process `pid` is gone, within a second: an ended one may take a moment to be reaped.
async function gone(pid: number): Promise<boolean> {
  for (let tries = 0; tries < 20; tries += 1) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}
