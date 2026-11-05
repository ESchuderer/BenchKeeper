import { mkdtempSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Started, startServer } from "@cedarloom/server";
import { type BrowserContext, expect, type Locator, type Page, test } from "@playwright/test";
import { accessible as check, openPage } from "./browser.ts";

// One server per file, started inside the worker: its URL token works once.
test.describe.configure({ mode: "serial" });

const corpus = join(import.meta.dirname, "..", "..", "contracts", "corpus", "WorkflowDefinition", "1");
let server: Started;
let context: BrowserContext;
let page: Page;
const errors: string[] = [];

test.beforeAll(async ({ browser }) => {
  const state = join(mkdtempSync(join(tmpdir(), "cedarloom-editor-")), "state");
  server = await startServer({ state, ui: join(import.meta.dirname, "..", "dist"), log: (text) => errors.push(text) });
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

test("the Workflows view opens a new workflow with the attribution link, minimap and controls, and passes axe", async () => {
  await page.goto(server.url);
  await view("Workflows");
  await expect(page.getByRole("region", { name: "Workflow graph" })).toBeVisible();
  await expect(card("start")).toContainText("trigger.manual");
  await expect(page.getByRole("link", { name: "React Flow" })).toBeVisible();
  // The attribution link in the text color, not React Flow's light grey.
  await expect(page.getByRole("link", { name: "React Flow" })).toHaveCSS("color", "rgb(0, 0, 0)");
  await expect(page.locator(".react-flow__minimap")).toBeVisible();
  await expect(page.locator(".react-flow__controls")).toBeVisible();
  await expect(problems().getByRole("status")).toHaveText("No problems.");
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
  await expect(problems()).toContainText("Nothing leads to node command-run-1");
  await expect(problems().getByRole("status")).toHaveText("1 problem.");
  await connect(handle("start", "start"), handle("command-run-1", "run"));
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
  await expect(problems().getByRole("status")).toHaveText("No problems.");
  await page.getByRole("combobox", { name: "Node type" }).click();
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
  await expect(page.getByRole("alert")).toContainText("keeps at least one node");
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
  await expect(problems()).toContainText("No problems.");
  const saved = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export JSON" }).click();
  const download = await saved;
  expect(download.suggestedFilename()).toBe("build-and-review.json");
  expect(await readFile(await download.path(), "utf8")).toBe(readFileSync(file, "utf8"));
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: "x.json", mimeType: "application/json", buffer: Buffer.from("{") });
  await expect(page.getByRole("alert")).toContainText("not JSON");
  await page.locator('input[type="file"]').setInputFiles(join(corpus, "invalid-string-version.json"));
  await expect(page.getByRole("alert")).toContainText("does not match the workflow schema: schemaVersion");
  await page.locator('input[type="file"]').setInputFiles(join(corpus, "invalid-unknown-execution-key.json"));
  await expect(page.getByRole("alert")).toContainText("execution.parallel");
  // The workflow stays as it was.
  await expect(card("review")).toBeVisible();
  await accessible();
  expect(errors).toEqual([]);
});

test("handles connect from the keyboard: a dialog lists the outputs and the inputs that can take them", async () => {
  await page.getByRole("button", { name: "New workflow" }).click();
  await page.getByRole("combobox", { name: "Node type" }).click();
  await page.getByRole("option", { name: "command.run" }).click();
  await page.getByRole("button", { name: "Add node" }).click();
  const opener = page.getByRole("button", { name: "Connect handles" });
  await opener.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Connect two handles" });
  await expect(dialog.getByRole("combobox", { name: "From output" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(dialog.getByRole("combobox", { name: "From output" })).toHaveValue("start · start (control)");
  await page.keyboard.press("Tab");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(dialog.getByRole("combobox", { name: "To input" })).toHaveValue("command-run-1 · run (control)");
  await accessible();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
  await expect(said()).toHaveText("Connected start · start (control) to command-run-1 · run (control).");
  await expect(opener).toBeFocused();
});

test("auto layout runs ELK in a worker, moves only positions in one undo step, and its license ships with the page", async () => {
  await page.locator('input[type="file"]').setInputFiles(join(corpus, "valid-condition-and-join.json"));
  await expect(card("merge")).toBeVisible();
  const exported = async (): Promise<string> => {
    const saved = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export JSON" }).click();
    return readFile(await (await saved).path(), "utf8");
  };
  const before = await exported();
  await page.getByRole("button", { name: "Auto layout" }).click();
  await expect(said()).toHaveText("The nodes were laid out; undo puts them back.");
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
  expect(await exported()).toBe(before);
  const notice = await page.request.get(new URL("/licenses/elkjs.txt", server.url).href);
  expect([notice.status(), await notice.text()]).toEqual([
    200,
    expect.stringContaining("Eclipse Public License - v 2.0"),
  ]);
  expect(await notice.text()).toContain("https://github.com/kieler/elkjs/tree/0.12.1");
  await expect(page.getByRole("link", { name: /Layout by elkjs/ })).toHaveAttribute("href", "licenses/elkjs.txt");
  await accessible();
  expect(errors).toEqual([]);
});
