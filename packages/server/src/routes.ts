import {
  type Finding,
  Finding as FindingSchema,
  Refusal,
  Run,
  RunResult,
  Sha256,
  Step,
  UndoPreview,
} from "@cedarloom/contracts";
import * as services from "@cedarloom/services";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { cookieName, portOf, type Session } from "./session.ts";

const Problem = z.strictObject({ error: z.string() });
const RunPath = z.strictObject({ runId: z.string() });

const status = (finding: Finding): 404 | 409 => (finding.code === "run.not-found" ? 404 : 409);
const refusal = (finding: Finding): { findings: Finding[] } => ({ findings: [finding] });

/** POST /api/session: the URL token, once, for the session cookie and the CSRF token. */
export const sessionRoutes: FastifyPluginAsyncZod<{ session: Session }> = async (app, { session }) => {
  app.post(
    "/api/session",
    {
      schema: {
        body: z.strictObject({ token: z.string() }),
        response: { 200: z.strictObject({ csrf: z.string() }), 401: Problem },
      },
    },
    async (req, reply) => {
      const granted = session.exchange(req.body.token);
      if (granted === null) return reply.code(401).send({ error: "token" });
      reply.header(
        "set-cookie",
        `${cookieName(portOf(app.server))}=${granted.cookie}; HttpOnly; SameSite=Strict; Path=/`,
      );
      return { csrf: granted.csrf };
    },
  );
};

// shortcut: the services are synchronous, so an apply or a busy store (up to 1 s) holds the event loop; move them to a
// worker once a second request has to be answered meanwhile (the SSE run view).

/** The runs, one run with its steps, and the doctor's findings; reads never write. */
export const runRoutes: FastifyPluginAsyncZod<{ state: string }> = async (app, { state }) => {
  const RunDetail = z.strictObject({ run: Run, steps: z.array(Step) });
  app.get(
    "/api/runs",
    { schema: { response: { 200: z.strictObject({ runs: z.array(Run) }), 409: Refusal } } },
    async (_req, reply) => {
      const runs = services.listRuns(state);
      return runs.ok ? { runs: runs.value } : reply.code(409).send(refusal(runs.finding));
    },
  );
  app.get(
    "/api/runs/:runId",
    { schema: { params: RunPath, response: { 200: RunDetail, 404: Refusal, 409: Refusal } } },
    async (req, reply) => {
      const shown = services.showRun(state, req.params.runId);
      return shown.ok ? shown.value : reply.code(status(shown.finding)).send(refusal(shown.finding));
    },
  );
  app.get(
    "/api/doctor",
    { schema: { response: { 200: z.strictObject({ findings: z.array(FindingSchema) }) } } },
    async () => ({
      findings: services.doctor(state),
    }),
  );
};

/** The undo of a run: its preview, and the undo run applied only with the hash of the preview the user approved. */
export const undoRoutes: FastifyPluginAsyncZod<{ state: string }> = async (app, { state }) => {
  app.get(
    "/api/runs/:runId/undo",
    { schema: { params: RunPath, response: { 200: UndoPreview, 404: Refusal, 409: Refusal } } },
    async (req, reply) => {
      const preview = services.previewUndo(state, req.params.runId);
      return preview.ok ? preview.value : reply.code(status(preview.finding)).send(refusal(preview.finding));
    },
  );
  app.post(
    "/api/runs/:runId/undo",
    {
      schema: {
        params: RunPath,
        body: z.strictObject({ approve: Sha256.describe("The planHash of the undo preview the user approved") }),
        response: { 200: RunResult, 404: Refusal, 409: Refusal },
      },
    },
    async (req, reply) => {
      const undone = services.undoRun(state, req.params.runId, { approve: req.body.approve });
      return undone.ok ? undone.value : reply.code(status(undone.finding)).send(refusal(undone.finding));
    },
  );
};
