import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Started } from "@cedarloom/server";
import { type BrowserContext, expect, type Page, type Route, test } from "@playwright/test";
import { accessible, openPage, serve } from "./browser.ts";

let server: Started;
let context: BrowserContext;
let page: Page;
const errors: string[] = [];

// claude-swap as its extension answers the page, in place of the real one: its active account changes only when a
// switch arrives with the user's approval.
let active = 3;
const window = (name: string, usedPercent: number) => ({
  window: name,
  usedPercent,
  resetsAt: "2026-11-12T12:00:00+00:00",
  readAt: "2026-11-07T11:08:21Z",
});
const accounts = () =>
  [
    { number: 1, alias: "work", windows: [window("fiveHour", 0), window("sevenDay", 63)] },
    { number: 2, alias: "home", windows: [window("fiveHour", 90), window("sevenDay", 48)] },
    { number: 3, alias: "spare", windows: [window("fiveHour", 45), window("sevenDay", 58)] },
  ].map((account) => ({
    ...account,
    active: account.number === active,
    disabled: false,
    held: false,
    threshold: null,
  }));
const settings = { "autoswitch.threshold": 90 };
// claude-swap here or not, and whether its menu bar service runs.
let installed = true;
let service = "Menu bar service is not installed.";
const missing = {
  findings: [
    {
      code: "extension.failed",
      params: { extension: "cedarloom.claude-swap", step: "run", error: "claude-swap is not installed" },
    },
  ],
};
const SOURCE = "https://pypi.org/project/claude-swap/0.30.0/";

// The install and the menu bar service, as the extension answers: a command first, run only with its program allowed.
const changes = async (route: Route): Promise<void> => {
  const { pathname } = new URL(route.request().url());
  if (route.request().method() === "GET") return route.fulfill({ json: { service, hint: "turn on Auto-switch" } });
  const { allow } = route.request().postDataJSON();
  if (pathname.endsWith("/auto") && allow !== true) {
    const approve = "cedarloom claude-swap auto-on --allow cswap";
    return route.fulfill({
      json: { runs: "cswap menubar --install-service", approve, hint: "it starts the menu bar" },
    });
  }
  if (pathname.endsWith("/auto")) {
    service = "Menu bar service installed (com.cswap.menubar).";
    return route.fulfill({ json: { service, hint: "turn on Auto-switch" } });
  }
  const runs = "uv tool install --no-config --default-index https://pypi.org/simple 'claude-swap[menubar]==0.30.0'";
  if (allow?.installer !== "uv" || allow.runs !== runs) {
    const approve = "cedarloom claude-swap install --allow uv";
    return route.fulfill({
      json: { installed: false, runs, approve, installer: "uv", source: SOURCE, release: "0.30.0" },
    });
  }
  installed = true;
  return route.fulfill({ json: { installed: true, version: "0.30.0" } });
};

const swap = async (route: Route): Promise<void> => {
  if (route.request().method() === "GET")
    return installed
      ? route.fulfill({ json: { accounts: accounts(), settings } })
      : route.fulfill({ status: 409, json: missing });
  const { account, allow } = route.request().postDataJSON();
  if (allow !== true) {
    const approve = `cedarloom claude-swap switch --account ${account} --allow cswap`;
    return route.fulfill({ json: { runs: `cswap switch ${account}`, approve } });
  }
  const from = active;
  active = account;
  return route.fulfill({ json: { switched: true, from, to: account } });
};

test.beforeAll(async ({ browser }) => {
  server = await serve(join(mkdtempSync(join(tmpdir(), "cedarloom-accounts-")), "state"), errors);
  ({ context, page } = await openPage(browser, errors));
  await page.route(/\/api\/accounts(\/switch)?$/, swap);
  await page.route(/\/api\/accounts\/(auto|install)$/, changes);
});

test.afterAll(async () => {
  await context.close();
  await server.close();
});

test("claude-swap's accounts show with their usage, and a switch shows claude-swap's command and runs only on the user's word; the view passes axe", async () => {
  await page.goto(server.url);
  await page.getByRole("navigation", { name: "Views" }).getByRole("button", { name: "Accounts" }).click();
  const main = page.getByRole("main");
  const row = (alias: string) => main.getByRole("row").filter({ hasText: `(${alias})` });
  await expect(row("home")).toContainText("90%");
  // The active account offers no switch.
  await expect(row("spare").getByRole("button")).toHaveCount(0);
  await accessible(page);
  await row("home").getByRole("button").click();
  await expect(main.getByText("cswap switch 2", { exact: true })).toBeVisible();
  await expect(main.getByRole("heading", { level: 3 }).first()).toBeFocused();
  expect(active).toBe(3);
  await accessible(page);
  await main.getByRole("button", { name: "Run it" }).click();
  await expect(main.getByRole("status")).toBeFocused();
  // Read again: home is claude-swap's active account now.
  await expect(row("home").getByRole("button")).toHaveCount(0);
  expect(active).toBe(2);
  expect(errors).toEqual([]);
});

test("without claude-swap the page offers its install, which shows the command, its source and release first and runs only on the user's word; auto mode's service likewise", async () => {
  installed = false;
  await page.reload();
  await page.getByRole("navigation", { name: "Views" }).getByRole("button", { name: "Accounts" }).click();
  const main = page.getByRole("main");
  await main.getByRole("button", { name: "Install claude-swap" }).click();
  await expect(main.getByText("'claude-swap[menubar]==0.30.0'", { exact: false })).toBeVisible();
  await expect(main.getByText(SOURCE, { exact: false })).toBeVisible();
  expect(installed).toBe(false);
  await accessible(page);
  await main.getByRole("button", { name: "Run it" }).click();
  await expect(main.getByRole("status")).toBeFocused();
  // Read again: claude-swap is here, with its accounts.
  await expect(main.getByRole("row").filter({ hasText: "(home)" })).toBeVisible();
  expect(installed).toBe(true);
  await main.getByRole("button", { name: "Turn auto switching on" }).click();
  await expect(main.getByText("cswap menubar --install-service", { exact: true })).toBeVisible();
  expect(service).toBe("Menu bar service is not installed.");
  await main.getByRole("button", { name: "Run it" }).click();
  await expect(main.getByText("Menu bar service installed (com.cswap.menubar).").first()).toBeVisible();
  // The browser logs the 409 that says claude-swap is missing.
  expect(errors.filter((error) => !error.includes("409"))).toEqual([]);
});
