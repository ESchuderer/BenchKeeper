import helmet from "@fastify/helmet";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fastifySSE } from "@fastify/sse";
import serveStatic from "@fastify/static";
import swagger from "@fastify/swagger";
import { CSRF_HEADER, contracts } from "@cedarloom/contracts";
import { type Fetch, type Machine, sweepDrafts } from "@cedarloom/use-cases";
import fp from "fastify-plugin";
import Fastify, { type FastifyError, type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import {
  createJsonSchemaTransform,
  createJsonSchemaTransformObject,
  hasZodFastifySchemaValidationErrors,
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import { eventRoutes } from "./events.ts";
import { draftRoutes, importRoutes, profileRoutes, runRoutes, sessionRoutes, undoRoutes } from "./routes.ts";
import { frameworkErrors, guard, portOf, Session } from "./session.ts";

export interface AppOptions {
  /** The run store's folder. */
  state: string;
  /** CedarLoom's config folder, which holds the profile selection. */
  config: string;
  /** The Claude Code home and the user's home that the profile's machine level writes. */
  machine: Machine;
  /** The app's folder of its own extensions, where the profile finds Orca (without it, no Orca is found). */
  app?: string | undefined;
  session: Session;
  /** Where errors the client does not see go, such as the server's terminal. */
  log: (text: string) => void;
  /** The folder of the built web UI, served at /; without it the server answers the API only. */
  ui?: string | undefined;
  /** How often the event streams read the run store, in ms (default 1000). */
  every?: number | undefined;
  /** How an import and the profile fetch a Git ref (default: over https and ssh). */
  fetch?: Fetch | undefined;
}

// Requests carry ids, hashes and the session token, never file contents; only a draft save carries a workflow.
const BODY_LIMIT = 16 * 1024;

const errors = (app: FastifyInstance, log: (text: string) => void): void => {
  app.setErrorHandler((error: FastifyError, _req, reply) => {
    if (hasZodFastifySchemaValidationErrors(error)) return reply.code(400).send({ error: "invalid-request" });
    const code = error.statusCode ?? 500;
    if (code < 500) return reply.code(code).send({ error: error.code });
    log(`${error.stack ?? String(error)}\n`);
    return reply.code(500).send({ error: "internal" });
  });
};

const components = createJsonSchemaTransformObject({ schemaRegistry: contracts });
const self = { $ref: "#/components/schemas/WorkflowJsonInput" };
// The workflow JSON a request carries, without a recursive schema: docs/agents/cedarloom-rationale.md#workflow-json
const WorkflowJsonInput = {
  anyOf: [
    { not: { type: "object" }, items: self },
    {
      type: "object",
      propertyNames: { not: { const: "__proto__" } },
      additionalProperties: self,
      not: { required: ["constructor"], properties: { constructor: { type: "object", required: ["prototype"] } } },
    },
  ],
};

const description = [
  "Answers on http://127.0.0.1:<port> only. Open the URL the server prints (#t=<token>) and send the token to",
  "POST /api/session once; every other request then needs the cookie cedarloom_session_<port> it sets and its csrf",
  `value in the ${CSRF_HEADER} header.`,
].join(" ");

// One segment of a route pattern as a regular expression: `:name` matches any one segment, anything else itself.
const segment = (part: string): string => (part.startsWith(":") ? "[^/]+" : RegExp.escape(part));

// 404 for an unknown path, 405 with Allow for another method's (RFC 9110, 15.5.6), before the body and for files too.
const methods = (app: FastifyInstance): void => {
  const routes: { method: string; path: RegExp }[] = [];
  app.addHook("onRoute", ({ method, url }) => {
    if (url === "/*") return;
    const path = new RegExp(`^${url.split("/").map(segment).join("/")}$`);
    for (const each of [method].flat()) routes.push({ method: each, path });
  });
  const answer = async (req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
    const path = req.url.replace(/\?.*$/s, "");
    const allow = new Set(routes.filter((route) => route.path.test(path)).map((route) => route.method));
    if (allow.size === 0) return reply.code(404).send({ error: "not-found" });
    const listed = [...allow].toSorted((a, b) => a.localeCompare(b)).join(", ");
    return reply.code(405).header("allow", listed).send({ error: "method-not-allowed" });
  };
  app.setNotFoundHandler(answer);
  app.addHook("onRequest", async (req, reply) => (req.routeOptions.url === undefined ? answer(req, reply) : undefined));
};

const SERVER = {
  bodyLimit: BODY_LIMIT,
  frameworkErrors,
  // Fastify's 0 also turns off Node's own limit, and no proxy sits in front.
  requestTimeout: 30_000,
  // Ends the open event streams too, so a stopped `cedarloom ui` exits at once.
  forceCloseConnections: true,
  // Fastify's defaults, stated as CedarLoom's policy.
  onProtoPoisoning: "error",
  onConstructorPoisoning: "error",
} as const;

/** The local server's routes over the use cases, with the session guard on every request. */
export const buildApp = async (options: AppOptions): Promise<FastifyInstance> => {
  const { state, config, machine, session, log, ui, every = 1000, fetch } = options;
  const app = Fastify(SERVER);
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(swagger, {
    openapi: {
      openapi: "3.1.1",
      // openapi() writes the package version into the committed document.
      info: { title: "CedarLoom local API", version: "0.0.0", description },
    },
    transform: createJsonSchemaTransform({ schemaRegistry: contracts }),
    transformObject: (document) => {
      const object = components(document);
      // The transform builds a new object each time; "components" is there only to narrow away Swagger 2.
      if ("components" in object) Object.assign(object.components?.schemas ?? {}, { WorkflowJsonInput });
      return object;
    },
  });
  // Loopback HTTP: no HSTS, the whole CSP (helmet's defaults allow https: and upgrade); Mantine needs inline styles.
  await app.register(helmet, {
    hsts: false,
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        objectSrc: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
  });
  app.addHook("onRequest", guard(session));
  app.addHook("onSend", async (_req, reply) => void reply.header("cache-control", "no-store"));
  errors(app, log);
  methods(app);
  await app.register(sessionRoutes, { session });
  await app.register(runRoutes, { state });
  await app.register(undoRoutes, { state });
  await app.register(draftRoutes, { state });
  await app.register(importRoutes, { state, fetch });
  await app.register(profileRoutes, { config, state, machine, app: options.app, fetch });
  // CommonJS typed as ESM: wrapped as its module.exports is, so reply.sse reaches the routes beside it.
  await app.register(fp(fastifySSE, { fastify: "5.x", name: "@fastify/sse" }));
  await app.register(eventRoutes, { state, every, log });
  if (ui !== undefined && existsSync(join(ui, "index.html")))
    await app.register(serveStatic, { root: ui, dotfiles: "deny" });
  else if (ui !== undefined) log(`The web UI is not built in ${ui}, so only the API answers.\n`);
  return app;
};

/** The OpenAPI document of the routes as @fastify/swagger generates it from their zod schemas, as JSON text. */
export const openapi = async (version: string): Promise<string> => {
  const machine = { home: "", user: "" };
  const app = await buildApp({ state: "", config: "", machine, session: new Session(), log: console.error });
  await app.ready();
  const document = app.swagger();
  await app.close();
  return `${JSON.stringify({ ...document, info: { ...document.info, version } }, null, 2)}\n`;
};

export interface Started {
  /** The URL to open: the token is in the fragment, which browsers never send to a server. */
  url: string;
  close: () => Promise<void>;
}

/** Starts the server on 127.0.0.1 (a free port unless one is given) with a fresh session. */
export const startServer = async (
  options: Omit<AppOptions, "session"> & { port?: number; tokenMs?: number },
): Promise<Started> => {
  const session = new Session(options.tokenMs);
  sweepDrafts(options.state);
  const app = await buildApp({ ...options, session });
  await app.listen({ host: "127.0.0.1", port: options.port ?? 0 });
  return { url: `http://127.0.0.1:${portOf(app.server)}/#t=${session.token}`, close: () => app.close() };
};
