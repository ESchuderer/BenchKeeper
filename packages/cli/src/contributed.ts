import { shown } from "@cedarloom/contracts";
import * as useCases from "@cedarloom/use-cases";
import type { Command } from "@commander-js/extra-typings";
import { type Context, EXIT, emit, fail } from "./output.ts";

const BUNDLED = "cedarloom.";
// An output as people read it: text as it is, anything else as JSON.
const text = (value: unknown): string => (typeof value === "string" ? value : JSON.stringify(value));

const runVerb = async (ctx: Context, id: string, action: string, allow: string[] = []): Promise<number> => {
  const ran = await useCases.runBundled(ctx, id, action, allow);
  if (!ran.ok) return fail(ctx, "extension", [ran.finding], EXIT.refused);
  const lines = Object.entries(ran.value).map(([name, value]) => `${shown(name)}: ${shown(text(value))}`);
  emit(ctx, "extension", { extension: id, action, outputs: ran.value }, lines.join("\n"));
  return EXIT.ok;
};

// The app's own extensions' verbs under their noun: `cedarloom orca status` runs `status` of `cedarloom.orca`.
export const contributedGroups = (program: Command, ctx: () => Context, done: (code: number) => void): void => {
  const { app, config } = ctx();
  const bundled = useCases.bundledExtensions(app, config);
  // An unreadable folder of the app's own extensions adds no verbs; the doctor and extensions list name it.
  for (const { id, manifest } of bundled.ok ? bundled.value : []) {
    const [name, verbs] = [id.slice(BUNDLED.length), manifest.contributes.commands ?? []];
    if (verbs.length === 0 || program.commands.some((command) => command.name() === name)) continue;
    const noun = program.command(name).description(manifest.description ?? manifest.name);
    for (const verb of verbs) {
      const title = manifest.contributes.actions[verb]?.title ?? verb;
      noun
        .command(verb)
        .description(title)
        .option("--allow <program...>", "let the action run a program it names, which it never runs unnamed")
        .action(async ({ allow }) => done(await runVerb(ctx(), id, verb, allow)));
    }
  }
};
