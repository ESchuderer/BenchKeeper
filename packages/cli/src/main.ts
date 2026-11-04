import { Command, CommanderError } from "@commander-js/extra-typings";
import { doctor, plansApply, plansShow, runsList, runsShow, runsUndo } from "./commands.ts";
import { type Context, EXIT, type Io } from "./output.ts";
import { stateDir } from "./state.ts";

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
    .option("--yes", "apply the plan shown")
    .action((file, options) => done(plansApply(ctx(), file, options.yes ?? false)));
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
    .option("--yes", "apply the undo plan shown")
    .action((run, options) => done(runsUndo(ctx(), run, options.yes ?? false)));
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
    return { io, json: json ?? false, state: state ?? stateDir(io.env) };
  };
  plansGroup(program, ctx, done);
  runsGroup(program, ctx, done);
  program
    .command("doctor")
    .description("report interrupted runs and store problems")
    .action(() => done(doctor(ctx())));
  try {
    await program.parseAsync(argv, { from: "user" });
  } catch (error) {
    if (error instanceof CommanderError) return error.exitCode === 0 ? EXIT.ok : EXIT.usage;
    io.err(`internal error: ${String(error)}\n`);
    return EXIT.internal;
  }
  return exit;
};
