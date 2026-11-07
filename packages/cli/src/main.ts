import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Agent, Commit, GitUrl, PackRef, WorkflowId } from "@cedarloom/contracts";
import { Argument, Command, CommanderError, InvalidArgumentError, Option } from "@commander-js/extra-typings";
import {
  accountsAdd,
  accountsConfirm,
  accountsHome,
  accountsList,
  accountsStatus,
  accountsLogin,
  componentsSwitch,
  doctor,
  extensionsAdd,
  extensionsList,
  extensionsRemove,
  extensionsUpdate,
  levelCommand,
  modeCommand,
  plansApply,
  plansShow,
  profilesApply,
  profilesCheck,
  profilesChoose,
  profilesDiff,
  profilesInit,
  runsList,
  runsShow,
  runsUndo,
  workflowsExport,
  workflowsHistory,
  workflowsOpen,
  workflowsSave,
} from "./commands.ts";
import { contributedGroups } from "./contributed.ts";
import { runsCancel, runsDecide, runsResume, workflowsRun } from "./graphs.ts";
import { importCommand } from "./imports.ts";
import { type Context, EXIT, type Io } from "./output.ts";
import { configDir, stateDir } from "./state.ts";
import { ui } from "./ui.ts";

type Done = (code: number) => void;

// The app's own extensions ship in the package's `extensions` folder, beside `src` (or the emitted `dist`).
const BUNDLED = fileURLToPath(new URL("../extensions", import.meta.url));
type Ctx = () => Context;

const plansGroup = (program: Command, ctx: Ctx, done: Done): void => {
  const plans = program.command("plans").description("plan files");
  plans
    .command("show")
    .description("show a plan and its hash")
    .argument("<file>")
    .action((file) => done(plansShow(ctx(), file)));
  plans
    .command("apply")
    .description("show a plan; with --yes, apply it as one run")
    .argument("<file>")
    .option("--yes", "apply the plan as computed now")
    .option("--approve <hash>", "apply only the plan with this hash, as the preview showed it")
    .action((file, options) => done(plansApply(ctx(), file, options)));
};

const PROJECT = "the project folder the run's commands run in (default: the current folder)";
const STORED = "the run's project folder, which must be the one it recorded";

// One `--input name=value`; repeated, they collect.
const input = (pair: string, inputs: Record<string, string>): Record<string, string> => {
  const at = pair.indexOf("=");
  if (at < 1) throw new InvalidArgumentError("give an input as name=value");
  return { ...inputs, [pair.slice(0, at)]: pair.slice(at + 1) };
};

// A bundled pack's profile as `pack/path`, split at the first slash.
const packProfile = (value: string): PackRef => {
  const at = value.indexOf("/");
  const ref = PackRef.safeParse({ pack: value.slice(0, at), path: value.slice(at + 1) });
  if (at < 1 || !ref.success)
    throw new InvalidArgumentError("give it as pack/path, such as cedarloom.core/profiles/default.json");
  return ref.data;
};

const workflowId = (value: string): string => {
  if (!WorkflowId.safeParse(value).success) throw new InvalidArgumentError("not a workflow id");
  return value;
};
const ID = "the workflow's id";

const storeCommands = (workflows: Command, ctx: Ctx, done: Done): void => {
  workflows
    .command("save")
    .description("show storing a workflow's draft as a new version; with --yes, store it as one run")
    .addArgument(new Argument("<id>", ID).argParser(workflowId))
    .option("--on-top", "store a draft opened from an older stored version on top of the newer one")
    .option("--yes", "store the version as computed now")
    .action((id, options) => done(workflowsSave(ctx(), id, options)));
  workflows
    .command("history")
    .description("list a workflow's stored versions, newest first")
    .addArgument(new Argument("<id>", ID).argParser(workflowId))
    .action((id) => done(workflowsHistory(ctx(), id)));
  workflows
    .command("open")
    .description("open a stored version as the workflow's draft; never over a draft")
    .addArgument(new Argument("<id>", ID).argParser(workflowId))
    .option("--at <commit>", "the version's commit from the history (default: the latest)")
    .action((id, options) => done(workflowsOpen(ctx(), id, options)));
  workflows
    .command("export")
    .description("show writing stored workflows and their extensions' lock into a folder; with --yes, write them")
    .addArgument(
      new Argument("<id...>", "the workflows' ids").argParser((id, ids?: string[]) => [...(ids ?? []), workflowId(id)]),
    )
    .requiredOption("--to <folder>", "the export folder, which you commit and push with your own Git")
    .option("--name <text>", "the export's name (default: the folder's name)")
    .option("--license <spdx>", "the license of each workflow that names none")
    .option("--yes", "write the files as computed now")
    .action((ids, { to, ...options }) => done(workflowsExport(ctx(), ids ?? [], resolve(to), options)));
};

const workflowsGroup = (program: Command, ctx: Ctx, done: Done): void => {
  const workflows = program.command("workflows").description("workflow files and the workflow store");
  storeCommands(workflows, ctx, done);
  workflows
    .command("run")
    .description("run a workflow file in this process to its end; Ctrl+C cancels it")
    .argument("<file>")
    .option("--input <name=value>", "a value for one of the workflow's inputs; repeat for more", input, {})
    .option("--project <folder>", PROJECT)
    .option("--report", "only report: the run writes nothing but its record, and its agents change no file")
    .action(async (file, options) =>
      done(
        await workflowsRun(ctx(), file, options.input, {
          project: resolve(options.project ?? "."),
          report: options.report === true,
        }),
      ),
    );
};

const importGroup = (program: Command, ctx: Ctx, done: Done): void => {
  program
    .command("import")
    .description("show what importing workflows from an export folder or a Git URL would do; with --yes, store them")
    .argument("<source>", "an export folder, or an https or ssh Git URL")
    .option("--ref <ref>", "the branch, tag or commit of a Git source (default: its default branch)")
    .option("--yes", "store the new and updated workflows; from Git only at the full commit id its review showed")
    .action(async (source, { ref, yes }, command) => {
      const git = GitUrl.safeParse(source).success;
      // A URL CedarLoom does not fetch (one with a password, say) is neither shown nor read as a folder.
      if (!git && /^[a-z][a-z0-9+.-]*:\/\//i.test(source)) {
        return command.error("error: a Git source is an https or ssh URL without a password; for a folder, use ./");
      }
      if (!git && ref !== undefined)
        return command.error("error: --ref is for a Git source; a folder is read as it is");
      // A commit names its files, so the ones stored are the ones reviewed; a branch or tag can move in between.
      if (git && yes === true && !Commit.safeParse(ref).success) {
        return command.error("error: --yes imports from Git only at a full commit id; run again with --ref <commit>");
      }
      return done(
        await importCommand(ctx(), git ? { git: source, ref: ref ?? "HEAD" } : { folder: resolve(source) }, yes),
      );
    });
};

const runsGroup = (program: Command, ctx: Ctx, done: Done): void => {
  const runs = program.command("runs").description("runs in the journal");
  runs
    .command("list")
    .description("list the runs, newest first")
    .action(() => done(runsList(ctx())));
  runs
    .command("show")
    .description("show a run and its steps, or a graph run and its attempts")
    .argument("<run>")
    .action((run) => done(runsShow(ctx(), run)));
  runs
    .command("resume")
    .description("show what resuming a graph run does; with --yes, take it over and run it to its end (Ctrl+C cancels)")
    .argument("<run>")
    .option("--project <folder>", STORED)
    .option("--yes", "resume as planned now")
    .action(async (run, options) => done(await runsResume(ctx(), run, options)));
  runs
    .command("cancel")
    .description("show what cancelling a graph run does; with --yes, its runner stops it, or this process ends it")
    .argument("<run>")
    .option("--project <folder>", STORED)
    .option("--yes", "cancel as planned now")
    .action(async (run, options) => done(await runsCancel(ctx(), run, options)));
  for (const [verb, approved] of [
    ["approve", true],
    ["reject", false],
  ] as const) {
    runs
      .command(verb)
      .description(`show what a graph run's node waits for; with --yes, ${verb} it and run the run on`)
      .argument("<run>")
      .argument("<node>")
      .option("--project <folder>", STORED)
      .option("--yes", `${verb} now`)
      .action(async (runId, node, options) => done(await runsDecide(ctx(), { runId, node, approved }, options)));
  }
  runs
    .command("undo")
    .description("show the undo plan of a run; with --yes, apply it as a run of its own")
    .argument("<run>")
    .option("--yes", "apply the undo plan as computed now")
    .option("--approve <hash>", "apply only the undo plan with this hash, as the preview showed it")
    .action((run, options) => done(runsUndo(ctx(), run, options)));
};

const accountsGroup = (program: Command, ctx: Ctx, done: Done): void => {
  const accounts = program.command("accounts").description("agent accounts: config folders and pools, no credential");
  accounts
    .command("list")
    .description("list the accounts and their pools")
    .action(async () => done(await accountsList(ctx())));
  accounts
    .command("status")
    .description(
      "show the account a new worker of each confirmed pool would start on now (leases and the worker's model aside), and its windows",
    )
    .action(async () => done(await accountsStatus(ctx())));
  accounts
    .command("pool")
    .description("account pools")
    .command("confirm")
    .description(
      "confirm that you hold and pay for every account of a pool; with --yes, new workers switch between them",
    )
    .argument("<pool>")
    .addOption(new Option("--agent <agent>", "the pool's agent").choices(Agent.options).default("claude" as const))
    .option("--move-running", "running workers move to another account of the pool at their line or limit")
    .option("--no-move-running", "running workers stay on their account (off when never set)")
    .option("--yes", "confirm as planned now")
    .action((pool, options) => done(accountsConfirm(ctx(), pool, options)));
  accounts
    .command("add")
    .description("show the registration of an account with its own home on this machine; with --yes, make it")
    .argument("<account>")
    .addOption(new Option("--agent <agent>", "the account's agent").choices(Agent.options).default("claude" as const))
    .option("--pool <pool>", "the pool it joins; none when unset")
    .option("--yes", "add as planned now")
    .action((name, options) => done(accountsAdd(ctx(), name, options)));
  accounts
    .command("home")
    .description(
      "show the move of an account into its own home on this machine; with --yes, make it, keeping the old folder as an alias",
    )
    .argument("<account>")
    .option("--yes", "move as planned now")
    .action((name, options) => done(accountsHome(ctx(), name, options)));
  accounts
    .command("login")
    .description("log an account in with the agent's own login, in its own home")
    .argument("<account>")
    .action((name) => done(accountsLogin(ctx(), name)));
};

const extensionsGroup = (program: Command, ctx: Ctx, done: Done): void => {
  const extensions = program
    .command("extensions")
    .description("extensions from Git, pinned by commit and digest; community code, run only inside an OS sandbox");
  extensions
    .command("list")
    .description("list the app's own extensions and the installed ones")
    .action(() => done(extensionsList(ctx())));
  extensions
    .command("add")
    .description("show the install of the extension at a Git URL and what it may do; with --yes, install it")
    .argument("<url>", "an https or ssh Git URL, or user@host:path")
    .option("--ref <ref>", "the branch or tag to install and later follow (default: the repository's default branch)")
    .option("--path <folder>", "the extension's folder in the repository (default: its root)")
    .option("--yes", "install as planned now")
    .option("--approve <hash>", "install only the plan with this hash, as the preview showed it")
    .action(async (url, options) => done(await extensionsAdd(ctx(), url, options)));
  extensions
    .command("update")
    .description("show the update of an installed extension to the commit at its ref; with --yes, apply it")
    .argument("<id>", "the extension's id, publisher.name")
    .option("--yes", "update as planned now, unless it asks for more than you approved")
    .option("--approve <hash>", "update only by the plan with this hash, as the preview showed it")
    .action(async (id, options) => done(await extensionsUpdate(ctx(), id, options)));
  extensions
    .command("remove")
    .description("show the removal of an installed extension; with --yes, remove it")
    .argument("<id>", "the extension's id, publisher.name")
    .option("--yes", "remove as planned now")
    .action((id, options) => done(extensionsRemove(ctx(), id, options)));
};

const componentsGroup = (program: Command, ctx: Ctx, done: Done): void => {
  program
    .command("components")
    .description("the app's own parts, each auto (on when it can run) or off")
    .command("switch")
    .description("show switching a bundled extension auto or off; with --yes, switch it as one run")
    .argument("<id>", "the extension's id, publisher.name")
    .addArgument(new Argument("<state>", "auto or off").choices(["auto", "off"] as const))
    .option("--yes", "switch it as computed now")
    .action((id, state, options) => done(componentsSwitch(ctx(), id, state, options)));
};

const modeGroup = (program: Command, ctx: Ctx, done: Done): void => {
  program
    .command("mode")
    .description("show the automation level of running work; with a level and --yes, switch it at each run's next gate")
    .addArgument(
      new Argument("[level]", "supervised, checkpoint, auto, or off for each project's level").choices([
        "supervised",
        "checkpoint",
        "auto",
        "off",
      ] as const),
    )
    .option("--yes", "switch now")
    .action((level, options) => done(modeCommand(ctx(), level, options)));
};

const LEVELS = ["supervised", "checkpoint", "auto"] as const;

const profilesGroup = (program: Command, ctx: Ctx, done: Done): void => {
  const profiles = program.command("profiles").description("this machine's CedarLoom profile");
  profiles
    .command("apply")
    .description("show the profile's plan for this machine's Claude Code home; with --yes, apply it as one run")
    .option("--project <folder>", "plan this project's level instead of the machine's")
    .option(
      "--allow <part...>",
      "include a plugin or files part, which --yes alone never does, such as machine.plugin.ponytail",
    )
    .option("--remove <item...>", "remove an item the plan offers, such as plugin:x@y; none is removed unnamed")
    .option("--yes", "apply the plan as computed now")
    .action(async (options) => done(await profilesApply(ctx(), options)));
  profiles
    .command("check")
    .description("report how this machine's Claude Code home, or a project, differs from the profile; reads only")
    .option("--project <folder>", "check this project's level instead of the machine's")
    .action(async (options) => done(await profilesCheck(ctx(), options)));
  profiles
    .command("select")
    .description("switch a part on or off, or back to its default; with --yes, save it as one run")
    .argument("<part>", "the part as level.id, such as workspace.memory")
    .addArgument(new Argument("<state>").choices(["on", "off", "default"] as const))
    .option("--yes", "save the choice as computed now")
    .action((part, state, options) =>
      done(profilesChoose(ctx(), { part, on: state === "default" ? null : state === "on" }, options)),
    );
  profiles
    .command("bind")
    .description("name this machine's hub repository or gate workflow source; with --yes, save it as one run")
    .addArgument(new Argument("<binding>").choices(["hub", "gates"] as const))
    .argument("<repository>", "the hub as owner/repo; the gates' reusable workflows as owner/repo@<commit>")
    .option("--yes", "save the binding as computed now")
    .action((binding, repository, options) =>
      done(profilesChoose(ctx(), binding === "hub" ? { hub: repository } : { gates: repository }, options)),
    );
  profileFiles(profiles, ctx, done);
};

// The commands for a profile file of the owner's: a copy of a pack's to edit, and how it differs from the pack's.
const profileFiles = (profiles: Command, ctx: Ctx, done: Done): void => {
  profiles
    .command("init")
    .description("show copying a pack's profile into a file that this machine then applies; with --yes, copy it")
    .argument("<file>", "the copy, a profile file of your own to edit")
    .requiredOption("--from <profile>", "a bundled pack's profile as pack/path", packProfile)
    .option("--yes", "copy the profile and select it as computed now")
    .action((file, options) => done(profilesInit(ctx(), file, options)));
  profiles
    .command("diff")
    .description(
      "list how this machine's profile differs from a pack's, by field and part: + added, - removed, ~ changed",
    )
    .requiredOption("--against <profile>", "a bundled pack's profile as pack/path", packProfile)
    .action((options) => done(profilesDiff(ctx(), options)));
};

const levelGroup = (program: Command, ctx: Ctx, done: Done): void => {
  program
    .command("level")
    .description("show the default automation level and each project's; with a level and --yes, set one of them")
    .addArgument(
      new Argument("[level]", "supervised, checkpoint or auto; default gives a project the default again").choices([
        ...LEVELS,
        "default",
      ] as const),
    )
    .option("--project <folder>", "set this project's level instead of the default")
    .option("--yes", "apply the change")
    .action((level, options, command) => {
      const { project } = options;
      if (level === undefined && project !== undefined) {
        return command.error("error: --project sets a project's level; name the level too, or leave --project out");
      }
      if (level === undefined) return done(levelCommand(ctx(), null, options));
      if (project !== undefined) {
        const own = level === "default" ? null : level;
        return done(levelCommand(ctx(), { project: resolve(project), level: own }, options));
      }
      if (level === "default")
        return command.error("error: only a project's level can be default; name it with --project");
      return done(levelCommand(ctx(), { project: null, level }, options));
    });
};

const GROUPS = [
  plansGroup,
  runsGroup,
  workflowsGroup,
  importGroup,
  accountsGroup,
  extensionsGroup,
  componentsGroup,
  modeGroup,
  levelGroup,
  profilesGroup,
];

/** Runs one command line (without the program name) and returns the exit code. */
export const main = async (argv: string[], io: Io): Promise<number> => {
  let exit: number = EXIT.ok;
  const done = (code: number): void => {
    exit = code;
  };
  const program = new Command("cedarloom")
    .description("Plan, apply and undo changes with a reviewable plan and a journal. Reads never write.")
    .option("--json", "print one JSON object: codes and parameters, no prose")
    .option(
      "--state <dir>",
      "state folder (default: CEDARLOOM_STATE_DIR, XDG_STATE_HOME/cedarloom, ~/.local/state/cedarloom)",
    )
    .exitOverride()
    .configureOutput({ writeOut: io.out, writeErr: io.err });
  const ctx = (): Context => {
    const { json, state } = program.opts();
    // Resolved once, so every path built from it, an own home's too, is absolute.
    const app = io.bundled ?? BUNDLED;
    return { io, json: json ?? false, state: resolve(state ?? stateDir(io.env)), config: configDir(io.env), app };
  };
  for (const group of GROUPS) group(program, ctx, done);
  program
    .command("doctor")
    .description("report interrupted runs, store problems, and each account's login in its own home")
    .action(async () => done(await doctor(ctx())));
  program
    .command("ui")
    .description("serve the web UI on 127.0.0.1 and print the link that opens it; runs until stopped")
    .action(async () => done(await ui(ctx())));
  // Last, so a noun of the app's own extensions never takes a built-in command's name.
  contributedGroups(program, ctx, done);
  try {
    await program.parseAsync(argv, { from: "user" });
  } catch (error) {
    if (error instanceof CommanderError && error.exitCode === 0) return EXIT.ok;
    const usage = error instanceof CommanderError;
    if (!usage) io.err(`internal error: ${String(error)}\n`);
    if (program.opts().json)
      io.out(
        `${JSON.stringify({ format: "cedarloom.error", schemaVersion: 1, error: usage ? "usage" : "internal" })}\n`,
      );
    return usage ? EXIT.usage : EXIT.internal;
  }
  return exit;
};
