import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { accessible, openPage, serve } from "./browser.ts";

const errors: string[] = [];

// The sessions package's fixtures: two recorded Claude Code sessions (shop and lab) and three built Codex rollouts of
// shop (a root with its subagent, a fork of it, and another provider's session).
const fixtures = join(import.meta.dirname, "..", "..", "sessions", "test", "fixtures");

const claudeHome = (root: string): string => {
  const claude = join(root, ".claude");
  for (const [folder, id] of [
    ["-work-shop", "f828b5b9-c62e-4a8a-87f5-baef7bb31780"],
    ["-work-lab", "ea9a8a8f-8077-4156-90ab-85038e621848"],
  ] as const) {
    mkdirSync(join(claude, "projects", folder), { recursive: true });
    cpSync(join(fixtures, "claude", `${id}.jsonl`), join(claude, "projects", folder, `${id}.jsonl`));
  }
  return claude;
};

test("the board lists a period's sessions, narrows them to one project, and passes axe", async ({ browser }) => {
  const root = mkdtempSync(join(tmpdir(), "cedarloom-sessions-"));
  const state = join(root, "state");
  const history = join(state, "sessions-history.json");
  // A session whose log is gone: the history holds its figures only.
  const gone = { agent: "claude-code", id: "0b7c5e1a-0000-4000-8000-000000000001", project: "/work/gone" };
  const figures = { start: "2026-10-01T08:00:00.000Z", busyMs: 60000, tokens: 1000, costUSD: 0.5, tests: "pass" };
  mkdirSync(state, { recursive: true });
  writeFileSync(history, JSON.stringify({ version: 1, sessions: [{ ...gone, ...figures }] }));
  const logs = { claude: claudeHome(root), codex: join(fixtures, "codex"), cache: null, history };
  const server = await serve(state, errors, { logs });
  const { context, page } = await openPage(browser, errors);
  try {
    await page.goto(server.url);
    await page.getByRole("navigation", { name: "Views" }).getByRole("button", { name: "Sessions" }).click();
    const main = page.getByRole("main");
    // The fixtures are from November 2026: all time holds them whatever today is.
    await main.getByText("All time", { exact: true }).click();
    const rows = main.getByRole("table").getByRole("row");
    // A header row, the five sessions of the logs (the Codex subagent counts in its root's row) and the history's one.
    await expect(rows).toHaveCount(7);
    await accessible(page);
    await main.getByRole("button", { name: "Delete history" }).click();
    const dialog = page.getByRole("dialog", { name: "Delete the sessions history?" });
    await expect(dialog).toBeVisible();
    await accessible(page);
    await dialog.getByRole("button", { name: "Delete history" }).click();
    await expect(rows).toHaveCount(6);
    await main.getByRole("combobox", { name: "Project" }).click();
    await page.getByRole("option", { name: "/work/lab" }).click();
    await expect(rows).toHaveCount(2);
    await accessible(page);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
    await server.close();
  }
});
