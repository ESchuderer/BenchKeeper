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
import * as useCases from "@cedarloom/use-cases";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { cookieName, portOf, type Session } from "./session.ts";

const RunPath = z.strictObject({ runId: z.uuid() });
/** Every route can also answer 400, 401, 403, 413, 415 or 421 with an error code from the guard or the parser. */
const answers = <T extends object>(codes: T): T & { default: typeof Problem } => ({ ...codes, default: Problem });
const Problem = z.object({ error: z.string() }).describe("A request the server refused, by error code");

const status = (finding: Finding): 404 | 409 => (finding.code === "run.not-found" ? 404 : 409);
const refusal = (finding: Finding): { findings: Finding[] } => ({ findings: [finding] });

/** POST /api/session: the URL token, once, for the session cookie and the CSRF token. */
export const sessionRoutes: FastifyPluginAsyncZod<{ session: Session }> = async (app, { session }) => {
  app.post(
    "/api/session",
    {
      schema: {
        body: z.strictObject({ token: z.string().max(64) }),
        response: answers({ 200: z.strictObject({ csrf: z.string() }) }),
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

// shortcut: the use cases are synchronous, so an undo or a busy store (up to 1 s) holds the event loop, and the event
// streams' reads wait meanwhile (they are fast: the lock probe does not wait); move the use cases to a worker when undos
// get long or several tabs need answers during one.

/** The runs, one run with its steps, and the doctor's findings; reads never write. */
export const runRoutes: FastifyPluginAsyncZod<{ state: string }> = async (app, { state }) => {
  const RunDetail = z.strictObject({ run: Run, steps: z.array(Step) });
  app.get(
    "/api/runs",
    { schema: { response: answers({ 200: z.strictObject({ runs: z.array(Run) }), 409: Refusal }) } },
    async (_req, reply) => {
      const runs = useCases.listRuns(state);
      return runs.ok ? { runs: runs.value } : reply.code(409).send(refusal(runs.finding));
    },
  );
  app.get(
    "/api/runs/:runId",
    { schema: { params: RunPath, response: answers({ 200: RunDetail, 404: Refusal, 409: Refusal }) } },
    async (req, reply) => {
      const shown = useCases.showRun(state, req.params.runId);
      return shown.ok ? shown.value : reply.code(status(shown.finding)).send(refusal(shown.finding));
    },
  );
  app.get(
    "/api/doctor",
    { schema: { response: answers({ 200: z.strictObject({ findings: z.array(FindingSchema) }) }) } },
    async () => ({
      findings: useCases.doctor(state),
    }),
  );
};

/** The undo of a run: its preview, and the undo run applied only with the hash of the preview the user approved. */
export const undoRoutes: FastifyPluginAsyncZod<{ state: string }> = async (app, { state }) => {
  app.get(
    "/api/runs/:runId/undo",
    { schema: { params: RunPath, response: answers({ 200: UndoPreview, 404: Refusal, 409: Refusal }) } },
    async (req, reply) => {
      const preview = useCases.previewUndo(state, req.params.runId);
      return preview.ok ? preview.value : reply.code(status(preview.finding)).send(refusal(preview.finding));
    },
  );
  app.post(
    "/api/runs/:runId/undo",
    {
      schema: {
        params: RunPath,
        body: z.strictObject({ approve: Sha256.describe("The planHash of the undo preview the user approved") }),
        // 409 with a run result: refused (the files changed since the preview) or stopped midway.
        response: answers({ 200: RunResult, 404: Refusal, 409: z.union([RunResult, Refusal]) }),
      },
    },
    async (req, reply) => {
      const undone = useCases.undoRun(state, req.params.runId, { approve: req.body.approve });
      if (!undone.ok) return reply.code(status(undone.finding)).send(refusal(undone.finding));
      const done = undone.value.status === "applied" || undone.value.status === "nothing-to-undo";
      return reply.code(done ? 200 : 409).send(undone.value);
    },
  );
};
