import type { Keyring } from "@cedarloom/use-cases";

// Loaded on first use, so a platform without the native binary refuses only the commands that need the store.
const entry = async (name: string) => {
  const { AsyncEntry } = await import("@napi-rs/keyring");
  // Linux is held to the Secret Service: the kernel keyring it falls back to forgets its keys at reboot.
  return new AsyncEntry("cedarloom", name, { linux: { store: "secret-service" } });
};

/** The OS credential store (Keychain, Credential Manager, Secret Service) under the service `cedarloom`. */
export const osKeyring: Keyring = {
  get: async (name) => (await entry(name)).getPassword(),
  set: async (name, value) => (await entry(name)).setPassword(value),
};
