import { inspect } from "node:util";
import { Refusal, type Result, RunsEvent } from "@cedarloom/contracts";
import * as useCases from "@cedarloom/use-cases";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { summaryOf } from "./routes.ts";

type Options = { state: string; every: number; log: (text: string) => void };
type Message = { event: string; data: unknown };

// The apply runs and the graph runs, from one read of each.
const readRuns = (state: string): Result<RunsEvent> => {
  const runs = useCases.listRuns(state);
  if (!runs.ok) return runs;
  const graphRuns = useCases.listGraphRuns(state);
  return graphRuns.ok
    ? { ok: true, value: { runs: runs.value, graphRuns: graphRuns.value.map(summaryOf) } }
    : graphRuns;
};

// The event when the runs, or the findings why they cannot be read, changed since the last call.
// shortcut: a change sends all runs (527 KB at 2,000), a tick reads every graph run (115 ms at 2,000); page it by then.
const changes = (state: string): (() => Message | undefined) => {
  let last = "";
  return () => {
    const runs = readRuns(state);
    const [event, data] = runs.ok ? ["runs", runs.value] : ["refusal", { findings: [runs.finding] }];
    const text = JSON.stringify(data);
    if (text === last) return undefined;
    last = text;
    return { event, data: event === "runs" ? RunsEvent.parse(data) : Refusal.parse(data) };
  };
};

// One stream per tab, the store read every `every` ms; unreadable at connect it is a 500, later it ends the stream.
export const eventRoutes: FastifyPluginAsyncZod<Options> = async (app, { state, every, log }) => {
  app.get(
    "/api/events",
    {
      sse: { kind: "only" },
      // A HEAD would open a stream that never ends.
      exposeHeadRoute: false,
      schema: {
        description:
          "text/event-stream: `runs` events with RunsEvent (apply and graph runs), `refusal` events with Refusal",
      },
    },
    async (_req, reply) => {
      const next = changes(state);
      // Before the stream opens, so a throw reaches the error handler.
      const first = next();
      reply.sse.keepAlive();
      reply.header("cache-control", "no-store");
      let sending = false;
      const send = async (message: Message | undefined): Promise<void> => {
        if (message === undefined || !reply.sse.isConnected) return;
        sending = true;
        await reply.sse.send(message).finally(() => (sending = false));
      };
      const tick = async (read: () => Message | undefined): Promise<void> => {
        // A client that stops reading gets no queue: the next tick after it catches up sends the newest runs.
        if (sending) return;
        try {
          await send(read());
        } catch (error) {
          log(`The event stream stopped: ${inspect(error)}\n`);
          clearInterval(timer);
          reply.sse.close();
        }
      };
      // The close handler is in place before the first send can wait on a slow client.
      const timer = setInterval(() => void tick(next), every);
      reply.sse.onClose(() => clearInterval(timer));
      await tick(() => first);
    },
  );
};
