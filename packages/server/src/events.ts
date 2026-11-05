import { inspect } from "node:util";
import { Refusal, Run } from "@cedarloom/contracts";
import * as services from "@cedarloom/services";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

/** The events a tab's stream carries: the runs as they stand whenever they change, or why they cannot be read. */
const RunsEvent = z.strictObject({ runs: z.array(Run) });

type Options = { state: string; every: number; log: (text: string) => void };

/**
 * GET /api/events: one stream per tab. The run store is read every `every` ms, and a `runs` event goes out when the
 * runs differ from the last one sent (the first right away), so a run another process starts or ends shows up live.
 * A read that throws (a store that cannot be opened) ends this stream and goes to the log; the server keeps running.
 */
export const eventRoutes: FastifyPluginAsyncZod<Options> = async (app, { state, every, log }) => {
  app.get(
    "/api/events",
    {
      sse: { kind: "only" },
      // A HEAD would open a stream that never ends.
      exposeHeadRoute: false,
      schema: { description: "text/event-stream: `runs` events with RunsEvent, `refusal` events with Refusal" },
    },
    async (_req, reply) => {
      reply.sse.keepAlive();
      reply.header("cache-control", "no-store");
      let last = "";
      const tick = async (): Promise<void> => {
        try {
          const runs = services.listRuns(state);
          const [event, data] = runs.ok ? ["runs", { runs: runs.value }] : ["refusal", { findings: [runs.finding] }];
          const text = JSON.stringify(data);
          if (text === last || !reply.sse.isConnected) return;
          last = text;
          await reply.sse.send({ event, data: event === "runs" ? RunsEvent.parse(data) : Refusal.parse(data) });
        } catch (error) {
          log(`The event stream stopped: ${inspect(error)}\n`);
          clearInterval(timer);
          reply.sse.close();
        }
      };
      // The close handler is in place before the first send can wait on a slow client.
      const timer = setInterval(() => void tick(), every);
      reply.sse.onClose(() => clearInterval(timer));
      await tick();
    },
  );
};
