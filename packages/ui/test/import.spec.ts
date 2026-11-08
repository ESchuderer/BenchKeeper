import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Started } from "@cedarloom/server";
import { applyPlan, type Fetch, planExport, planSave, saveDraft } from "@cedarloom/use-cases";
import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { accessible, openPage, serve } from "./browser.ts";

const errors: string[] = [];
// The store commits as the user Git names; the test's own home names one (as use-cases' harness does).
const homes = { HOME: process.env["HOME"], XDG_CONFIG_HOME: process.env["XDG_CONFIG_HOME"] };
let server: Started;
let context: BrowserContext;
let page: Page;
let state = "";

const corpus = join(import.meta.dirname, "..", "..", "contracts", "corpus", "WorkflowDefinition", "1");
const FILES = ["cedarloom-export.json", "workflows/workflow-w.json"];

// A command whose right-to-left override (U+202E) would show it to a reader as "echo txt.exe" (Trojan Source).
const TROJAN = { id: "trojan", type: "command.run", with: { command: "echo \u202Eexe.txt" } };

// The corpus's build-and-review stored on the machine of `at` as `id`, with `more` nodes.
const store = (at: string, id: string, more: object[] = []): void => {
  const base = JSON.parse(readFileSync(join(corpus, "valid-build-and-review.json"), "utf8"));
  const workflow = { ...base, metadata: { ...base.metadata, id, version: "1.0.0" }, nodes: [...base.nodes, ...more] };
  const saved = saveDraft(at, id, workflow, null);
  const save = saved.ok ? planSave(at, id, { onTop: false }) : saved;
  if (!save.ok) throw new Error(`${id} was not saved`);
  applyPlan(at, save.value.plan, { yes: true });
};

// Another machine's export of the corpus's build-and-review as w, with TROJAN, served as one commit of any Git source.
const exported = (root: string): Fetch => {
  const from = join(root, "from");
  store(from, "w", [TROJAN]);
  const folder = join(from, "shared");
  const exporting = planExport(from, ["w"], folder, { name: "Team flows" });
  if (!exporting.ok) throw new Error("w was not exported");
  applyPlan(from, exporting.value, { yes: true });
  const files = FILES.map((path) => {
    const content = readFileSync(join(folder, ...path.split("/")));
    return { path, mode: "100644" as const, sha256: createHash("sha256").update(content).digest("hex"), content };
  });
  return async () => ({ ok: true, value: { commit: "1".repeat(40), digest: "2".repeat(64), files } });
};

test.beforeAll(async ({ browser }) => {
  const root = mkdtempSync(join(tmpdir(), "cedarloom-import-"));
  writeFileSync(join(root, ".gitconfig"), "[user]\n\tname = Ada\n\temail = ada@example.org\n");
  Object.assign(process.env, { HOME: root, XDG_CONFIG_HOME: root });
  state = join(root, "state");
  server = await serve(state, errors, { fetch: exported(root) });
  ({ context, page } = await openPage(browser, errors));
});

test.afterAll(async () => {
  await context.close();
  await server.close();
  for (const [name, value] of Object.entries(homes)) {
    if (value === undefined) Reflect.deleteProperty(process.env, name);
    else process.env[name] = value;
  }
});

test("an import shows every command and agent task, a bidirectional control escaped, before anything is stored, is offered again only after a new review once the store moved, imports on the user's word, and then offers nothing; the view passes axe", async () => {
  await page.goto(server.url);
  await page.getByRole("navigation", { name: "Views" }).getByRole("button", { name: "Import" }).click();
  const main = page.getByRole("main");
  await main.getByRole("textbox", { name: "Git URL of the export" }).fill("https://example.org/team/flows.git");
  await main.getByRole("textbox", { name: "Branch or tag" }).fill("v1");
  await main.getByRole("button", { name: "Review" }).click();
  // The review takes the focus, so a screen reader reads it first.
  await expect(main.getByRole("heading", { level: 3 })).toBeFocused();
  await expect(main.getByRole("row").filter({ hasText: /^w/ })).toHaveCount(1);
  // The override shows as its escape, so the line reads as the command that runs.
  for (const line of ["pnpm lint", "pnpm test", "Review the changes and list findings.", "echo \\u202eexe.txt"]) {
    await expect(main.getByRole("listitem").filter({ hasText: line })).toHaveCount(1);
  }
  await accessible(page);
  // The store moves on before Import: the plan shown no longer applies, so the review leaves with its Import.
  store(state, "elsewhere");
  await main.getByRole("button", { name: "Import", exact: true }).click();
  await expect(main.getByRole("status")).toBeFocused();
  await expect(main.getByRole("button", { name: "Import", exact: true })).toHaveCount(0);
  await main.getByRole("button", { name: "Review" }).click();
  await main.getByRole("button", { name: "Import", exact: true }).click();
  await expect(main.getByRole("status")).toBeFocused();
  await main.getByRole("button", { name: "Review" }).click();
  await expect(main.getByRole("heading", { level: 3 })).toBeFocused();
  // Stored as it is now: no plan, so nothing to approve.
  await expect(main.getByRole("button", { name: "Import", exact: true })).toHaveCount(0);
  await accessible(page);
  // The browser logs the refused apply's 409 itself; nothing else may reach the console.
  expect(errors.filter((text) => !/status of 409/.test(text))).toEqual([]);
});
