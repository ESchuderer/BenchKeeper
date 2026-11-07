import { resolve } from "node:path";
import { Agent, WorkflowId } from "@cedarloom/contracts";
import { Argument, Command, CommanderError, InvalidArgumentError, Option } from "@commander-js/extra-typings";
import {
  accountsAdd,
  accountsConfirm,
  accountsHome,
  accountsList,
  accountsLogin,
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
  profilesChoose,
  runsList,
  runsShow,
  runsUndo,
  workflowsHistory,
  workflowsOpen,
  workflowsSave,
} from "./commands.ts";
import { runsCancel, runsResume, workflowsRun } from "./graphs.ts";
import { type Context, EXIT, type Io } from "./output.ts";
import { configDir, stateDir } from "./state.ts";
import { ui } from "./ui.ts";

type Done = (code: number) => void;
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
    .action(async (file, options) =>
      done(await workflowsRun(ctx(), file, options.input, resolve(options.project ?? "."))),
    );
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
  runs
    .command("undo")
    .description("show the undo plan of a run; with --yes, apply it as a run of its own")
    .argument("<run>")
    .option("--yes", "apply the undo plan as computed now")
    .option("--approve <hash>", "apply only the undo plan with this hash, as the preview showed it")
    .action((run, options) => done(runsUndo(ctx(), run, options)));
};

const accountsGroup = (program: Command, ctx: Ctx, done: Done): void => {
  const accounts = program
    .command("accounts")
    .description("agent accounts: config folders, pools and minimums, no credential");
  accounts
    .command("list")
    .description("list the accounts and their pools")
    .action(() => done(accountsList(ctx())));
  accounts
    .command("pool")
    .description("account pools")
    .command("confirm")
    .description(
      "confirm that you hold and pay for every account of a pool; with --yes, new workers switch between them",
    )
    .argument("<pool>")
    .addOption(new Option("--agent <agent>", "the pool's agent").choices(Agent.options).default("claude" as const))
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
    .description("list the installed extensions")
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
    .option("--yes", "apply the plan as computed now")
    .action((options) => done(profilesApply(ctx(), options)));
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
    .description("name this machine's hub repository; with --yes, save it as one run")
    .addArgument(new Argument("<binding>").choices(["hub"] as const))
    .argument("<repository>", "the repository as owner/repo")
    .option("--yes", "save the binding as computed now")
    .action((_binding, repository, options) => done(profilesChoose(ctx(), { hub: repository }, options)));
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
    return { io, json: json ?? false, state: resolve(state ?? stateDir(io.env)), config: configDir(io.env) };
  };
  plansGroup(program, ctx, done);
  runsGroup(program, ctx, done);
  workflowsGroup(program, ctx, done);
  accountsGroup(program, ctx, done);
  extensionsGroup(program, ctx, done);
  modeGroup(program, ctx, done);
  levelGroup(program, ctx, done);
  profilesGroup(program, ctx, done);
  program
    .command("doctor")
    .description("report interrupted runs, store problems, and each account's login in its own home")
    .action(async () => done(await doctor(ctx())));
  program
    .command("ui")
    .description("serve the web UI on 127.0.0.1 and print the link that opens it; runs until stopped")
    .action(async () => done(await ui(ctx())));
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
