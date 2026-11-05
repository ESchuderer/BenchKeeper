import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AxeBuilder } from "@axe-core/playwright";
import { type Started, startServer } from "@cedarloom/server";
import { applyPlan } from "@cedarloom/services";
import { type BrowserContext, expect, type Page, test } from "@playwright/test";

// One server per file, started inside the worker: its URL token works once.
test.describe.configure({ mode: "serial" });

let server: Started;
let context: BrowserContext;
let page: Page;
let file = "";
const errors: string[] = [];

test.beforeAll(async ({ browser }) => {
  const state = join(mkdtempSync(join(tmpdir(), "cedarloom-ui-")), "state");
  file = join(state, "..", "notes.md");
  applyPlan(
    state,
    { schemaVersion: 1, operations: [{ kind: "write", path: file, before: null, content: "hi\n" }] },
    { yes: true },
  );
  server = await startServer({ state, ui: join(import.meta.dirname, "..", "dist"), log: (text) => errors.push(text) });
  // axe needs a page of a context the test made.
  context = await browser.newContext();
  page = await context.newPage();
  // A CSP violation or a failed request shows up here.
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
});

test.afterAll(async () => {
  await context.close();
  await server.close();
});

const accessible = async (): Promise<void> => {
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(
    violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target).join(" ")}`),
  ).toEqual([]);
};

test("the printed link opens the shell, leaves the address bar without its token, and survives a reload", async () => {
  await page.goto(server.url);
  await expect(page.getByRole("heading", { level: 1, name: "CedarLoom" })).toBeVisible();
  expect(page.url()).toBe(`${new URL(server.url).origin}/`);
  await expect(page.getByRole("table", { name: "Runs, newest first" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("table", { name: "Runs, newest first" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("every view is reachable from the navigation and passes axe", async () => {
  const nav = page.getByRole("navigation", { name: "Views" });
  for (const view of ["Sessions", "Accounts", "Memory", "Work items", "Usage", "Runs"]) {
    await nav.getByRole("button", { name: view }).click();
    await expect(page.getByRole("heading", { level: 2, name: view })).toBeVisible();
    await expect(nav.getByRole("button", { name: view })).toHaveAttribute("aria-current", "page");
    await accessible();
  }
});

test("a run's undo shows its plan and applies only that plan, announced in a status region", async () => {
  await page.getByRole("table", { name: "Runs, newest first" }).getByRole("button").first().click();
  await expect(page.getByText("Undoing it changes 1 file.")).toBeVisible();
  await accessible();
  await page.getByRole("button", { name: "Undo run" }).click();
  await expect(page.getByRole("status")).toHaveText(/^The undo ran as run [0-9a-f-]{36}\.$/);
  await expect(page.getByText("Nothing to undo.")).toBeVisible();
  expect([existsSync(file), errors]).toEqual([false, []]);
});

test("a tab without a session says how to get one", async ({ browser }) => {
  const fresh = await browser.newPage();
  await fresh.goto(`${new URL(server.url).origin}/`);
  await expect(fresh.getByRole("alert")).toHaveText(/Open the link the server printed/);
  await fresh.close();
});
