import { AxeBuilder } from "@axe-core/playwright";
import { type Browser, type BrowserContext, expect, type Page, type ViewportSize } from "@playwright/test";

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

/** No axe violation on the page as it stands. */
export const accessible = async (page: Page): Promise<void> => {
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(
    violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target).join(" ")}`),
  ).toEqual([]);
};
