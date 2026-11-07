import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CSRF_HEADER } from "@cedarloom/contracts";
import type { Started } from "@cedarloom/server";
import {
  type APIResponse,
  type BrowserContext,
  expect,
  type Locator,
  type Page,
  type Route,
  test,
} from "@playwright/test";
import { accessible as check, openPage, serve } from "./browser.ts";

// One server per file, started inside the worker: its URL token works once.
test.describe.configure({ mode: "serial" });

const corpus = join(import.meta.dirname, "..", "..", "contracts", "corpus", "WorkflowDefinition", "1");
let server: Started;
let state: string;
let context: BrowserContext;
let page: Page;
const errors: string[] = [];

test.beforeAll(async ({ browser }) => {
  state = join(mkdtempSync(join(tmpdir(), "cedarloom-editor-")), "state");
  server = await serve(state, errors);
  ({ context, page } = await openPage(browser, errors, { width: 1280, height: 1000 }));
});

test.afterAll(async () => {
  await context.close();
  await server.close();
});

const accessible = (): Promise<void> => check(page);

const card = (id: string): Locator => page.locator(`.react-flow__node[data-id="${id}"]`);
const handle = (node: string, name: string): Locator =>
  page.locator(`.react-flow__handle[data-nodeid="${node}"][data-handleid="${name}"]`);
const problems = (): Locator => page.getByRole("region", { name: "Problems" });
const view = (name: string): Promise<void> =>
  page.getByRole("navigation", { name: "Views" }).getByRole("button", { name }).click();
const selected = /\bselected\b/;
// The editor's status line; the problems panel's count, also a status, comes after it.
const said = (): Locator => page.getByRole("status").first();
const offers = (): Locator => page.getByRole("region", { name: "Unsaved drafts" });
/**
 * Waits until a searchable Select that focus opened takes keys. Mantine sets the open list's selected option in a
 * zero-delay timer; an arrow key pressed before it runs is undone by it, and Enter then picks nothing (Firefox runs
 * pending keys before timers, a few ms after the focus). A zero-delay timer queued now runs after Mantine's.
 */
const listening = async (field: Locator): Promise<void> => {
  await expect(field).toBeFocused();
  await expect(field).toHaveAttribute("aria-expanded", "true");
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)));
};

/** Sends a request of the page's own session, as another tab of it would, and returns the JSON answer. */
const request = (path: string, init: { method?: string; body?: unknown } = {}): Promise<unknown> =>
  page.evaluate(
    async ({ url, options, header }) => {
      const headers = { [header]: sessionStorage.getItem("cedarloom.csrf") ?? "", "content-type": "application/json" };
      const body = options.body === undefined ? null : JSON.stringify(options.body);
      const answer = await fetch(url, { method: options.method ?? "GET", headers, body });
      return answer.json();
    },
    { url: path, options: init, header: CSRF_HEADER },
  );

/** The ids of the drafts in the state folder. */
const stored = async (): Promise<string[]> => {
  const answer = await request("/api/drafts");
  const drafts = typeof answer === "object" && answer !== null && "drafts" in answer ? answer.drafts : [];
  return Array.isArray(drafts) ? drafts.map((draft) => String(Object(draft).id)) : [];
};

/** Where a handle is once the canvas stopped moving: fit view applies its zoom over the next frames. */
const settled = async (target: Locator): Promise<{ x: number; y: number; width: number; height: number }> => {
  let last = await target.boundingBox();
  for (let tries = 0; tries < 20; tries += 1) {
    await page.waitForTimeout(50);
    const now = await target.boundingBox();
    if (now !== null && last !== null && now.x === last.x && now.y === last.y) return now;
    last = now;
  }
  throw new Error("a handle did not settle on the canvas");
};

/** Drags from one handle to another with the mouse, as a person connects them, after fitting the graph in view. */
const connect = async (from: Locator, to: Locator): Promise<void> => {
  await page.getByRole("button", { name: "fit view" }).click();
  const [a, b] = [await settled(from), await settled(to)];
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  // A first small move starts the connection line, as a hand does; then the drop on the target handle.
  await page.mouse.move(a.x + 40, a.y + 20, { steps: 5 });
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
  await page.mouse.up();
};

test("a chunk that cannot load reloads the page, and the view opens after it", async () => {
  await page.goto(server.url);
  // The server was updated while the tab stayed open: the editor's chunk (its preload and its import) is gone, and the
  // new page finds it again.
  const chunk = /\/assets\/Editor-[^/]+\.js$/;
  await page.route(chunk, (route) => route.abort());
  const reloaded = page.waitForEvent("load");
  await view("Workflows");
  await reloaded;
  await page.unroute(chunk);
  await view("Workflows");
  await expect(card("start")).toBeVisible();
  // The browser reports the aborted load; nothing else went wrong.
  expect(errors.filter((text) => !/Editor-|ERR_FAILED|NS_ERROR|dynamically imported|import/i.test(text))).toEqual([]);
  errors.length = 0;
});

test("the Workflows view opens a new workflow with the attribution link, minimap and controls, and passes axe", async () => {
  await view("Workflows");
  await expect(page.getByRole("region", { name: "Workflow graph" })).toBeVisible();
  await expect(card("start")).toContainText("trigger.manual");
  await expect(page.getByRole("link", { name: "React Flow" })).toBeVisible();
  // The attribution link in the text color, not React Flow's light grey.
  await expect(page.getByRole("link", { name: "React Flow" })).toHaveCSS("color", "rgb(0, 0, 0)");
  await expect(page.locator(".react-flow__minimap")).toBeVisible();
  await expect(page.locator(".react-flow__controls")).toBeVisible();
  await expect(problems().getByRole("listitem")).toHaveCount(0);
  // An empty undo stack leaves focus on Undo: the button only says it is disabled.
  await page.getByRole("button", { name: "Add node" }).click();
  const undo = page.getByRole("button", { name: "Undo" });
  await undo.press("Enter");
  await expect(card("command-run-1")).toHaveCount(0);
  await expect(undo).toBeFocused();
  await expect(undo).toHaveAttribute("aria-disabled", "true");
  await accessible();
  expect(errors).toEqual([]);
});

test("added nodes connect by a drag between compatible handles only, and undo and redo walk the edits", async () => {
  await page.getByRole("button", { name: "Add node" }).click();
  await expect(card("command-run-1")).toBeVisible();
  // Nothing leads to the new node, which has no configuration yet, and command.run needs its command.
  await expect(problems().getByRole("listitem")).toHaveCount(2);
  await connect(handle("start", "start"), handle("command-run-1", "run"));
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
  await expect(problems().getByRole("listitem")).toHaveCount(1);
  await expect(problems()).toContainText("command-run-1");
  await page.getByRole("combobox", { name: "Node type" }).click();
  // The node types after 0.1.0 are not offered.
  await expect(page.getByRole("option", { name: "agent.run" })).toBeVisible();
  await expect(page.getByRole("option", { name: /^(trigger\.schedule|workflow\.run)$/ })).toHaveCount(0);
  await page.getByRole("option", { name: "agent.run" }).click();
  await page.getByRole("button", { name: "Add node" }).click();
  await expect(card("agent-run-1")).toBeVisible();
  // A number output into a string input: refused, no edge.
  await connect(handle("command-run-1", "exitCode"), handle("agent-run-1", "context"));
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(card("agent-run-1")).toHaveCount(0);
  await page.locator("body").click({ position: { x: 1, y: 1 } });
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator(".react-flow__edge")).toHaveCount(0);
  await page.getByRole("button", { name: "Redo" }).click();
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
  for (const redo of ["ControlOrMeta+Shift+z", "ControlOrMeta+y"]) {
    await page.keyboard.press("ControlOrMeta+z");
    await expect(page.locator(".react-flow__edge")).toHaveCount(0);
    await page.keyboard.press(redo);
    await expect(page.locator(".react-flow__edge")).toHaveCount(1);
  }
  // A workflow keeps one node: deleting the last one is refused, and the page says so.
  await page.getByRole("button", { name: "New workflow" }).click();
  await card("start").click();
  await page.keyboard.press("Backspace");
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(card("start")).toBeVisible();
  await accessible();
  // The next edit that applies retires the refusal.
  await page.getByRole("button", { name: "Add node" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  // Delete removes a selected node as Backspace does, and the id given out again comes unselected.
  await card("agent-run-1").click();
  await expect(card("agent-run-1")).toHaveClass(selected);
  await page.keyboard.press("Delete");
  await expect(card("agent-run-1")).toHaveCount(0);
  await page.getByRole("button", { name: "Add node" }).click();
  await expect(card("agent-run-1")).not.toHaveClass(selected);
  // The document and its history outlive a visit to another view.
  await view("Runs");
  await view("Workflows");
  await expect(card("agent-run-1")).toBeVisible();
  await expect(page.getByRole("button", { name: "Undo" })).toBeEnabled();
});

test("import reads a workflow file, export writes it back in its canonical form, and other files are refused", async () => {
  const file = join(corpus, "valid-build-and-review.json");
  await page.locator('input[type="file"]').setInputFiles(file);
  await expect(card("review")).toContainText("agent.run");
  // The input forgets the file, so the same file can be picked again.
  await expect(page.locator('input[type="file"]')).toHaveValue("");
  await expect(card("@inputs")).toContainText("focus");
  await expect(problems().getByRole("listitem")).toHaveCount(0);
  const saved = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export JSON" }).click();
  const download = await saved;
  expect(download.suggestedFilename()).toBe("build-and-review.json");
  expect(await readFile(await download.path(), "utf8")).toBe(readFileSync(file, "utf8"));
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: "x.json", mimeType: "application/json", buffer: Buffer.from("{") });
  await expect(page.getByRole("alert")).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles(join(corpus, "invalid-string-version.json"));
  await expect(page.getByRole("alert")).toContainText("schemaVersion");
  await page.locator('input[type="file"]').setInputFiles(join(corpus, "invalid-unknown-execution-key.json"));
  await expect(page.getByRole("alert")).toContainText("execution.parallel");
  // The workflow stays as it was.
  await expect(card("review")).toBeVisible();
  await accessible();
  expect(errors).toEqual([]);
});

test("New and Import start the canvas over: nothing stays selected, and the new graph is fitted in view", async () => {
  await page.getByRole("button", { name: "New workflow" }).click();
  await card("start").click();
  await expect(card("start")).toHaveClass(selected);
  // A new workflow's one node is fitted at the highest zoom. The imported row of eight is wider than the canvas at
  // that zoom, so all of it is in view only when the canvas fits it anew.
  await page.locator('input[type="file"]').setInputFiles(join(corpus, "valid-condition-and-join.json"));
  for (const id of ["@inputs", "ask", "build", "fix", "gate", "merge", "notes", "start"]) {
    await expect(card(id)).toBeInViewport();
  }
  await expect(card("start")).not.toHaveClass(selected);
  await card("start").click();
  await expect(card("start")).toHaveClass(selected);
  await page.getByRole("button", { name: "New workflow" }).click();
  await expect(card("start")).not.toHaveClass(selected);
});

test("handles connect from the keyboard: a dialog lists the outputs and the inputs that can take them", async () => {
  await page.getByRole("button", { name: "New workflow" }).click();
  await page.getByRole("combobox", { name: "Node type" }).click();
  await page.getByRole("option", { name: "command.run" }).click();
  const opener = page.getByRole("button", { name: "Connect handles" });
  const dialog = page.getByRole("dialog", { name: "Connect two handles" });
  // The trigger alone: no input can take its output, the To field says so, and Escape returns to the opener.
  await opener.press("Enter");
  await listening(dialog.getByRole("combobox", { name: "From output" }));
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(dialog.getByRole("combobox", { name: "To input" })).toHaveAccessibleDescription(
    "No input can take this output.",
  );
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  await page.getByRole("button", { name: "Add node" }).click();
  await opener.focus();
  await page.keyboard.press("Enter");
  await listening(dialog.getByRole("combobox", { name: "From output" }));
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(dialog.getByRole("combobox", { name: "From output" })).toHaveValue("start · start (control)");
  await page.keyboard.press("Tab");
  await listening(dialog.getByRole("combobox", { name: "To input" }));
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(dialog.getByRole("combobox", { name: "To input" })).toHaveValue("command-run-1 · run (control)");
  await accessible();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
  await expect(said()).not.toBeEmpty();
  await expect(opener).toBeFocused();
});

const worker = /\/assets\/elk-worker\.min-[^/]+\.js$/;

/** Answers the layout worker's script (not the small module that only names it) through `answer`. */
const routeWorker = async (answer: (route: Route, response: APIResponse) => Promise<void>): Promise<void> => {
  await context.route(worker, async (route) => {
    const response = await route.fetch();
    return (await response.body()).length < 1000 ? route.fulfill({ response }) : answer(route, response);
  });
};

test("a layout worker that cannot load ends with the alert, and the next Auto layout starts anew", async () => {
  await routeWorker((route) => route.fulfill({ status: 404, body: "" }));
  await page.locator('input[type="file"]').setInputFiles(join(corpus, "valid-condition-and-join.json"));
  const button = page.getByRole("button", { name: "Auto layout" });
  await button.click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(button).toBeEnabled();
  await context.unroute(worker);
});

test("a layout that ends after New is dropped, not applied to the new workflow", async () => {
  // The worker loads slowly, so the layout of the imported workflow ends after the New below.
  await routeWorker(async (route, response) => {
    await delay(1500);
    await route.fulfill({ response });
  });
  const button = page.getByRole("button", { name: "Auto layout" });
  await button.click();
  await expect(button).toBeDisabled();
  await page.getByRole("button", { name: "New workflow" }).click();
  await expect(button).toBeEnabled({ timeout: 10_000 });
  await context.unroute(worker);
  const saved = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export JSON" }).click();
  const exported: { layout: unknown } = JSON.parse(await readFile(await (await saved).path(), "utf8"));
  expect(exported.layout).toEqual({ nodes: { start: { x: 0, y: 0 } } });
  await expect(said()).toBeEmpty();
});

test("auto layout runs ELK in a worker and moves only positions in one undo step; the next change clears its status", async () => {
  await page.locator('input[type="file"]').setInputFiles(join(corpus, "valid-condition-and-join.json"));
  await expect(card("merge")).toBeVisible();
  const exported = async (): Promise<string> => {
    const saved = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export JSON" }).click();
    return readFile(await (await saved).path(), "utf8");
  };
  const before = await exported();
  const button = page.getByRole("button", { name: "Auto layout" });
  await button.press("Enter");
  await expect(said()).not.toBeEmpty();
  // The button keeps the keyboard focus through its busy time.
  await expect(button).toBeFocused();
  // Laid out again, nothing moves and no undo step is added: one undo below brings back the import.
  await button.press("Enter");
  // The same sentence again is a new node in the status line, so a screen reader reads it again.
  const shown = await said().locator("span").elementHandle();
  await button.press("Enter");
  await expect.poll(() => shown?.evaluate((node) => node.isConnected)).toBe(false);
  await expect(said()).not.toBeEmpty();
  const after: { nodes: unknown; edges: unknown; layout: { nodes: Record<string, { x: number }> } } = JSON.parse(
    await exported(),
  );
  const original: typeof after = JSON.parse(before);
  expect([after.nodes, after.edges]).toEqual([original.nodes, original.edges]);
  expect(Object.keys(after.layout.nodes).toSorted()).toEqual([
    "ask",
    "build",
    "fix",
    "gate",
    "merge",
    "notes",
    "start",
  ]);
  expect(after.layout.nodes["start"]?.x).toBeLessThan(after.layout.nodes["notes"]?.x ?? 0);
  await page.getByRole("button", { name: "Undo" }).click();
  // The next change of the document ends the status of the one before.
  await expect(said()).toBeEmpty();
  expect(await exported()).toBe(before);
  await accessible();
  expect(errors).toEqual([]);
});

test("elkjs's license and copyright notices ship with the page and its chunk, and the editor links them", async () => {
  const notice = await page.request.get(new URL("/licenses/elkjs.txt", server.url).href);
  expect([notice.status(), await notice.text()]).toEqual([
    200,
    expect.stringContaining("Eclipse Public License - v 2.0"),
  ]);
  expect(await notice.text()).toContain("https://github.com/kieler/elkjs/tree/0.12.1");
  // The copyright notices of elkjs's source ship in the notice file and in the bundled chunk (EPL-2.0, 3.3).
  const copyright = "Copyright (c) 2017 Kiel University and others.";
  expect(await notice.text()).toContain(copyright);
  const chunk = await page.evaluate(
    () => performance.getEntriesByType("resource").find((entry) => entry.name.includes("/assets/elk-api-"))?.name ?? "",
  );
  expect(await (await page.request.get(chunk)).text()).toContain(copyright);
  await expect(page.getByRole("link", { name: /Layout by elkjs/ })).toHaveAttribute("href", "licenses/elkjs.txt");
  await accessible();
  expect(errors).toEqual([]);
});

test("an edit is saved as a draft; after a reload it is offered, Restore brings it back, an export removes it", async () => {
  await page.locator('input[type="file"]').setInputFiles(join(corpus, "valid-minimal.json"));
  await page.getByRole("button", { name: "Add node" }).click();
  await expect(card("command-run-1")).toBeVisible();
  await expect.poll(stored).toContain("minimal");
  // New keeps the draft of the workflow open before, as Import does.
  await page.getByRole("button", { name: "New workflow" }).click();
  await page.getByRole("button", { name: "Add node" }).click();
  await expect.poll(stored).toContain("workflow");
  expect(await stored()).toContain("minimal");
  // A reload keeps the session and starts the editor anew, with the drafts on offer.
  await page.reload();
  await view("Workflows");
  await expect(offers().getByRole("button", { name: "Restore the draft of minimal" })).toBeVisible();
  await accessible();
  await offers().getByRole("button", { name: "Restore the draft of minimal" }).press("Enter");
  await expect(card("command-run-1")).toBeVisible();
  await expect(said()).not.toBeEmpty();
  await expect(said()).toBeFocused();
  await expect(offers().getByRole("button", { name: /^Restore/ })).toHaveCount(1);
  const saved = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export JSON" }).click();
  await saved;
  await expect.poll(stored).not.toContain("minimal");
  expect(errors).toEqual([]);
});

test("a broken draft can only be discarded, and a save over a draft another tab changed says so", async () => {
  writeFileSync(join(state, "drafts", "workflow-broken.json"), "{");
  const other = {
    ...JSON.parse(readFileSync(join(corpus, "valid-minimal.json"), "utf8")),
    metadata: { id: "workflow", name: "Other", version: "1.0.0" },
  };
  await request("/api/drafts/workflow", { method: "PUT", body: { workflow: other, replaces: null } });
  await page.reload();
  await view("Workflows");
  await offers().getByRole("button", { name: "Restore the draft of broken" }).press("Enter");
  await expect(said()).not.toBeEmpty();
  await expect(said()).toBeFocused();
  await expect(offers().getByRole("button", { name: "Restore the draft of broken" })).toHaveCount(0);
  await accessible();
  await offers().getByRole("button", { name: "Discard the draft of broken" }).press("Enter");
  await expect(said()).not.toBeEmpty();
  await expect(said()).toBeFocused();
  expect(await stored()).not.toContain("broken");
  // An edit waits while a draft of its workflow is on offer; Discard then saves it.
  await page.getByRole("button", { name: "Add node" }).click();
  await expect(said()).not.toBeEmpty();
  // The held edit outlives the view, as the document does.
  await view("Runs");
  await view("Workflows");
  await offers().getByRole("button", { name: "Discard the draft of workflow" }).press("Enter");
  await expect(offers()).toHaveCount(0);
  await expect.poll(async () => JSON.stringify(await request("/api/drafts/workflow"))).toContain("command-run-1");
  // Another tab then saves its own version, and this tab saves again.
  await request("/api/drafts/workflow", { method: "PUT", body: { workflow: other, replaces: null } });
  await page.getByRole("button", { name: "Add node" }).click();
  await expect(said()).toHaveText(
    "The draft of workflow had changed in another tab or an earlier session; this tab's version replaced it.",
  );
  // Chromium reports the 409 of the broken draft's read as a failed load; nothing else went wrong.
  expect(errors.filter((text) => !text.includes("409"))).toEqual([]);
});
