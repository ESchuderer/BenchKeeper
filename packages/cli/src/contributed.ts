import { type ExtensionManifest, shown } from "@cedarloom/contracts";
import * as useCases from "@cedarloom/use-cases";
import type { Command } from "@commander-js/extra-typings";
import { type Context, EXIT, emit, fail } from "./output.ts";

const BUNDLED = "cedarloom.";
// An output as people read it: text as it is, anything else as JSON.
const text = (value: unknown): string => (typeof value === "string" ? value : JSON.stringify(value));

type Given = Parameters<typeof useCases.runBundled>[3];

const runVerb = async (ctx: Context, id: string, action: string, given: Given): Promise<number> => {
  const ran = await useCases.runBundled(ctx, id, action, given);
  if (!ran.ok) return fail(ctx, "extension", [ran.finding], EXIT.refused);
  const lines = Object.entries(ran.value).map(([name, value]) => `${shown(name)}: ${shown(text(value))}`);
  emit(ctx, "extension", { extension: id, action, outputs: ran.value }, lines.join("\n"));
  return EXIT.ok;
};

type Action = ExtensionManifest["contributes"]["actions"][string];

// The CLI's own flags, which no input may take over.
const OWN_FLAGS = new Set(["allow", "json", "state"]);

// A verb under its noun: the action with `--allow`, and a flag per input of the action, by the input's own name.
const addVerb = (noun: Command, verb: string, action: Action | undefined, run: (given: Given) => Promise<void>) => {
  const inputs = Object.entries(action?.inputs ?? {}).filter(([input]) => !OWN_FLAGS.has(input));
  const command = noun
    .command(verb)
    .description(action?.title ?? verb)
    .option("--allow <program...>", "let the action run a program it names, which it never runs unnamed");
  for (const [input, { description, required }] of inputs) {
    if (required === true) command.requiredOption(`--${input} <value>`, description ?? input);
    else command.option(`--${input} <value>`, description ?? input);
  }
  command.action(async (options) => {
    const values: Record<string, unknown> = options;
    const given = inputs.flatMap(([input]) => (typeof values[input] === "string" ? [[input, values[input]]] : []));
    await run({ allow: options.allow ?? [], inputs: Object.fromEntries(given) });
  });
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
      addVerb(noun, verb, manifest.contributes.actions[verb], async (given) =>
        done(await runVerb(ctx(), id, verb, given)),
      );
    }
  }
};
