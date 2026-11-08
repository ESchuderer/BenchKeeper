import type { Finding } from "@cedarloom/contracts";
import { t } from "./i18n.ts";
import { describe } from "./workflow/problems.ts";

type Fetched<T> = { data: T; error?: never; response: Response } | { data?: never; error: unknown; response: Response };

// A finding as the server's typed answer carries it; read without zod, which this chunk does not load (the page's CSP
// refuses the code zod would generate).
const isFinding = (each: unknown): each is Finding =>
  typeof each === "object" && each !== null && "code" in each && typeof each.code === "string" && "params" in each;

// A refusal's findings, or those of a run that did not apply.
const findingsOf = (error: unknown): Finding[] => {
  const found = typeof error === "object" && error !== null && "findings" in error ? error.findings : null;
  return Array.isArray(found) ? found.filter((each) => isFinding(each)) : [];
};

/** Why the server refused: its findings as sentences, else its status. */
export const refused = (error: unknown, status: number): string => {
  const findings = findingsOf(error);
  if (findings.length === 0) return t("error.failed", { status, error: JSON.stringify(error) });
  return findings.map((finding) => describe(finding)).join(" ");
};

/**
 * The answer's data, or the sentence for the user (a lost session, a refusal's findings, an unreachable server) with
 * the codes of those findings.
 */
export const call = async <T>(
  request: () => Promise<Fetched<T>>,
): Promise<{ data: T } | { problem: string; codes: string[] }> => {
  try {
    const { data, error, response } = await request();
    if (data !== undefined) return { data };
    if (response.status === 401) return { problem: t("session.lost"), codes: [] };
    return { problem: refused(error, response.status), codes: findingsOf(error).map(({ code }) => code) };
  } catch {
    return { problem: t("error.unreachable"), codes: [] };
  }
};
