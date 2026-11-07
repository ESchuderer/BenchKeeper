import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Started } from "@cedarloom/server";
import { applyPlan, type Fetch, planChoice } from "@cedarloom/use-cases";
import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { accessible, openPage, serve } from "./browser.ts";

test.describe.configure({ mode: "serial" });

let server: Started;
let context: BrowserContext;
let page: Page;
let home = "";
const errors: string[] = [];

// Every Git source as one commit holding a skill's file, so the plan never reaches the network.
const stock: Fetch = async () => {
  const file = { path: "SKILL.md", mode: "100644" as const, sha256: "3".repeat(64), content: Buffer.from("# Skill\n") };
  return { ok: true, value: { commit: "1".repeat(40), digest: "2".repeat(64), files: [file] } };
};

test.beforeAll(async ({ browser }) => {
  const root = mkdtempSync(join(tmpdir(), "cedarloom-profile-"));
  const state = join(root, "state");
  home = join(root, ".claude");
  // The hub is named, so no missing binding holds the plan back.
  const bound = planChoice(join(root, "config"), { hub: "acme/hub" });
  if (!bound.ok) throw new Error("the hub binding was not planned");
  applyPlan(state, bound.value, { yes: true });
  server = await serve(state, errors, { fetch: stock });
  ({ context, page } = await openPage(browser, errors));
});

test.afterAll(async () => {
  await context.close();
  await server.close();
});

test("switching a part off takes its file out of this machine's plan, and the view passes axe", async () => {
  await page.goto(server.url);
  await page.getByRole("navigation", { name: "Views" }).getByRole("button", { name: "Profile" }).click();
  const main = page.getByRole("main");
  const rules = main.getByRole("switch", { name: "Global rules" });
  const line = main.getByRole("listitem").filter({ hasText: join(home, "rules", "00-global.md") });
  await expect(rules).toBeChecked();
  await expect(line).toHaveCount(1);
  const before = await main.getByRole("status").textContent();
  await accessible(page);
  // By keyboard: the focus stays on the switch through its run and the new preview.
  await rules.focus();
  await page.keyboard.press("Space");
  await expect(line).toHaveCount(0);
  await expect(rules).not.toBeChecked();
  await expect(rules).toBeFocused();
  await expect(main.getByRole("status")).not.toHaveText(before ?? "");
  await accessible(page);
  expect(errors).toEqual([]);
});
