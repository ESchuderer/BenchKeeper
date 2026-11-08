import type { Command } from "@commander-js/extra-typings";
import { HUB_ISSUES, storeHubToken } from "@cedarloom/use-cases";
import { type Context, EXIT, emit, fail } from "./output.ts";

// Never prints the token, not even in part.
const storeToken = async (ctx: Context): Promise<number> => {
  const { name } = HUB_ISSUES;
  const token = await ctx.io.stdin();
  if (token === null) return fail(ctx, "secret", [{ code: "secret.no-input", params: { name } }], EXIT.usage);
  const stored = await storeHubToken(token, ctx.io.keyring);
  if (!stored.ok) return fail(ctx, "secret", [stored.finding], EXIT.refused);
  emit(ctx, "secret", { name }, `Stored the ${name} token in the OS credential store.`);
  return EXIT.ok;
};

/** The work-items commands: the hub-issues token CedarLoom's own calls on hub issues use (A37). */
export const workItemsGroup = (program: Command, ctx: () => Context, done: (code: number) => void): void => {
  program
    .command("work-items")
    .description("hub issues as work items")
    .command("token")
    .description("store the hub-issues token, piped in on standard input, in the OS credential store")
    // Its only word on the command line would be the token: commander's errors never repeat it.
    .configureOutput({
      outputError: (_, write) =>
        write("error: work-items token takes no arguments or options: pipe the token in on standard input\n"),
    })
    .action(async () => done(await storeToken(ctx())));
};
