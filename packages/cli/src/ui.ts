import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as useCases from "@cedarloom/use-cases";
import { type Context, EXIT, emit, report } from "./output.ts";

/**
 * Serves the local API and the web UI on 127.0.0.1 until the program is stopped; prints the one-time link. The receiver
 * of the interactive homes' telemetry runs meanwhile, on the registry's port; another program on it only costs those
 * token counts, with a warning.
 */
export const ui = async (ctx: Context): Promise<number> => {
  const { startServer, TOKEN_MS } = await import("@cedarloom/server");
  // The installed @cedarloom/ui's build; in a workspace checkout after `pnpm --filter @cedarloom/ui build`.
  const dist = join(dirname(fileURLToPath(import.meta.resolve("@cedarloom/ui/package.json"))), "dist");
  const server = await startServer({ state: ctx.state, ui: dist, log: ctx.io.err });
  const telemetry = await useCases.startTelemetry(ctx.state, { port: useCases.telemetryPort(ctx.config) });
  const findings = telemetry.ok ? [] : [telemetry.finding];
  emit(
    ctx,
    "ui",
    { url: server.url, telemetry: telemetry.ok ? telemetry.value.endpoint : null, findings },
    `Open ${server.url}\nThe link works once, within ${TOKEN_MS / 60_000} minutes. Stop with Ctrl+C.`,
  );
  report(ctx, findings);
  await ctx.io.untilStopped();
  await server.close();
  if (telemetry.ok) await telemetry.value.close();
  return EXIT.ok;
};
