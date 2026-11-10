import { randomUUID } from "node:crypto";
import {
  Draft,
  DraftInfo,
  DraftSaved,
  type Finding,
  Finding as FindingSchema,
  ImportPreview,
  type Plan,
  ProfileView,
  Refusal,
  type Result,
  Run,
  RunResult,
  SessionsBoard,
  Sha256,
  Step,
  SwapAccounts,
  SwapApproval,
  SwapInstall,
  SwapInstalled,
  SwapService,
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

// shortcut: an undo or a busy store (up to 1 s) holds the event loop; move use cases to a worker when undos get long or tabs wait.

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

// A save: the last one wins and says whether it replaced another tab's.
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

// The view writes nothing; a switch is one run with its undo, as `profiles select <part> on|off --yes` makes it.
export const profileRoutes: FastifyPluginAsyncZod<{
  config: string;
  state: string;
  machine: useCases.Machine;
  app: string | undefined;
  fetch: useCases.Fetch | undefined;
}> = async (server, { config, state, machine, app, fetch }) => {
  server.get(
    "/api/profile",
    { schema: { response: answers({ 200: ProfileView, 409: Refusal }) } },
    async (_req, reply) => {
      const shown = await useCases.showProfile(config, state, machine, { app, fetch });
      if (!shown.ok) return reply.code(409).send(refusal(shown.finding));
      const { parts, plan, findings, held } = shown.value;
      return { parts, plan: plan === null ? null : useCases.previewPlan(plan).plan, findings, held };
    },
  );
  server.put(
    "/api/profile/parts/:part",
    {
      schema: {
        params: z.strictObject({ part: z.string().describe("The part as level.id, such as machine.rules.global") }),
        body: z.strictObject({ on: z.boolean() }),
        // 409 with a run result: refused (the selection file changed meanwhile) or stopped midway.
        response: answers({ 200: RunResult, 409: z.union([RunResult, Refusal]) }),
      },
    },
    async (req, reply) => {
      const plan = useCases.planChoice(config, { part: req.params.part, on: req.body.on });
      if (!plan.ok) return reply.code(409).send(refusal(plan.finding));
      const applied = useCases.applyPlan(state, plan.value, { yes: true });
      if (!applied.ok) return reply.code(409).send(refusal(applied.finding));
      return reply.code(applied.value.status === "applied" ? 200 : 409).send(applied.value);
    },
  );
};

// The plans of the latest reviews, so an apply stores what a review showed; an older one is planned again.
const KEPT = 16;

// Imports (P6 a): a reviewed Git ref's plan applies once, by the approved preview's hash; the API reads no folder.
export const importRoutes: FastifyPluginAsyncZod<{ state: string; fetch: useCases.Fetch | undefined }> = async (
  app,
  { state, fetch },
) => {
  const planned = new Map<string, Plan>();
  // URL and ref rules are the fetch's (409); 1,025 characters at 12 escaped bytes each fit 16 KiB, so a 400 answers.
  const source = z.strictObject({ git: z.string().max(1024), ref: z.string().max(255) });
  app.post(
    "/api/imports",
    { schema: { body: source, response: answers({ 200: ImportPreview, 409: Refusal }) } },
    async (req, reply) => {
      // Only the URL and the ref go on: the use case's folder branch takes nothing from a request.
      const read = await useCases.planImport(state, { git: req.body.git, ref: req.body.ref }, fetch);
      if (!read.ok) return reply.code(409).send(refusal(read.finding));
      const { review, plan } = read.value;
      if (plan === null) return { id: null, review, planHash: null, plan: null };
      const id = randomUUID();
      planned.set(id, plan);
      for (const old of [...planned.keys()].slice(0, -KEPT)) planned.delete(old);
      return { id, review, ...useCases.previewPlan(plan) };
    },
  );
  app.post(
    "/api/imports/:importId/apply",
    {
      schema: {
        params: z.strictObject({ importId: z.uuid() }),
        body: z.strictObject({ approve: Sha256.describe("The planHash of the import preview the user approved") }),
        // 404: no plan under this id (applied, or older than the latest reviews); 409 with a run result: refused.
        response: answers({ 200: RunResult, 404: Refusal, 409: z.union([RunResult, Refusal]) }),
      },
    },
    async (req, reply) => {
      const plan = planned.get(req.params.importId);
      if (plan === undefined) {
        return reply.code(404).send(refusal({ code: "import.not-found", params: { id: req.params.importId } }));
      }
      const applied = useCases.applyPlan(state, plan, { approve: req.body.approve });
      if (!applied.ok) return reply.code(409).send(refusal(applied.finding));
      if (applied.value.status !== "applied") return reply.code(409).send(applied.value);
      planned.delete(req.params.importId);
      return applied.value;
    },
  );
};

const SWAP = "cedarloom.claude-swap";
const approved = z.boolean().describe("true once the user approved the command the answer without it named");
const Switched = z.union([
  SwapApproval,
  z.strictObject({ switched: z.boolean(), from: z.int().optional(), to: z.int() }),
]);
const SettingsSet = z.union([SwapApproval, SwapAccounts.pick({ settings: true })]);
const SwitchBody = z.strictObject({ account: z.int().min(1).max(999_999), allow: approved });
// claude-swap's two switch lines only, the 5-hour and the weekly one; the other auto mode settings stay with the CLI.
const SettingsBody = z.strictObject({
  key: z.enum(["autoswitch.threshold", "autoswitch.weeklyThreshold"]),
  value: z.number().min(0).max(100).describe("The switch line in percent; claude-swap checks its own range"),
  allow: approved,
});
const AutoSet = z.union([SwapApproval, SwapService]);
const AutoBody = z.strictObject({ on: z.boolean().describe("true: auto-on, false: auto-off"), allow: approved });
const Installed = z.union([SwapInstall, SwapInstalled]);
// The installer, not cswap, and the command the user approved: the extension runs no other one. 1,024 characters at 12
// escaped bytes each fit the server's 16 KiB body limit, so a longer one answers 400, not 413.
const InstallBody = z.strictObject({
  allow: z
    .strictObject({ installer: SwapInstall.shape.installer, runs: z.string().max(1024) })
    .nullable()
    .describe("The installer and command of the approval the user gave; null asks for it"),
});

type SwapPaths = { state: string; config: string; app: string | undefined };
// An action of the app's claude-swap extension, with the programs the user allowed.
const swapIn =
  ({ state, config, app }: SwapPaths) =>
  (action: string, allow: string[] = [], inputs: Record<string, string> = {}): Promise<Result<object>> =>
    app === undefined
      ? Promise.resolve({ ok: false, finding: { code: "extension.unknown", params: { extension: SWAP } } })
      : useCases.runBundled({ state, config, app }, SWAP, action, { allow, inputs });
const cswap = (allow: boolean): string[] => (allow ? ["cswap"] : []);

// claude-swap's auto mode and its install, each run only once the request allows the command it showed.
const swapRoutes: FastifyPluginAsyncZod<SwapPaths> = async (server, paths) => {
  const swap = swapIn(paths);
  server.get(
    "/api/accounts/auto",
    { schema: { response: answers({ 200: SwapService, 409: Refusal }) } },
    async (_req, reply) => {
      const ran = await swap("auto");
      return ran.ok ? SwapService.parse(ran.value) : reply.code(409).send(refusal(ran.finding));
    },
  );
  server.post(
    "/api/accounts/auto",
    { schema: { body: AutoBody, response: answers({ 200: AutoSet, 409: Refusal }) } },
    async (req, reply) => {
      const ran = await swap(req.body.on ? "auto-on" : "auto-off", cswap(req.body.allow));
      return ran.ok ? AutoSet.parse(ran.value) : reply.code(409).send(refusal(ran.finding));
    },
  );
  server.post(
    "/api/accounts/install",
    { schema: { body: InstallBody, response: answers({ 200: Installed, 409: Refusal }) } },
    async (req, reply) => {
      const { allow } = req.body;
      const ran = await swap("install", allow === null ? [] : [allow.installer], allow ? { approved: allow.runs } : {});
      return ran.ok ? Installed.parse(ran.value) : reply.code(409).send(refusal(ran.finding));
    },
  );
};

// Accounts belong to claude-swap: these routes keep nothing, and a change runs only once the request says `allow`.
export const accountRoutes: FastifyPluginAsyncZod<SwapPaths> = async (server, paths) => {
  const swap = swapIn(paths);
  server.get(
    "/api/accounts",
    { schema: { response: answers({ 200: SwapAccounts, 409: Refusal }) } },
    async (_req, reply) => {
      const [listed, settings] = await Promise.all([swap("list"), swap("settings")]);
      if (!listed.ok) return reply.code(409).send(refusal(listed.finding));
      if (!settings.ok) return reply.code(409).send(refusal(settings.finding));
      return SwapAccounts.parse({ ...listed.value, ...settings.value });
    },
  );
  server.post(
    "/api/accounts/switch",
    { schema: { body: SwitchBody, response: answers({ 200: Switched, 409: Refusal }) } },
    async (req, reply) => {
      const ran = await swap("switch", cswap(req.body.allow), { account: String(req.body.account) });
      return ran.ok ? Switched.parse(ran.value) : reply.code(409).send(refusal(ran.finding));
    },
  );
  server.post(
    "/api/accounts/settings",
    { schema: { body: SettingsBody, response: answers({ 200: SettingsSet, 409: Refusal }) } },
    async (req, reply) => {
      const { key, value, allow } = req.body;
      const ran = await swap("settings", cswap(allow), { key, value: String(value) });
      return ran.ok ? SettingsSet.parse(ran.value) : reply.code(409).send(refusal(ran.finding));
    },
  );
  await server.register(swapRoutes, paths);
};

// Reads the session logs (a first read of many logs takes a few seconds); writes only the cache and the sessions
// history, which a DELETE removes.
export const boardRoutes: FastifyPluginAsyncZod<{ logs: useCases.Logs }> = async (app, { logs }) => {
  const query = z.strictObject({
    days: z.coerce.number().int().min(1).max(3650).optional().describe("The period's length in days; absent: all time"),
    // 1,025 characters at 12 escaped bytes each fit the 16 KiB a request line may take, so a 400 answers, not a 431.
    project: z.string().max(1024).optional().describe("The project's folder; absent: every project"),
    tz: z
      .string()
      .max(64)
      .optional()
      .describe("The IANA time zone the days are counted in, such as Europe/Berlin; absent or unknown: UTC"),
  });
  app.get(
    "/api/sessions",
    { schema: { querystring: query, response: answers({ 200: SessionsBoard }) } },
    async (req, _reply) => {
      const { days, project, tz } = req.query;
      // An unknown zone counts in UTC, and the answer names the zone it counted in.
      return useCases.sessionsBoard(logs, { days: days ?? null, project: project ?? null, zone: tz });
    },
  );
  app.delete(
    "/api/sessions/history",
    { schema: { response: answers({ 204: z.null().describe("Deleted, or there was none") }) } },
    async (_req, reply) => {
      useCases.deleteHistory(logs);
      return reply.code(204).send(null);
    },
  );
};
