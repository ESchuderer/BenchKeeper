import { Agent } from "@cedarloom/contracts";
import { Command, CommanderError, Option } from "@commander-js/extra-typings";
import {
  accountsConfirm,
  accountsImport,
  accountsList,
  doctor,
  plansApply,
  plansShow,
  runsList,
  runsShow,
  runsUndo,
} from "./commands.ts";
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

const runsGroup = (program: Command, ctx: Ctx, done: Done): void => {
  const runs = program.command("runs").description("runs in the journal");
  runs
    .command("list")
    .description("list the runs, newest first")
    .action(() => done(runsList(ctx())));
  runs
    .command("show")
    .description("show a run and its steps")
    .argument("<run>")
    .action((run) => done(runsShow(ctx(), run)));
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
    .command("import")
    .description("show the one-time import of BenchKeeper's registry; with --yes, create the registry from it")
    .option("--from <file>", "BenchKeeper's registry file (default: ~/.config/benchkeeper/accounts.json)")
    .option("--yes", "import as planned now")
    .action((options) => done(accountsImport(ctx(), options)));
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
    return { io, json: json ?? false, state: state ?? stateDir(io.env), config: configDir(io.env) };
  };
  plansGroup(program, ctx, done);
  runsGroup(program, ctx, done);
  accountsGroup(program, ctx, done);
  program
    .command("doctor")
    .description("report interrupted runs and store problems")
    .action(() => done(doctor(ctx())));
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
