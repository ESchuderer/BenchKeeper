import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Started } from "@cedarloom/server";
import { applyPlan } from "@cedarloom/use-cases";
import { type BrowserContext, expect, type Page, type Route, test } from "@playwright/test";
import { accessible as check, openPage, serve } from "./browser.ts";

// One server per file, started inside the worker: its URL token works once.
test.describe.configure({ mode: "serial" });

let server: Started;
let context: BrowserContext;
let page: Page;
let file = "";
let stateDir = "";
const errors: string[] = [];

test.beforeAll(async ({ browser }) => {
  const state = join(mkdtempSync(join(tmpdir(), "cedarloom-ui-")), "state");
  file = join(state, "..", "notes.md");
  applyPlan(
    state,
    { schemaVersion: 1, operations: [{ kind: "write", path: file, before: null, content: "hi\n" }] },
    { yes: true },
  );
  stateDir = state;
  server = await serve(state, errors, { every: 100 });
  ({ context, page } = await openPage(browser, errors));
});

test.afterAll(async () => {
  await context.close();
  await server.close();
});

const accessible = (target: Page = page): Promise<void> => check(target);

test("the printed link opens the shell, leaves the address bar without its token, and survives a reload", async () => {
  await page.goto(server.url);
  await expect(page.getByRole("heading", { level: 1, name: "CedarLoom" })).toBeVisible();
  expect(page.url()).toBe(`${new URL(server.url).origin}/`);
  await expect(page.getByRole("table", { name: "Runs, newest first", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("table", { name: "Runs, newest first", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("the header shows the CedarLoom mark beside the title, and the tab the CedarLoom icon", async () => {
  const mark = page.getByRole("banner").locator("img");
  await expect(mark).toHaveAttribute("alt", "");
  // Loaded, not refused: the CSP allows images from the page's own origin only, no data: URLs.
  await expect
    .poll(() => mark.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0))
    .toBe(true);
  const icon = (await page.locator('link[rel="icon"]').getAttribute("href")) ?? "";
  expect(icon).toMatch(/^\/assets\/cedarloom-icon-[\w-]+\.svg$/);
  const response = await page.request.get(new URL(icon, page.url()).href);
  expect(response.headers()["content-type"]).toMatch(/^image\/svg\+xml/);
  expect(errors).toEqual([]);
});

test("every view is reachable from the navigation and passes axe", async () => {
  const nav = page.getByRole("navigation", { name: "Views" });
  for (const view of ["Workflows", "Sessions", "Memory", "Work items", "Runs"]) {
    await nav.getByRole("button", { name: view }).click();
    await expect(page.getByRole("heading", { level: 2, name: view })).toBeVisible();
    await expect(nav.getByRole("button", { name: view })).toHaveAttribute("aria-current", "page");
    await accessible();
  }
});

// The licenses the CI license review allows for dependencies (.github/workflows/cedarloom.yml, allow-licenses).
const allowed = (): Set<string> => {
  const workflow = readFileSync(join(import.meta.dirname, "..", "..", "..", ".github", "workflows", "cedarloom.yml"));
  const list = /allow-licenses: >-\n((?:\s+[\w.-]+(?:,\s*[\w.-]+)*,?\n)+)/.exec(String(workflow))?.[1] ?? "";
  return new Set(list.split(",").map((id) => id.trim()));
};
// An SPDX expression one of whose alternatives has only allowed licenses.
const permitted = (expression: string, ids: Set<string>): boolean =>
  expression.split(" OR ").some((alternative) =>
    alternative
      .replaceAll(/[()]/g, "")
      .split(" AND ")
      .every((id) => ids.has(id.trim())),
  );

test("the footer links the notices of every bundled package, each with its license text and an allowed license", async () => {
  const link = page.getByRole("contentinfo").getByRole("link", { name: "Third-party licenses" });
  await expect(link).toHaveAttribute("href", "licenses/third-party.txt");
  const answer = await page.request.get(new URL("/licenses/third-party.txt", server.url).href);
  expect(answer.headers()["content-type"]).toContain("text/plain");
  const notices = await answer.text();
  const headings = [...notices.matchAll(/^## (\S+) (\S+) \((.+)\)$/gm)];
  const names = headings.map(([, name]) => name);
  expect(names).toEqual(
    expect.arrayContaining(["react", "react-dom", "@xyflow/react", "@mantine/core", "zod", "elkjs"]),
  );
  // Own code is no third-party code (it keeps the project's own license).
  expect(names.filter((name) => name?.startsWith("@cedarloom/"))).toEqual([]);
  // Every package has its license text, even one whose npm release ships none.
  expect([...notices.matchAll(/^## \S+ \S+ \(.+\)\n\n(?!## )\S/gm)]).toHaveLength(headings.length);
  const ids = allowed();
  expect(ids.has("MIT") && ids.has("EPL-2.0")).toBe(true);
  expect(headings.filter(([, , , license]) => !permitted(license ?? "", ids)).map(([heading]) => heading)).toEqual([]);
  await accessible();
});

test("a narrow window keeps the views behind a menu button, out of the keyboard's way until it opens", async () => {
  await page.setViewportSize({ width: 600, height: 800 });
  const menu = page.getByRole("button", { name: "Show the views" });
  const inNav = (): Promise<boolean> => page.evaluate(() => document.activeElement?.closest("nav") !== null);
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await expect(menu).toHaveAttribute("aria-controls", "views");
  // Closed: Tab from the title goes into the main region, past the off-screen views.
  await page.getByRole("heading", { level: 1 }).click();
  await page.keyboard.press("Tab");
  expect(await inNav()).toBe(false);
  // Open: the views take focus and the covered main region is inert.
  await menu.click();
  await expect(menu).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Tab");
  expect(await inNav()).toBe(true);
  await expect(page.getByRole("main")).toHaveAttribute("inert", "");
  await page.getByRole("navigation", { name: "Views" }).getByRole("button", { name: "Memory" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Memory" })).toBeVisible();
  await accessible();
  await page.getByRole("button", { name: "Show the views" }).click();
  await page.getByRole("navigation", { name: "Views" }).getByRole("button", { name: "Runs" }).click();
  // At exactly 768 px (the sm breakpoint) the navigation shows without a menu button, and it takes focus.
  await page.setViewportSize({ width: 768, height: 800 });
  await expect(page.getByRole("button", { name: "Show the views" })).toBeHidden();
  await expect(page.getByRole("navigation", { name: "Views" })).not.toHaveAttribute("inert");
  await page.getByRole("heading", { level: 1 }).click();
  await page.keyboard.press("Tab");
  expect(await inNav()).toBe(true);
  // At 320 px the runs table scrolls inside its container, never the page.
  await page.setViewportSize({ width: 320, height: 640 });
  await expect(page.getByRole("table", { name: "Runs, newest first", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await page.setViewportSize({ width: 1280, height: 800 });
});

test("a run's undo is reached by keyboard, applies only the previewed plan, and announces its result", async () => {
  await page.getByRole("table", { name: "Runs, newest first", exact: true }).getByRole("button").first().click();
  await expect(page.getByRole("heading", { level: 3, name: /^Run [0-9a-f-]{36}$/ })).toBeFocused();
  await expect(page.getByText("Undoing it changes 1 file.")).toBeVisible();
  await accessible();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Undo run" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toContainText(/[0-9a-f-]{36}/);
  await expect(page.getByRole("status")).toBeFocused();
  await expect(page.getByText("Nothing to undo.")).toBeVisible();
  // The undo run arrives through the event stream.
  const table = page.getByRole("table", { name: "Runs, newest first", exact: true });
  await expect(table.getByRole("cell", { name: "Undo", exact: true })).toBeVisible();
  expect([existsSync(file), errors]).toEqual([false, []]);
});

const failed = (route: Route): Promise<void> => route.fulfill({ status: 500, json: { error: "internal" } });

/** Applies a run from outside the page, as the CLI does, and waits for its row to appear without a reload. */
const appliedElsewhere = async (name: string): Promise<void> => {
  const table = page.getByRole("table", { name: "Runs, newest first", exact: true });
  await expect(table).toBeVisible();
  const rows = await table.getByRole("row").count();
  const path = join(stateDir, "..", name);
  applyPlan(
    stateDir,
    { schemaVersion: 1, operations: [{ kind: "write", path, before: null, content: "x\n" }] },
    { yes: true },
  );
  await expect(table.getByRole("row")).toHaveCount(rows + 1);
};

test("a run another process applies appears without a reload", async () => {
  await appliedElsewhere("other.md");
  expect(errors).toEqual([]);
});

test("a stream that ends opens again, also after the API failed once, and the error goes", async () => {
  // The page's next stream ends at once, as one does after a store read that failed, and the check after it fails.
  // The 500 is set up only when that stream is asked for: Firefox lets the unloading page send its own check.
  const ended = async (route: Route): Promise<void> => {
    await page.route("**/api/runs", failed, { times: 1 });
    await route.fulfill({ contentType: "text/event-stream", body: "" });
  };
  await page.route("**/api/events", ended, { times: 1 });
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("500");
  await appliedElsewhere("again.md");
  await expect(page.getByRole("alert")).toHaveCount(0);
  // The browser may log the failed request; nothing else may show up.
  expect(errors.filter((text) => !text.includes("500"))).toEqual([]);
  errors.length = 0;
});

test("a new tab without a session shows an alert, and the page passes axe", async () => {
  const fresh = await context.newPage();
  await fresh.goto(`${new URL(server.url).origin}/`);
  await expect(fresh.getByRole("alert")).toBeVisible();
  await accessible(fresh);
  await fresh.close();
});

test("a store the server cannot read any more is named in the page, live", async () => {
  const db = new DatabaseSync(join(stateDir, "runs.sqlite"));
  // A schema no CedarLoom writes yet, so the test holds when the ledger gains one.
  db.exec("PRAGMA user_version = 99");
  db.close();
  await expect(page.getByRole("alert")).toContainText("store.newer-schema");
  await accessible();
});
