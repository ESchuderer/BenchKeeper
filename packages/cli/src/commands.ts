import { homedir } from "node:os";
import { basename } from "node:path";
import {
  type ExtensionManifest,
  type Finding,
  type PackRef,
  severityOf,
  type Plan,
  type PlanPreview,
  type Result,
  type RunResult,
  shown as printable,
} from "@cedarloom/contracts";
import * as useCases from "@cedarloom/use-cases";
import type { Approval } from "@cedarloom/use-cases";
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
  if (!runs.ok) return fail(ctx, "runs", [runs.finding], EXIT.refused);
  const lines = runs.value.map((run) => `${run.id}  ${run.kind.padEnd(5)}  ${run.status.padEnd(11)}  ${run.startedAt}`);
  emit(ctx, "runs", { runs: runs.value }, lines.length > 0 ? lines.join("\n") : "No runs yet.");
  return EXIT.ok;
};

export const runsShow = (ctx: Context, runId: string): number => {
  const shown = useCases.showRun(ctx.state, runId);
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

// This machine's Claude Code home and the user's home.
export const machineOf = (ctx: Context) => ({ home: useCases.claudeHome(ctx.io.env), user: homedir() });

export const doctor = async (ctx: Context): Promise<number> => {
  const [own, profile] = await Promise.all([
    useCases.extensionChecks({ state: ctx.state, app: ctx.app, config: ctx.config }),
    useCases.profileDoctor(ctx.config, ctx.state, machineOf(ctx), { app: ctx.app, fetch: ctx.io.fetch }),
  ]);
  const findings = [...useCases.doctor(ctx.state), ...own, ...profile];
  emit(ctx, "doctor", { findings }, findings.length > 0 ? "" : "No problems found.");
  report(ctx, findings, "out");
  return findings.some((finding) => severityOf(finding) === "error") ? EXIT.refused : EXIT.ok;
};

// A finding before any plan, in the command's result format: an unreadable file exits 66, a wrong document 65, rules 1.
export const refused = (
  ctx: Context,
  format: "draft" | "extensions" | "intent" | "levels" | "links" | "outbox" | "plan" | "profile-diff" | "versions",
  finding: Finding,
): number => {
  const code = finding.code === "document.unreadable" ? EXIT.noInput : EXIT.data;
  return fail(ctx, format, [finding], finding.code.startsWith("document.") ? code : EXIT.refused);
};

// Shows a plan with `note`, or with --yes applies it as one run; every output form carries the findings.
export const change = (ctx: Context, plan: Plan, { note, data, findings }: Change, yes?: true): number => {
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

type Pin = useCases.InstallPlan["pin"];

// What the extension may do, in plain words.
export const mayDo = (capabilities: useCases.Capabilities): string[] => [
  ...(capabilities.net ?? []).map((origin) => `may send requests through CedarLoom to ${origin}`),
  ...Object.entries(capabilities.credentials ?? {}).map(
    ([id, { hosts }]) =>
      `uses your credential ${id} for ${hosts.join(", ")}; CedarLoom adds it, the extension never sees it`,
  ),
  ...(capabilities.projectRead === true ? ["reads files of your projects"] : []),
  ...(capabilities.planWrite === true ? ["proposes file changes, applied only through a plan you approve"] : []),
  ...Object.keys(capabilities.programs ?? {}).map((id) => `runs the program ${id} on this machine`),
];

// What an install's approval consents to; the publisher is the id's first part, which nothing verifies (P5 a).
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

// Capabilities take --approve only, so the consent binds what the preview showed; --yes alone is refused.
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

// Fetched and staged first, which changes nothing in use; capabilities take --approve; an add never waits 3 days.
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

// A ref that moves within every wait never offers an update: follow such an extension at a tag.
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

// An update waits until this machine has seen its commit 3 days; one asking for more than approved takes --approve.
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

const showLevels = (ctx: Context): number => {
  const settings = useCases.automationSettings(ctx.config);
  if (!settings.ok) return refused(ctx, "levels", settings.finding);
  const fallback = settings.value?.default ?? "supervised";
  const projects = settings.value?.projects ?? {};
  const own = Object.entries(projects).map(([folder, level]) => `${level.padEnd(10)}  ${folder}`);
  emit(ctx, "levels", { default: fallback, projects }, [`${fallback.padEnd(10)}  (default)`, ...own].join("\n"));
  return EXIT.ok;
};

// A planned change of a config file, shown or with --yes applied, or why there is none.
const configChange = (ctx: Context, plan: Result<Plan>, yes?: true): number =>
  plan.ok ? change(ctx, plan.value, { note: "", data: {}, findings: [] }, yes) : refused(ctx, "plan", plan.finding);

/** Shows the default level and each project's own (`next` null), or plans the change `next`; --yes applies it. */
export const levelCommand = (ctx: Context, next: useCases.LevelChange | null, { yes }: { yes?: true }): number =>
  next === null ? showLevels(ctx) : configChange(ctx, useCases.planLevel(ctx.config, next), yes);

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

// Writes stored workflows with their extensions' lock to a folder; the user commits and pushes it with Git (P4 a).
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
export const profilesApply = async (
  ctx: Context,
  { yes, allow = [], project, remove = [] }: { yes?: true; allow?: string[]; project?: string; remove?: string[] },
): Promise<number> => {
  const options = { allow, app: ctx.app, fetch: ctx.io.fetch, project, remove };
  const profile = await useCases.planProfile(ctx.config, ctx.state, machineOf(ctx), options);
  if (!profile.ok) return refused(ctx, "plan", profile.finding);
  const { plan, findings } = profile.value;
  if (useCases.heldBack(findings)) {
    return fail(ctx, "plan", findings, EXIT.refused);
  }
  if (plan === null) {
    emit(
      ctx,
      "plan",
      { planHash: null, plan: null, findings },
      project === undefined
        ? "Nothing to change in this machine's rules and settings."
        : "Nothing to change in this project.",
    );
    report(ctx, findings);
    return EXIT.ok;
  }
  return change(ctx, plan, { note: "", data: {}, findings }, yes);
};

/** Reports how this machine's Claude Code home, or a project, differs from the profile; exits 1 when it does. */
export const profilesCheck = async (ctx: Context, { project }: { project?: string }): Promise<number> => {
  const options = { app: ctx.app, fetch: ctx.io.fetch, project };
  const checked = await useCases.checkProfile(ctx.config, ctx.state, machineOf(ctx), options);
  if (!checked.ok) return refused(ctx, "plan", checked.finding);
  const drift = checked.value;
  const level = project === undefined ? "This machine" : "This project";
  emit(ctx, "profile-check", { findings: drift }, drift.length === 0 ? `${level} is as the profile wants it.` : "");
  report(ctx, drift, "out");
  return drift.some((finding) => severityOf(finding) !== "info") ? EXIT.refused : EXIT.ok;
};

/** Shows a change of this machine's profile selection, or with --yes makes it as one run. */
export const profilesChoose = (ctx: Context, choice: useCases.Choice, { yes }: { yes?: true }): number =>
  configChange(ctx, useCases.planChoice(ctx.config, choice), yes);

/** Shows copying a pack's profile into a file that this machine's selection then names; with --yes, does it. */
export const profilesInit = (ctx: Context, file: string, { from, yes }: { from: PackRef; yes?: true }): number =>
  configChange(ctx, useCases.planProfileCopy(ctx.config, from, file), yes);

const SIGNS = { added: "+", removed: "-", changed: "~" } as const;

/** Lists how this machine's profile differs from a pack's, by field and by part. */
export const profilesDiff = (ctx: Context, { against }: { against: PackRef }): number => {
  const diff = useCases.diffProfile(ctx.config, against);
  if (!diff.ok) return refused(ctx, "profile-diff", diff.finding);
  const lines = diff.value.map((entry) => `${SIGNS[entry.change]} ${entry.key}`);
  emit(
    ctx,
    "profile-diff",
    { changes: diff.value },
    lines.join("\n") || `The profile is the same as ${against.pack}/${against.path}.`,
  );
  return EXIT.ok;
};
