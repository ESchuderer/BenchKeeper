import { basename } from "node:path";
import {
  type Account,
  Agent,
  type AutomationLevel,
  type ExtensionManifest,
  type Finding,
  findingInfo,
  type Plan,
  type PlanPreview,
  type Result,
  type RunResult,
  shown as printable,
} from "@cedarloom/contracts";
import * as useCases from "@cedarloom/use-cases";
import type { Approval } from "@cedarloom/use-cases";
import { graphRunShow } from "./graphs.ts";
import { type Context, EXIT, emit, fail, report, showPlan } from "./output.ts";

const loadPlan = (ctx: Context, path: string): Plan | number => {
  const plan = useCases.loadPlan(path);
  if (plan.ok) return plan.value;
  return fail(ctx, "plan", [plan.finding], plan.finding.code === "document.unreadable" ? EXIT.noInput : EXIT.data);
};

// A store the reads cannot open is reported in the format of `runs list`, for every read command.
const readFailed = (ctx: Context, finding: Finding): number =>
  fail(ctx, finding.code.startsWith("store.") ? "runs" : "run", [finding], EXIT.refused);

const HUMAN: Record<RunResult["status"], (runId: string | null) => string> = {
  applied: (runId) => `Run ${runId} applied.`,
  "nothing-to-undo": () => "Nothing to undo.",
  failed: () => "",
  refused: () => "",
};

const result = (ctx: Context, { runId, status, findings }: RunResult, data: object = {}): number => {
  emit(ctx, "run", { runId, status, findings, ...data }, HUMAN[status](runId));
  report(ctx, findings);
  return status === "applied" || status === "nothing-to-undo" ? EXIT.ok : EXIT.refused;
};

const approved = (approval: Approval): boolean => approval.yes === true || approval.approve !== undefined;

const ask = (preview: PlanPreview): string =>
  `${showPlan(preview)}\nNothing changed. Run the command again with --yes, or with --approve ${preview.planHash} to apply exactly this plan.`;

export const plansShow = (ctx: Context, path: string): number => {
  const plan = loadPlan(ctx, path);
  if (typeof plan === "number") return plan;
  const preview = useCases.previewPlan(plan);
  emit(ctx, "plan", preview, showPlan(preview));
  return EXIT.ok;
};

// Prints what is applied (not with --json), applies it as one run and reports the run with `findings` first.
const applyShown = (ctx: Context, plan: Plan, { shown, findings, data }: Shown, approval: Approval): number => {
  if (!ctx.json) ctx.io.out(`${shown}\n`);
  const run = useCases.applyPlan(ctx.state, plan, approval);
  if (!run.ok) return fail(ctx, "run", [...findings, run.finding], EXIT.refused);
  return result(ctx, { ...run.value, findings: [...findings, ...run.value.findings] }, data);
};

interface Shown {
  readonly shown: string;
  readonly findings: Finding[];
  readonly data: object;
}

export const plansApply = (ctx: Context, path: string, approval: Approval): number => {
  const plan = loadPlan(ctx, path);
  if (typeof plan === "number") return plan;
  const preview = useCases.previewPlan(plan);
  if (!approved(approval)) {
    emit(ctx, "plan", preview, ask(preview));
    return EXIT.ok;
  }
  return applyShown(ctx, plan, { shown: showPlan(preview), findings: [], data: {} }, approval);
};

export const runsList = (ctx: Context): number => {
  const runs = useCases.listRuns(ctx.state);
  const graphRuns = runs.ok ? useCases.listGraphRuns(ctx.state) : { ok: false as const, finding: runs.finding };
  if (!graphRuns.ok) return fail(ctx, "runs", [graphRuns.finding], EXIT.refused);
  const applied = runs.ok ? runs.value : [];
  // Apply runs and graph runs, newest first.
  const rows = [...applied, ...graphRuns.value.map((run) => ({ ...run, kind: "graph" }))].toSorted((a, b) =>
    b.startedAt.localeCompare(a.startedAt),
  );
  const lines = rows.map((run) => `${run.id}  ${run.kind.padEnd(5)}  ${run.status.padEnd(11)}  ${run.startedAt}`);
  emit(
    ctx,
    "runs",
    { runs: applied, graphRuns: graphRuns.value },
    lines.length > 0 ? lines.join("\n") : "No runs yet.",
  );
  return EXIT.ok;
};

// A worker run with the totals its session reported, else a graph run.
const launchShow = (ctx: Context, runId: string): number => {
  const shown = useCases.showLaunch(ctx.state, runId);
  if (!shown.ok) return graphRunShow(ctx, runId);
  const { account, verdict, startedAt, totals: t } = shown.value;
  const spent =
    t === null
      ? "  no token or cost totals reported"
      : `  ${t.inputTokens} input, ${t.outputTokens} output, ${t.cacheReadTokens} cache read and ${t.cacheCreationTokens} cache written tokens, about $${t.costUsd.toFixed(2)}`;
  emit(
    ctx,
    "run",
    { launch: shown.value },
    `Run ${runId}: worker on ${account}, ${verdict ?? "running"}, ${startedAt}\n${spent}`,
  );
  return EXIT.ok;
};

export const runsShow = (ctx: Context, runId: string): number => {
  const shown = useCases.showRun(ctx.state, runId);
  if (!shown.ok && shown.finding.code === "run.not-found") return launchShow(ctx, runId);
  if (!shown.ok) return readFailed(ctx, shown.finding);
  const { run, steps } = shown.value;
  const lines = steps.map((step) => `  ${step.state.padEnd(8)} ${step.path}`);
  emit(
    ctx,
    "run",
    { run, steps },
    [`Run ${run.id}: ${run.kind}, ${run.status}, ${run.startedAt}`, ...lines].join("\n"),
  );
  return EXIT.ok;
};

const previewUndo = (ctx: Context, runId: string): number => {
  const preview = useCases.previewUndo(ctx.state, runId);
  if (!preview.ok) return readFailed(ctx, preview.finding);
  const { value } = preview;
  emit(
    ctx,
    "plan",
    value,
    value.plan === null || value.planHash === null
      ? "Nothing to undo."
      : ask({ planHash: value.planHash, plan: value.plan }),
  );
  report(ctx, value.findings);
  return EXIT.ok;
};

export const runsUndo = (ctx: Context, runId: string, approval: Approval): number => {
  if (!approved(approval)) return previewUndo(ctx, runId);
  const show = (preview: PlanPreview): void => {
    if (!ctx.json) ctx.io.out(`${showPlan(preview)}\n`);
  };
  const undone = useCases.undoRun(ctx.state, runId, approval, show);
  return undone.ok ? result(ctx, undone.value) : fail(ctx, "run", [undone.finding], EXIT.refused);
};

export const doctor = async (ctx: Context): Promise<number> => {
  const host = { parent: ctx.io.env, platform: process.platform, status: ctx.io.authStatus };
  const logins = await useCases.checkLogins(ctx.state, ctx.config, host);
  const findings = [...useCases.doctor(ctx.state), ...(logins.ok ? logins.value : [logins.finding])];
  emit(ctx, "doctor", { findings }, findings.length > 0 ? "" : "No problems found.");
  report(ctx, findings, "out");
  return findings.some((finding) => findingInfo[finding.code].severity === "error") ? EXIT.refused : EXIT.ok;
};

// A finding before any plan, in the format of the command's result: an unreadable file exits 66, a file that is not the
// expected document 65, a rule 1.
const refused = (
  ctx: Context,
  format: "accounts" | "draft" | "extensions" | "levels" | "login" | "mode" | "plan" | "versions",
  finding: Finding,
): number => {
  const code = finding.code === "document.unreadable" ? EXIT.noInput : EXIT.data;
  return fail(ctx, format, [finding], finding.code.startsWith("document.") ? code : EXIT.refused);
};

/**
 * Shows a planned change with `note` below it and its findings, or with --yes applies it as one run; `data` joins the
 * plan's JSON, and the findings join the plan's and the run's, so every output form carries them.
 */
const change = (ctx: Context, plan: Plan, { note, data, findings }: Change, yes?: true): number => {
  const preview = useCases.previewPlan(plan);
  if (yes === true) return applyShown(ctx, plan, { shown: `${showPlan(preview)}${note}`, findings, data }, { yes });
  const human = `${showPlan(preview)}${note}\nNothing changed. Run the command again with --yes.`;
  emit(ctx, "plan", { ...preview, ...data, findings }, human);
  report(ctx, findings);
  return EXIT.ok;
};

interface Change {
  readonly note: string;
  readonly data: object;
  readonly findings: Finding[];
}

// An account's aliases, after its home in the list.
const aliases = ({ aliases: folders = [] }: Account): string =>
  folders.length > 0 ? `  (alias ${folders.join(", ")})` : "";

export const accountsList = (ctx: Context): number => {
  const loaded = useCases.loadRegistry(ctx.config);
  if (!loaded.ok) return refused(ctx, "accounts", loaded.finding);
  const registry = loaded.value;
  const confirmed = (agent: Agent, pool: string): boolean =>
    registry !== null && useCases.isConfirmed(registry, { agent, pool });
  const pool = ({ agent, pool: name }: Account): string =>
    name === null ? "-" : `${name} (${confirmed(agent, name) ? "confirmed" : "not confirmed"})`;
  const lines = (registry?.accounts ?? []).map((a) => `${a.name}  ${a.agent}  ${pool(a)}  ${a.home}${aliases(a)}`);
  const none = "No accounts yet. Add one with: cedarloom accounts add <name>";
  // The derived state, as the choice sees it: a pool whose accounts changed since its confirmation is not confirmed.
  const pools = Agent.options.flatMap((agent) =>
    Object.keys(registry?.pools[agent] ?? {}).map((name) => ({ agent, pool: name })),
  );
  emit(
    ctx,
    "accounts",
    { registry, confirmed: pools.filter((p) => confirmed(p.agent, p.pool)) },
    lines.length > 0 ? lines.join("\n") : none,
  );
  return EXIT.ok;
};

export const accountsConfirm = (ctx: Context, pool: string, { agent, yes }: { agent: Agent; yes?: true }): number => {
  const planned = useCases.planConfirm(ctx.config, { agent, pool });
  if (!planned.ok) return refused(ctx, "plan", planned.finding);
  return change(ctx, planned.value.plan, { note: "", data: {}, findings: planned.value.findings }, yes);
};

/** Shows the registration of an account with its own home, or with --yes makes it. */
export const accountsAdd = (
  ctx: Context,
  name: string,
  { agent, pool, yes }: { agent: Agent; pool?: string; yes?: true },
): number => {
  const planned = useCases.planAdd(ctx.config, ctx.state, { name, agent, pool: pool ?? null });
  if (!planned.ok) return refused(ctx, "plan", planned.finding);
  const { plan, home } = planned.value;
  const note = `\nThen log in there with: cedarloom accounts login ${name}`;
  return change(ctx, plan, { note, data: { home }, findings: [] }, yes);
};

/** Shows the move of an account into its own home, or with --yes makes it; an account there already is reported. */
export const accountsHome = (ctx: Context, name: string, { yes }: { yes?: true }): number => {
  const planned = useCases.planHome(ctx.config, ctx.state, name);
  if (!planned.ok) return refused(ctx, "plan", planned.finding);
  const { plan, home } = planned.value;
  if (plan === null) {
    emit(ctx, "home", { account: name, home }, `Account ${name} is in its own home: ${home}`);
    return EXIT.ok;
  }
  const note = `\nThen log in there with: cedarloom accounts login ${name}`;
  return change(ctx, plan, { note, data: { home }, findings: [] }, yes);
};

/** Runs the agent's own login for the account, in its own home only. */
export const accountsLogin = (ctx: Context, name: string): number => {
  const host = { parent: ctx.io.env, platform: process.platform, run: ctx.io.login };
  const login = useCases.loginAccount(ctx.config, ctx.state, name, host);
  if (!login.ok) return refused(ctx, "login", login.finding);
  emit(ctx, "login", { account: name, home: login.value.home }, `Logged in: account ${name}, in ${login.value.home}.`);
  return EXIT.ok;
};

type Pin = useCases.InstallPlan["pin"];

// What the extension may do, in plain words.
const mayDo = (capabilities: useCases.Capabilities): string[] => [
  ...(capabilities.net ?? []).map((origin) => `may send requests through CedarLoom to ${origin}`),
  ...Object.entries(capabilities.credentials ?? {}).map(
    ([id, { hosts }]) =>
      `uses your credential ${id} for ${hosts.join(", ")}; CedarLoom adds it, the extension never sees it`,
  ),
  ...(capabilities.projectRead === true ? ["reads files of your projects"] : []),
  ...(capabilities.planWrite === true ? ["proposes file changes, applied only through a plan you approve"] : []),
];

// What an install's approval consents to: the extension, where its code comes from, how far it is trusted, and what
// it may do. The publisher is the id's first part, which nothing verifies (P5 a).
const consent = (manifest: ExtensionManifest, { source, ref, digest }: Pin): string => {
  const publisher = manifest.id.slice(0, manifest.id.indexOf("."));
  const folder = source.path === undefined ? "" : `, folder ${source.path}`;
  const may = mayDo(manifest.capabilities ?? {});
  const lines = [
    `${manifest.id} ${manifest.version} (${manifest.name}) by ${publisher}, not verified; license ${manifest.license ?? "none stated"}`,
    `from ${source.git}${folder}, ${ref} at commit ${source.commit}; files ${digest}`,
    "community code: it runs only inside an OS sandbox, which this CedarLoom does not have yet, and never on native Windows",
    ...(manifest.platforms === undefined ? [] : [`made for ${manifest.platforms.join(", ")}`]),
    ...(may.length > 0 ? may : ["asks for no capabilities"]),
  ];
  return lines.map((line) => `\n  ${line}`).join("");
};

type Consent = { id: string; plan: Plan; note: string; data: object; added: useCases.Capabilities };

// Shows an extension's plan, or applies it as approved. One that enables capabilities takes --approve only, so the
// consent binds what the preview showed; --yes alone is refused.
const consented = (ctx: Context, { id, plan, note, data, added }: Consent, approval: Approval): number => {
  const preview = useCases.previewPlan(plan);
  const shown = `${showPlan(preview)}${note}`;
  const given = useCases.approvalOf(added, approval);
  if (approved(given)) return applyShown(ctx, plan, { shown, findings: [], data }, given);
  const needed = { code: "extension.consent-needed" as const, params: { extension: id } };
  if (approved(approval)) return fail(ctx, "plan", [needed], EXIT.refused);
  const how =
    Object.keys(added).length > 0
      ? `It enables what you have not approved, so only --approve ${preview.planHash} applies it.`
      : `Run the command again with --yes, or with --approve ${preview.planHash} to apply exactly this.`;
  emit(ctx, "plan", { ...preview, ...data }, `${shown}\nNothing changed. ${how}`);
  return EXIT.ok;
};

/**
 * Shows the install of the extension at a Git source with what its approval consents to, or installs it as one run:
 * with --approve when it asks for capabilities, else also with --yes. Its files are fetched and staged first, which
 * changes nothing that is in use. An add never waits for the 3 days an update does.
 */
export const extensionsAdd = async (
  ctx: Context,
  url: string,
  options: { ref?: string; path?: string } & Approval,
): Promise<number> => {
  const at = options.path === undefined ? {} : { path: options.path };
  const planned = await useCases.planInstall(ctx.state, { url, ref: options.ref ?? "HEAD", ...at }, ctx.io.fetch);
  if (!planned.ok) return refused(ctx, "plan", planned.finding);
  const { plan, manifest, pin, added } = planned.value;
  const extension = { id: manifest.id, ...pin, trust: "community" };
  const data = { extension, capabilities: manifest.capabilities ?? {} };
  return consented(ctx, { id: manifest.id, plan, note: consent(manifest, pin), data, added }, options);
};

type Planned = Extract<useCases.UpdatePlan, { kind: "planned" }>;

const indent = (lines: string[]): string[] => lines.map((line) => `  ${line}`);

// What an update changes: the version and the pin, and what it asks for beyond and short of what the user approved.
const changes = ({ manifest, pin, from, added, removed }: Planned): string => {
  const lines = [
    `${manifest.id} ${from.version} -> ${manifest.version}, ${pin.ref} at commit ${pin.source.commit} (was ${from.source.commit.slice(0, 12)}); files ${pin.digest}`,
    ...(Object.keys(added).length > 0 ? ["asks for more than you approved:", ...indent(mayDo(added))] : []),
    ...(Object.keys(removed).length > 0 ? ["no longer asks for:", ...indent(mayDo(removed))] : []),
  ];
  return lines.map((line) => `\n  ${line}`).join("");
};

// An update that is current or still waits: nothing to plan yet.
type Waiting = Extract<useCases.UpdatePlan, { kind: "waiting" }>;

// A ref that moves within every wait never offers an update: an extension that changes this often is better followed
// at a tag.
const waitingLine = (id: string, { commit, seen, offered, moved }: Waiting): string => {
  const line = `${id}: commit ${commit} was first seen here at ${seen}; the update is offered from ${offered}, 3 days later.`;
  const again =
    " Its ref moved within the wait, so the wait started again; to follow releases instead, remove it and add it again with --ref <tag>.";
  return moved ? `${line}${again}` : line;
};

const notYet = (ctx: Context, id: string, value: Exclude<useCases.UpdatePlan, Planned>): number => {
  const human = value.kind === "current" ? `${id} is up to date at commit ${value.commit}.` : waitingLine(id, value);
  emit(ctx, "update", { extension: id, ...value }, human);
  return EXIT.ok;
};

/**
 * Updates an installed extension to the commit at its ref, once this machine has seen it for 3 days: shows the plan
 * with what changes, or applies it. An update that asks for more than the user approved takes --approve only.
 */
export const extensionsUpdate = async (ctx: Context, id: string, approval: Approval): Promise<number> => {
  const planned = await useCases.planUpdate(ctx.state, id, ctx.io.fetch);
  if (!planned.ok) return refused(ctx, "plan", planned.finding);
  const { value } = planned;
  if (value.kind !== "planned") return notYet(ctx, id, value);
  const { pin, from, added, removed } = value;
  const data = { extension: { id, ...pin, trust: "community" }, from, added, removed };
  return consented(ctx, { id, plan: value.plan, note: changes(value), data, added }, approval);
};

/** Shows the removal of an installed extension, or with --yes removes it as one run; runs undo puts it back. */
export const extensionsRemove = (ctx: Context, id: string, { yes }: { yes?: true }): number => {
  const planned = useCases.planRemove(ctx.state, id);
  if (!planned.ok) return refused(ctx, "plan", planned.finding);
  const note = `\n  ${id} leaves the installed set; its files stay staged, inert, so runs undo puts it back.`;
  return change(ctx, planned.value, { note, data: { extension: id }, findings: [] }, yes);
};

// The app's own extensions with their switch, then the installed ones with their source.
const extensionLines = (own: { id: string; version: string; state: string }[], installed: useCases.Installed[]) => [
  ...own.map(({ id, version, state }) => `${id}  ${version}  bundled  ${state}`),
  ...installed.map(({ id, version, trust, source }) => {
    const folder = source.path === undefined ? "" : ` (${source.path})`;
    return `${id}  ${version}  ${trust}  ${source.git}${folder}  ${source.commit.slice(0, 12)}`;
  }),
];

export const extensionsList = (ctx: Context): number => {
  const listed = useCases.installedExtensions(ctx.state);
  if (!listed.ok) return refused(ctx, "extensions", listed.finding);
  const bundled = useCases.bundledExtensions(ctx.app, ctx.config);
  if (!bundled.ok) return refused(ctx, "extensions", bundled.finding);
  const own = bundled.value.map(({ id, manifest, state }) => ({
    id,
    version: manifest.version,
    trust: "bundled",
    state,
  }));
  const lines = extensionLines(own, listed.value);
  const none = "No extensions installed. Add one with: cedarloom extensions add <Git URL>";
  emit(ctx, "extensions", { extensions: [...own, ...listed.value] }, lines.length > 0 ? lines.join("\n") : none);
  return EXIT.ok;
};

/** Shows switching a bundled extension auto or off, or with --yes switches it as one run; runs undo takes it back. */
export const componentsSwitch = (ctx: Context, id: string, state: "auto" | "off", { yes }: { yes?: true }): number => {
  const planned = useCases.planSwitch(ctx.app, ctx.config, id, state);
  if (!planned.ok) return refused(ctx, "plan", planned.finding);
  const note = `\n  ${id} becomes ${state === "off" ? "off: it no longer starts" : "auto: it starts when it can run"}.`;
  return change(ctx, planned.value, { note, data: { component: id, state }, findings: [] }, yes);
};

// What the latest switch of running work does, by the settings' modeScope (running when unset; owner decision,
// 2026-11-06).
const switchLine = ({ switched, settings }: useCases.Mode): string | null => {
  if (switched?.level == null) return null;
  return settings?.modeScope === "until-off"
    ? `${switched.level} for all work since ${switched.at}, until cedarloom mode off`
    : `${switched.level} for the runs that were running at ${switched.at}; later runs start at their project's level`;
};

const showLevels = (ctx: Context): number => {
  const current = useCases.mode(ctx.state, ctx.config);
  if (!current.ok) return refused(ctx, "levels", current.finding);
  const { settings, switched } = current.value;
  const fallback = settings?.default ?? "supervised";
  const projects = settings?.projects ?? {};
  const own = Object.entries(projects).map(([folder, level]) => `${level.padEnd(10)}  ${folder}`);
  const line = switchLine(current.value);
  const lines = [`${fallback.padEnd(10)}  (default)`, ...own, ...(line === null ? [] : [`Switched: ${line}.`])];
  emit(ctx, "levels", { default: fallback, projects, switched }, lines.join("\n"));
  return EXIT.ok;
};

// A planned change of a config file, shown or with --yes applied, or why there is none.
const configChange = (ctx: Context, plan: Result<Plan>, yes?: true): number =>
  plan.ok ? change(ctx, plan.value, { note: "", data: {}, findings: [] }, yes) : refused(ctx, "plan", plan.finding);

/** Shows the default level and each project's own (`next` null), or plans the change `next`; --yes applies it. */
export const levelCommand = (ctx: Context, next: useCases.LevelChange | null, { yes }: { yes?: true }): number =>
  next === null ? showLevels(ctx) : configChange(ctx, useCases.planLevel(ctx.config, next), yes);

// The JSON of `cedarloom mode`: the latest switch's level and time, the default, and how long a switch lasts.
const modeData = ({ switched, settings }: useCases.Mode) => ({
  running: switched?.level ?? null,
  at: switched?.at ?? null,
  default: settings?.default ?? "supervised",
  modeScope: settings?.modeScope ?? "running",
});

const showMode = (ctx: Context): number => {
  const current = useCases.mode(ctx.state, ctx.config);
  if (!current.ok) return refused(ctx, "mode", current.finding);
  const data = modeData(current.value);
  const line = switchLine(current.value);
  const human =
    line === null
      ? `Running work follows each project's level; the default is ${data.default}.`
      : `Running at ${line}.`;
  emit(ctx, "mode", data, human);
  return EXIT.ok;
};

/** Shows the level of running work, or with a level (off: back to each project's) and --yes switches it. */
export const modeCommand = (
  ctx: Context,
  level: AutomationLevel | "off" | undefined,
  { yes }: { yes?: true },
): number => {
  if (level === undefined) return showMode(ctx);
  const settings = useCases.automationSettings(ctx.config);
  if (!settings.ok) return refused(ctx, "mode", settings.finding);
  const next = level === "off" ? null : level;
  const scope =
    settings.value?.modeScope === "until-off" ? "all work, until cedarloom mode off" : "the runs running now";
  const what = next === null ? "Running work goes back to each project's level" : `${next} for ${scope}`;
  if (yes !== true) {
    emit(
      ctx,
      "mode",
      { level: next },
      `${what}, at each run's next gate.\nNothing changed. Run the command again with --yes.`,
    );
    return EXIT.ok;
  }
  const switched = useCases.switchMode(ctx.state, next);
  if (!switched.ok) return fail(ctx, "mode", [switched.finding], EXIT.refused);
  emit(ctx, "mode", switched.value, `${what}, at each run's next gate; the switch is in the ledger.`);
  return EXIT.ok;
};

/** Shows storing a workflow's draft as a new version, or with --yes stores it as one run; runs undo takes it back. */
export const workflowsSave = (ctx: Context, id: string, { onTop, yes }: { onTop?: true; yes?: true }): number => {
  const planned = useCases.planSave(ctx.state, id, { onTop: onTop === true });
  if (!planned.ok) return refused(ctx, "plan", planned.finding);
  const { plan, version, stored } = planned.value;
  const note = `\n  ${id} ${stored ?? "(new)"} -> ${version} in the workflow store`;
  return change(ctx, plan, { note, data: { workflow: id, version, stored }, findings: [] }, yes);
};

export const workflowsHistory = (ctx: Context, id: string): number => {
  const history = useCases.storeHistory(ctx.state, id);
  if (!history.ok) return refused(ctx, "versions", history.finding);
  const lines = history.value.map(({ commit, version, savedAt, author }) => {
    return `${commit.slice(0, 12)}  ${version ?? "?"}  ${savedAt}  ${printable(author)}`;
  });
  const none = `No stored version of ${id}. Store its draft with: cedarloom workflows save ${id}`;
  emit(ctx, "versions", { workflow: id, versions: history.value }, lines.length > 0 ? lines.join("\n") : none);
  return EXIT.ok;
};

export const workflowsOpen = (ctx: Context, id: string, { at }: { at?: string }): number => {
  const opened = useCases.openVersion(ctx.state, id, at);
  if (!opened.ok) return refused(ctx, "draft", opened.finding);
  emit(ctx, "draft", { ...opened.value }, `Opened the stored ${id} as its draft.`);
  return EXIT.ok;
};

type ExportOptions = { name?: string; license?: string; yes?: true };

/**
 * Shows writing stored workflows into an export folder, with the lock of the extensions they use, or with --yes writes
 * them as one run; the user commits and pushes the folder with their own Git (P4 a).
 */
export const workflowsExport = (ctx: Context, ids: string[], folder: string, options: ExportOptions): number => {
  const { name = basename(folder), license, yes } = options;
  const about = license === undefined ? { name } : { name, license };
  const planned = useCases.planExport(ctx.state, ids, folder, about);
  if (!planned.ok) return refused(ctx, "plan", planned.finding);
  const { plan, extensions } = planned.value;
  const note = `\n  ${ids.join(", ")} with the lock of ${extensions.length} extensions; commit and push ${folder} yourself.`;
  return change(ctx, plan, { note, data: { folder, workflows: ids, extensions }, findings: [] }, yes);
};

/** Shows the profile's plan for this machine, or with --yes applies it as one run. */
export const profilesApply = (ctx: Context, { yes }: { yes?: true }): number => {
  const profile = useCases.planProfile(ctx.config, ctx.state, useCases.claudeHome(ctx.io.env));
  if (!profile.ok) return refused(ctx, "plan", profile.finding);
  const { plan, findings } = profile.value;
  if (findings.some((finding) => findingInfo[finding.code].severity === "error")) {
    return fail(ctx, "plan", findings, EXIT.refused);
  }
  if (plan === null) {
    emit(
      ctx,
      "plan",
      { planHash: null, plan: null, findings },
      "Nothing to change in this machine's rules and settings.",
    );
    report(ctx, findings);
    return EXIT.ok;
  }
  return change(ctx, plan, { note: "", data: {}, findings }, yes);
};

/** Shows a change of this machine's profile selection, or with --yes makes it as one run. */
export const profilesChoose = (ctx: Context, choice: useCases.Choice, { yes }: { yes?: true }): number =>
  configChange(ctx, useCases.planChoice(ctx.config, choice), yes);
