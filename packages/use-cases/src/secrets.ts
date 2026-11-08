import type { Result } from "@cedarloom/contracts";

/** A secret by reference, never its value: `store` names an entry of the OS credential store (A37). */
export interface SecretRef {
  readonly kind: "store";
  readonly name: string;
}

/** The token of CedarLoom's own calls on hub issues: fine-grained, with Issues read and write on the hub only (H2). */
export const HUB_ISSUES: SecretRef = { kind: "store", name: "hub-issues" };

/** The OS credential store under the service `cedarloom`; a call rejects when the store cannot be reached. */
export interface Keyring {
  /** The value stored under `name`; null when there is none. */
  get(name: string): Promise<string | null>;
  set(name: string, value: string): Promise<void>;
}

const unavailable = (name: string, error: unknown): Result<never> => ({
  ok: false,
  finding: {
    code: "secret.unavailable",
    params: { name, error: error instanceof Error ? error.message : String(error) },
  },
});

/** A secret's value by its reference: `secret.missing` when nothing is stored, `secret.unavailable` without a store. */
export const readSecret = async (ref: SecretRef, keyring: Keyring): Promise<Result<string>> => {
  try {
    const value = await keyring.get(ref.name);
    if (value === null) return { ok: false, finding: { code: "secret.missing", params: { name: ref.name } } };
    return { ok: true, value };
  } catch (error) {
    return unavailable(ref.name, error);
  }
};

// The prefix of a fine-grained token; a classic one (ghp_) reaches every repository of its user.
const FINE_GRAINED = /^github_pat_\w{1,244}$/;

/** Stores the hub-issues token; trimmed, as a piped file ends in a line break. */
export const storeHubToken = async (token: string, keyring: Keyring): Promise<Result<null>> => {
  const { name } = HUB_ISSUES;
  const value = token.trim();
  if (!FINE_GRAINED.test(value)) return { ok: false, finding: { code: "secret.not-fine-grained", params: { name } } };
  try {
    await keyring.set(name, value);
    return { ok: true, value: null };
  } catch (error) {
    return unavailable(name, error);
  }
};
