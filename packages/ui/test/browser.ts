import { join } from "node:path";
import { AxeBuilder } from "@axe-core/playwright";
import { type Browser, type BrowserContext, expect, type Page, type ViewportSize } from "@playwright/test";
import { type Started, startServer } from "@cedarloom/server";

type Options = Parameters<typeof startServer>[0];

/**
 * A server on `state` that serves the built UI, with a config folder, a Claude Code home and a user home of its own
 * beside it; its errors land in `errors`.
 */
export const serve = (state: string, errors: string[], options: Partial<Options> = {}): Promise<Started> =>
  startServer({
    state,
    config: join(state, "..", "config"),
    machine: { home: join(state, "..", ".claude"), user: join(state, "..") },
    logs: { claude: join(state, "..", ".claude"), codex: join(state, "..", ".codex"), cache: null, history: null },
    ui: join(import.meta.dirname, "..", "dist"),
    log: (text) => errors.push(text),
    ...options,
  });

/** A page of a context the test made (axe needs one), whose console errors, a CSP violation included, land in `errors`. */
export const openPage = async (
  browser: Browser,
  errors: string[],
  viewport?: ViewportSize,
): Promise<{ context: BrowserContext; page: Page }> => {
  const context = await browser.newContext(viewport === undefined ? {} : { viewport });
  const page = await context.newPage();
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return { context, page };
};

/** No axe violation on the page as it stands, once its transitions have ended: colors in mid-fade are no measure. */
export const accessible = async (page: Page): Promise<void> => {
  // A running animation that never ends (a loader) is no transition, so it is not waited for.
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every(
        (animation) =>
          animation.playState !== "running" ||
          animation.effect?.getComputedTiming().endTime === Number.POSITIVE_INFINITY,
      ),
  );
  const axe = new AxeBuilder({ page });
  // shortcut: Firefox of Playwright 1.65.0 crashes on this rule (microsoft/playwright#43967), drop with the next release.
  if (page.context().browser()?.browserType().name() === "firefox") axe.disableRules(["aria-prohibited-attr"]);
  const { violations } = await axe.analyze();
  expect(
    violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target).join(" ")}`),
  ).toEqual([]);
};
