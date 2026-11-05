import { Refusal, Run } from "@cedarloom/contracts";
import * as services from "@cedarloom/services";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

/** The events a tab's stream carries: the runs as they stand whenever they change, or why they cannot be read. */
const RunsEvent = z.strictObject({ runs: z.array(Run) });

/**
 * GET /api/events: one stream per tab. The run store is read every `every` ms, and a `runs` event goes out when the
 * runs differ from the last one sent (the first right away), so a run another process starts or ends shows up live.
 */
export const eventRoutes: FastifyPluginAsyncZod<{ state: string; every: number }> = async (app, { state, every }) => {
  app.get(
    "/api/events",
    {
      sse: { kind: "only" },
      schema: { description: "text/event-stream: `runs` events with RunsEvent, `refusal` events with Refusal" },
    },
    async (_req, reply) => {
      reply.sse.keepAlive();
      let last = "";
      const tick = async (): Promise<void> => {
        const runs = services.listRuns(state);
        const [event, data] = runs.ok ? ["runs", { runs: runs.value }] : ["refusal", { findings: [runs.finding] }];
        const text = JSON.stringify(data);
        if (text === last || !reply.sse.isConnected) return;
        last = text;
        await reply.sse.send({ event, data: event === "runs" ? RunsEvent.parse(data) : Refusal.parse(data) });
      };
      await tick();
      const timer = setInterval(() => void tick(), every);
      reply.sse.onClose(() => clearInterval(timer));
    },
  );
};
