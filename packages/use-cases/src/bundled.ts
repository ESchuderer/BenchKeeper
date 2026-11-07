import { readdirSync } from "node:fs";
import { join } from "node:path";
import {
  type Finding,
  COMPONENTS_SCHEMA_VERSION,
  Components,
  EXTENSION_SCHEMA_VERSION,
  ExtensionManifest,
  formatComponents,
  PLAN_SCHEMA_VERSION,
  type Plan,
  type Result,
  readDocument,
  type Switch,
} from "@cedarloom/contracts";
import { errorCode } from "@cedarloom/engine";
import { startExtension, type Trust } from "@cedarloom/extension-host";
import { sha256 } from "@cedarloom/ledger";
import { installedExtensions, MANIFEST } from "./extensions.ts";
import { readJson, readOptionalJson } from "./use-cases.ts";
const componentsPath = (config: string): string => join(config, "components.json");
const NONE: Components = { schemaVersion: COMPONENTS_SCHEMA_VERSION, kind: "cedarloom.components", components: {} };

const readComponents = (config: string): Result<{ text: string | null; components: Components }> => {
  const file = readOptionalJson(componentsPath(config));
  if (!file.ok || file.value === null) return file.ok ? { ok: true, value: { text: null, components: NONE } } : file;
  const read = readDocument(Components, COMPONENTS_SCHEMA_VERSION, file.value.json);
  return read.ok ? { ok: true, value: { text: file.value.text, components: read.value } } : read;
};

const manifestAt = (folder: string): Result<ExtensionManifest> => {
  const file = readJson(join(folder, MANIFEST));
  return file.ok ? readDocument(ExtensionManifest, EXTENSION_SCHEMA_VERSION, file.value.json) : file;
};

/** An extension the app ships: its id, its manifest, its folder in the app and its switch. */
export type Bundled = { id: string; manifest: ExtensionManifest; folder: string; state: Switch };

const folders = (app: string): string[] => {
  try {
    return readdirSync(app, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? [entry.name] : []));
  } catch (error) {
    if (errorCode(error) === "ENOENT") return [];
    throw error;
  }
};

/**
 * The extensions the app ships in its folder `app`, one per folder with its manifest, and the switch of each from the
 * components map in `config` (`auto` when unlisted). Their trust is `bundled` because of where they are: the app's own
 * folder, which the release signs. None is installed, and none asks for consent.
 */
export const bundledExtensions = (app: string, config: string): Result<Bundled[]> => {
  const switches = readComponents(config);
  if (!switches.ok) return switches;
  const found: Bundled[] = [];
  for (const name of folders(app)) {
    const folder = join(app, name);
    const manifest = manifestAt(folder);
    if (!manifest.ok) return manifest;
    const { id } = manifest.value;
    // The release's layout, <app>/<id>/, of the cedarloom publisher only, so no app folder can hide an installed id.
    if (id !== name || !id.startsWith("cedarloom.")) {
      return { ok: false, finding: { code: "document.invalid", params: { issues: [{ path: "id", code: "custom" }] } } };
    }
    found.push({ id, manifest: manifest.value, folder, state: switches.value.components.components[id] ?? "auto" });
  }
  return { ok: true, value: found };
};

/** Plans switching the bundled extension `id` to `state` in the components map: one run, which runs undo takes back. */
export const planSwitch = (app: string, config: string, id: string, state: Switch): Result<Plan> => {
  const bundled = bundledExtensions(app, config);
  if (!bundled.ok) return bundled;
  if (!bundled.value.some((each) => each.id === id)) {
    return { ok: false, finding: { code: "extension.unknown", params: { extension: id } } };
  }
  const read = readComponents(config);
  if (!read.ok) return read;
  const { text, components } = read.value;
  const content = formatComponents({ ...components, components: { ...components.components, [id]: state } });
  // The hash of the text read here, so a change made since is found at apply, not written over.
  const before = text === null ? null : sha256(text);
  const write = { kind: "write" as const, path: componentsPath(config), before, content };
  return { ok: true, value: { schemaVersion: PLAN_SCHEMA_VERSION, operations: [write] } };
};

/** Where an extension starts from, and the trust that follows from there. */
export type Startable = { manifest: ExtensionManifest; folder: string; trust: Trust };

/**
 * The extension `id` as it would start: the app's own when the app ships it (refused while switched off), else the one
 * installed in the state folder, a community extension. Trust comes from where its files are, never from its manifest,
 * so a copy of a bundled extension in the state folder is a community extension.
 */
export const extensionToStart = (
  paths: { state: string; app: string; config: string },
  id: string,
): Result<Startable> => {
  const bundled = bundledExtensions(paths.app, paths.config);
  if (!bundled.ok) return bundled;
  const own = bundled.value.find((each) => each.id === id);
  if (own?.state === "off")
    return { ok: false, finding: { code: "extension.refused", params: { extension: id, reason: "off" } } };
  if (own !== undefined) return { ok: true, value: { manifest: own.manifest, folder: own.folder, trust: "bundled" } };
  const installed = installedExtensions(paths.state);
  if (!installed.ok) return installed;
  const pin = installed.value.find((each) => each.id === id);
  if (pin === undefined) return { ok: false, finding: { code: "extension.unknown", params: { extension: id } } };
  const folder = join(paths.state, "extensions", id, pin.digest);
  const manifest = manifestAt(folder);
  return manifest.ok ? { ok: true, value: { manifest: manifest.value, folder, trust: "community" } } : manifest;
};

/**
 * The doctor's checks of the app's own extensions: each one switched on that names checks is started through
 * extensionToStart, asked once (doctor/run, within the host's limit) and stopped, so no extension outlives the doctor.
 * Their texts are in English, the CLI's language for now.
 */
export const extensionChecks = async (paths: { state: string; app: string; config: string }): Promise<Finding[]> => {
  const bundled = bundledExtensions(paths.app, paths.config);
  if (!bundled.ok) return [bundled.finding];
  const findings: Finding[] = [];
  for (const { id } of bundled.value.filter(
    (each) => each.state !== "off" && each.manifest.contributes.doctor !== undefined,
  )) {
    const startable = extensionToStart(paths, id);
    const started = startable.ok ? await startExtension({ ...startable.value, locale: "en" }) : startable;
    if (!started.ok) {
      findings.push(started.finding);
      continue;
    }
    findings.push(...(await started.value.doctor()));
    await started.value.stop();
  }
  return findings;
};
