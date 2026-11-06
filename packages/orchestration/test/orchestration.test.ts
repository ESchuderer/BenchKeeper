import { join } from "node:path";
import type { AccountRegistry } from "@cedarloom/contracts";
import { deniedPaths, GITHUB_DOMAINS, ghProbe, workerEnv } from "@cedarloom/orchestration";
import { expect, test } from "vitest";

// A launcher environment with lower- and mixed-case copies of the names, which only Windows takes for the real ones.
const parent = {
  PATH: "/usr/bin",
  path: "/tmp/hostile",
  HOME: "/home/dev",
  Home: "/tmp/hostile",
  LANG: "en_US.UTF-8",
  USER: "dev",
  user: "hostile",
  ANTHROPIC_API_KEY: "k",
  GITHUB_TOKEN: "ghp_launcher",
  CLAUDE_CODE_SIMPLE: "1",
  ANTHROPIC_MODEL: "claude-other",
  TZ: undefined,
};

test("a worker's environment comes from an allowlist, with the profile's token and an empty gh folder", () => {
  const input = { parent, platform: "linux", ghToken: "github_pat_profile", ghConfigDir: "/w/gh" } as const;
  expect(workerEnv(input)).toEqual({
    PATH: "/usr/bin",
    HOME: "/home/dev",
    LANG: "en_US.UTF-8",
    GH_CONFIG_DIR: "/w/gh",
    GH_TOKEN: "github_pat_profile",
  });
  // macOS keeps USER for the keychain login; a profile without a token sets no GH_TOKEN.
  expect(workerEnv({ ...input, platform: "darwin", ghToken: null })).toEqual({
    PATH: "/usr/bin",
    HOME: "/home/dev",
    LANG: "en_US.UTF-8",
    USER: "dev",
    GH_CONFIG_DIR: "/w/gh",
  });
  // Windows names ignore case: its Path is PATH.
  expect(workerEnv({ ...input, parent: { Path: "C:\\Windows" }, platform: "win32" })).toMatchObject({
    Path: "C:\\Windows",
  });
});

const home = (...path: string[]) => join("/home/dev", ...path);

const account = (name: string) =>
  ({ name, agent: "claude", home: `/accounts/${name}`, pool: null, added: "" }) as const;

test("a worker may not read any account's home or the user's credential folders, and reaches GitHub only", () => {
  const registry: AccountRegistry = {
    schemaVersion: 1,
    minimum: { fiveHour: 8, sevenDay: 3 },
    accounts: [account("work"), account("spare")],
    pools: {},
  };
  const denied = deniedPaths(registry, "/home/dev", "/home/dev/xdg");
  expect(denied.slice(0, 2)).toEqual(["/accounts/work", "/accounts/spare"]);
  expect(denied).toEqual(
    expect.arrayContaining([
      home(".ssh"),
      home(".config", "gh"),
      home(".git-credentials"),
      home("Library", "Keychains"),
    ]),
  );
  expect(denied.at(-1)).toBe(join("/home/dev/xdg", "gh"));
  expect(deniedPaths(registry, "/home/dev", undefined)).not.toContain(join("/home/dev/xdg", "gh"));
  expect(GITHUB_DOMAINS).toEqual(["github.com", "*.github.com", "*.githubusercontent.com"]);
});

const gh = [process.execPath, join(import.meta.dirname, "fixtures", "fake-gh.ts")] as const;
const env = workerEnv({
  parent: process.env,
  platform: process.platform,
  ghToken: "github_pat_profile",
  ghConfigDir: "/w/gh",
});

test("a launch is refused while gh finds a token without GH_TOKEN, and whenever the check cannot tell", async () => {
  // The profile's own GH_TOKEN is not what the probe looks for: gh runs without it.
  await expect(ghProbe(env, gh)).resolves.toEqual({ ok: true, value: null });
  await expect(ghProbe({ ...env, FAKE_GH_TOKEN: "gho_keyring" }, gh)).resolves.toEqual({
    ok: false,
    finding: { code: "launch.gh-login", params: { error: null } },
  });
  await expect(ghProbe({ ...env, FAKE_GH_EXIT: "4" }, gh)).resolves.toEqual({
    ok: false,
    finding: { code: "launch.gh-login", params: { error: "4" } },
  });
  // No gh installed: nothing to fall back to.
  await expect(ghProbe(env, [join(import.meta.dirname, "no-such-gh")])).resolves.toEqual({ ok: true, value: null });
});

test.skipIf(process.platform === "win32")("a gh that is killed or cannot start refuses the launch too", async () => {
  const killed = ghProbe({ ...env, FAKE_GH_KILL: "1" }, gh);
  await expect(killed).resolves.toMatchObject({ finding: { params: { error: "killed" } } });
  // The fixture is no executable: spawning it fails with EACCES.
  await expect(ghProbe(env, [gh[1]])).resolves.toMatchObject({ finding: { params: { error: "EACCES" } } });
});
