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
// claude-swap here or not, and whether its menu bar switches accounts.
let installed = true;
let uv = true;
let autoSwitch = false;
const missing = {
  findings: [
    {
      code: "extension.failed",
      params: { extension: "cedarloom.claude-swap", step: "run", error: "claude-swap is not installed" },
    },
  ],
};
const SOURCE = "https://pypi.org/project/claude-swap/1.0.0/";
const SERVICE = "Menu bar service: running (pid 4242)";

// Auto switching as the extension answers: claude-swap's own command first, run only with cswap allowed.
const auto = async (route: Route): Promise<void> => {
  if (route.request().method() === "GET") return route.fulfill({ json: { service: SERVICE, autoSwitch } });
  const { on, allow } = route.request().postDataJSON();
  const [runs, approve] = on
    ? ["cswap menubar --install-service --auto-switch", "cedarloom claude-swap auto-on --allow cswap"]
    : ["cswap menubar --no-auto-switch", "cedarloom claude-swap auto-off --allow cswap"];
  if (allow !== true) return route.fulfill({ json: { runs, approve } });
  autoSwitch = on;
  return route.fulfill({
    json: { service: on ? "Menu bar service installed (com.cswap.menubar)." : SERVICE, autoSwitch },
  });
};

// The install as the extension answers: uv's command first, run only with uv and that very command approved.
const install = async (route: Route): Promise<void> => {
  if (!uv) {
    const error = "uv is not installed: install uv first";
    return route.fulfill({
      status: 409,
      json: { findings: [{ ...missing.findings[0], params: { ...missing.findings[0]?.params, error } }] },
    });
  }
  const { allow } = route.request().postDataJSON();
  const runs = "uv tool install --no-config --default-index https://pypi.org/simple 'claude-swap[menubar]==1.0.0'";
  if (allow?.installer !== "uv" || allow.runs !== runs) {
    const approve = "cedarloom claude-swap install --allow uv";
    return route.fulfill({
      json: { installed: false, runs, approve, installer: "uv", source: SOURCE, release: "1.0.0" },
    });
  }
  installed = true;
  return route.fulfill({ json: { installed: true, version: "1.0.0" } });
};

// While set, an approved switch waits for it: cswap switch takes seconds.
let switching: Promise<void> | null = null;

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
  await switching;
  const from = active;
  active = account;
  return route.fulfill({ json: { switched: true, from, to: account } });
};

const row = (alias: string) =>
  page
    .getByRole("main")
    .getByRole("row")
    .filter({ hasText: `(${alias})` });

test.beforeAll(async ({ browser }) => {
  server = await serve(join(mkdtempSync(join(tmpdir(), "cedarloom-accounts-")), "state"), errors);
  ({ context, page } = await openPage(browser, errors));
  await page.route(/\/api\/accounts(\/switch)?$/, swap);
  await page.route(/\/api\/accounts\/auto$/, auto);
  await page.route(/\/api\/accounts\/install$/, install);
});

test.afterAll(async () => {
  await context.close();
  await server.close();
});

test("claude-swap's accounts show with their usage, and a switch shows claude-swap's command and runs only on the user's word; the view passes axe", async () => {
  await page.goto(server.url);
  await page.getByRole("navigation", { name: "Views" }).getByRole("button", { name: "Accounts" }).click();
  const main = page.getByRole("main");
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

test("without claude-swap the page offers its install, which shows the command, its source and release first and runs only on the user's word; auto switching likewise", async () => {
  [installed, uv] = [false, false];
  await page.reload();
  await page.getByRole("navigation", { name: "Views" }).getByRole("button", { name: "Accounts" }).click();
  const main = page.getByRole("main");
  // Without uv, the page says so instead of offering an install that cannot run.
  await expect(main.getByRole("alert")).toContainText("uv is not installed");
  await expect(main.getByRole("button", { name: "Install claude-swap" })).toHaveCount(0);
  uv = true;
  await page.reload();
  await page.getByRole("navigation", { name: "Views" }).getByRole("button", { name: "Accounts" }).click();
  await main.getByRole("button", { name: "Install claude-swap" }).click();
  await expect(main.getByText("'claude-swap[menubar]==1.0.0'", { exact: false })).toBeVisible();
  await expect(main.getByText(SOURCE, { exact: false })).toBeVisible();
  expect(installed).toBe(false);
  await accessible(page);
  await main.getByRole("button", { name: "Run it" }).click();
  await expect(main.getByRole("status")).toBeFocused();
  // Read again: claude-swap is here, with its accounts.
  await expect(main.getByRole("row").filter({ hasText: "(home)" })).toBeVisible();
  expect(installed).toBe(true);
  await main.getByRole("button", { name: "Turn auto switching on" }).click();
  await expect(main.getByText("cswap menubar --install-service --auto-switch", { exact: true })).toBeVisible();
  expect(autoSwitch).toBe(false);
  await main.getByRole("button", { name: "Run it" }).click();
  // Read again: switching is on, and the page now offers to turn it off.
  await expect(main.getByRole("button", { name: "Turn auto switching off" })).toBeVisible();
  expect(autoSwitch).toBe(true);
  // The browser logs the 409 that says claude-swap is missing.
  expect(errors.filter((error) => !error.includes("409"))).toEqual([]);
});

test("a view reopened while a switch runs reads claude-swap again once the switch ends", async () => {
  [active, installed] = [3, true];
  const release = Promise.withResolvers<void>();
  switching = release.promise;
  try {
    await page.reload();
    const views = page.getByRole("navigation", { name: "Views" });
    await views.getByRole("button", { name: "Accounts" }).click();
    const main = page.getByRole("main");
    await row("home").getByRole("button").click();
    await main.getByRole("button", { name: "Run it" }).click();
    await views.getByRole("button", { name: "Runs" }).click();
    await views.getByRole("button", { name: "Accounts" }).click();
    // The switch is still running: spare is active, and home offers its switch.
    await expect(row("home").getByRole("button")).toHaveCount(1);
    await expect(row("spare").getByRole("button")).toHaveCount(0);
  } finally {
    release.resolve();
    switching = null;
  }
  // Read again without opening the view: home is active now.
  await expect(row("home").getByRole("button")).toHaveCount(0);
  expect(active).toBe(2);
  expect(errors.filter((error) => !error.includes("409"))).toEqual([]);
});
