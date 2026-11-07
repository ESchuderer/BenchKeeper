import {
  Draft,
  DraftInfo,
  DraftSaved,
  type Finding,
  Finding as FindingSchema,
  type GraphRun,
  GraphRunSummary,
  NodeAttempt,
  Refusal,
  Run,
  RunResult,
  Sha256,
  Step,
  UndoPreview,
  WorkflowId,
  WorkflowJson,
} from "@cedarloom/contracts";
import * as useCases from "@cedarloom/use-cases";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { cookieName, portOf, type Session } from "./session.ts";

const RunPath = z.strictObject({ runId: z.uuid() });
/** Every route can also answer 400, 401, 403, 413, 415 or 421 with an error code from the guard or the parser. */
const answers = <T extends object>(codes: T): T & { default: typeof Problem } => ({ ...codes, default: Problem });
const Problem = z.object({ error: z.string() }).describe("A request the server refused, by error code");

const status = (finding: Finding): 404 | 409 =>
  finding.code === "run.not-found" || finding.code === "draft.not-found" ? 404 : 409;
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

// shortcut: the use cases are synchronous, so an undo, a busy store or a read while another process cleans up the WAL
// (each up to 1 s; the WAL cleanup usually takes milliseconds) holds the event loop, and the event streams' reads wait
// meanwhile; move the use cases to a worker when undos get long or several tabs need answers during one.

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

/**
 * The editor's drafts in the state folder: the list, one draft with its workflow, a save (the last one wins and says
 * whether it replaced another tab's), and a delete after an export, a new workflow or a discard.
 */
export const draftRoutes: FastifyPluginAsyncZod<{ state: string }> = async (app, { state }) => {
  const DraftPath = z.strictObject({ id: WorkflowId });
  app.get(
    "/api/drafts",
    { schema: { response: answers({ 200: z.strictObject({ drafts: z.array(DraftInfo) }) }) } },
    async () => ({ drafts: useCases.listDrafts(state) }),
  );
  app.get(
    "/api/drafts/:id",
    { schema: { params: DraftPath, response: answers({ 200: Draft, 404: Refusal, 409: Refusal }) } },
    async (req, reply) => {
      const read = useCases.readDraft(state, req.params.id);
      return read.ok ? read.value : reply.code(status(read.finding)).send(refusal(read.finding));
    },
  );
  app.put(
    "/api/drafts/:id",
    {
      // A workflow's canonical file is larger than its compact JSON, so a body at this limit is checked again.
      bodyLimit: useCases.DRAFT_LIMIT,
      schema: {
        params: DraftPath,
        body: z.strictObject({
          workflow: WorkflowJson,
          replaces: Sha256.nullable().describe("The hash of the version this save replaces; null for a new draft"),
        }),
        response: answers({ 200: DraftSaved, 409: Refusal }),
      },
    },
    async (req, reply) => {
      const saved = useCases.saveDraft(state, req.params.id, req.body.workflow, req.body.replaces);
      return saved.ok ? saved.value : reply.code(status(saved.finding)).send(refusal(saved.finding));
    },
  );
  app.delete(
    "/api/drafts/:id",
    { schema: { params: DraftPath, response: answers({ 204: z.null().describe("Deleted"), 404: Refusal }) } },
    async (req, reply) => {
      const deleted = useCases.deleteDraft(state, req.params.id);
      return deleted.ok ? reply.code(204).send(null) : reply.code(404).send(refusal(deleted.finding));
    },
  );
};

/** A graph run as the API shows it: its summary, without its definition, inputs or project folder. */
export const summaryOf = (run: GraphRun): GraphRunSummary => ({
  id: run.id,
  workflow: run.definition.metadata.id,
  trigger: run.trigger,
  mode: run.mode,
  status: run.status,
  startedAt: run.startedAt,
  finishedAt: run.finishedAt,
});

/** The graph runs and one graph run with its node attempts, as `runs list` and `runs show` read them; reads never write. */
export const graphRunRoutes: FastifyPluginAsyncZod<{ state: string }> = async (app, { state }) => {
  app.get(
    "/api/graph-runs",
    { schema: { response: answers({ 200: z.strictObject({ graphRuns: z.array(GraphRunSummary) }), 409: Refusal }) } },
    async (_req, reply) => {
      const runs = useCases.listGraphRuns(state);
      return runs.ok ? { graphRuns: runs.value.map(summaryOf) } : reply.code(409).send(refusal(runs.finding));
    },
  );
  const GraphRunDetail = z.strictObject({ run: GraphRunSummary, attempts: z.array(NodeAttempt) });
  app.get(
    "/api/graph-runs/:graphRunId",
    {
      schema: {
        params: z.strictObject({ graphRunId: z.uuid() }),
        response: answers({ 200: GraphRunDetail, 404: Refusal, 409: Refusal }),
      },
    },
    async (req, reply) => {
      const shown = useCases.showGraphRun(state, req.params.graphRunId);
      if (!shown.ok) return reply.code(status(shown.finding)).send(refusal(shown.finding));
      return { run: summaryOf(shown.value.run), attempts: shown.value.attempts };
    },
  );
};
