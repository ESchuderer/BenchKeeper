import { HUB_ISSUES, type Keyring, readSecret, storeHubToken } from "@cedarloom/use-cases";
import { expect, test } from "vitest";

// A keyring in memory; never the OS store, so no real token is read or written.
const memory = (): Keyring & { entries: Map<string, string> } => {
  const entries = new Map<string, string>();
  return {
    entries,
    get: async (name) => entries.get(name) ?? null,
    set: async (name, value) => void entries.set(name, value),
  };
};

test("the hub-issues token is stored only when fine-grained, without its line break, and read back by reference", async () => {
  const keyring = memory();
  expect(await readSecret(HUB_ISSUES, keyring)).toEqual({
    ok: false,
    finding: { code: "secret.missing", params: { name: "hub-issues" } },
  });
  for (const refused of ["ghp_classic0123456789", "github_pat_", "github_pat_two words"]) {
    expect(await storeHubToken(refused, keyring)).toEqual({
      ok: false,
      finding: { code: "secret.not-fine-grained", params: { name: "hub-issues" } },
    });
  }
  expect(keyring.entries.size).toBe(0);
  expect(await storeHubToken("github_pat_11FAKE_0123\n", keyring)).toEqual({ ok: true, value: null });
  expect(await readSecret(HUB_ISSUES, keyring)).toEqual({ ok: true, value: "github_pat_11FAKE_0123" });
});

test("a credential store that cannot be reached is a finding, for a read and for a write", async () => {
  const locked: Keyring = {
    get: () => Promise.reject(new Error("Platform secure storage failure: locked")),
    set: () => Promise.reject(new Error("Platform secure storage failure: locked")),
  };
  const finding = {
    code: "secret.unavailable",
    params: { name: "hub-issues", error: "Platform secure storage failure: locked" },
  };
  expect(await readSecret(HUB_ISSUES, locked)).toEqual({ ok: false, finding });
  expect(await storeHubToken("github_pat_11FAKE_0123", locked)).toEqual({ ok: false, finding });
});
