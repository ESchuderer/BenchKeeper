import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { logsOf } from "./board.ts";
import { machineOf } from "./commands.ts";
import { type Context, EXIT, emit } from "./output.ts";

/** Serves the local API and the web UI on 127.0.0.1 until the program is stopped; prints the one-time link. */
export const ui = async (ctx: Context): Promise<number> => {
  const { startServer, TOKEN_MS } = await import("@cedarloom/server");
  // The installed @cedarloom/ui's build; in a workspace checkout after `pnpm --filter @cedarloom/ui build`.
  const dist = join(dirname(fileURLToPath(import.meta.resolve("@cedarloom/ui/package.json"))), "dist");
  const server = await startServer({
    state: ctx.state,
    config: ctx.config,
    machine: machineOf(ctx),
    logs: logsOf(ctx),
    app: ctx.app,
    fetch: ctx.io.fetch,
    ui: dist,
    log: ctx.io.err,
  });
  emit(
    ctx,
    "ui",
    { url: server.url },
    `Open ${server.url}\nThe link works once, within ${TOKEN_MS / 60_000} minutes. Stop with Ctrl+C.`,
  );
  await ctx.io.untilStopped();
  await server.close();
  return EXIT.ok;
};
