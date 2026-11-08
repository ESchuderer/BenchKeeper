import { inspect } from "node:util";
import { Refusal, type Result, RunsEvent } from "@cedarloom/contracts";
import * as useCases from "@cedarloom/use-cases";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";

type Options = { state: string; every: number; log: (text: string) => void };
type Message = { event: string; data: unknown };

// The runs, from one read.
const readRuns = (state: string): Result<RunsEvent> => {
  const runs = useCases.listRuns(state);
  return runs.ok ? { ok: true, value: { runs: runs.value } } : runs;
};

// shortcut: a change sends all runs (527 KB at 2,000); page it then.
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

// Read every `every` ms, so a run another process starts shows live; unreadable at connect is a 500, later it ends the stream.
export const eventRoutes: FastifyPluginAsyncZod<Options> = async (app, { state, every, log }) => {
  app.get(
    "/api/events",
    {
      sse: { kind: "only" },
      // A HEAD would open a stream that never ends.
      exposeHeadRoute: false,
      schema: {
        description: "text/event-stream: `runs` events with RunsEvent (the runs), `refusal` events with Refusal",
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
