import helmet from "@fastify/helmet";
import swagger from "@fastify/swagger";
import { contracts } from "@cedarloom/contracts";
import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import {
  createJsonSchemaTransform,
  createJsonSchemaTransformObject,
  hasZodFastifySchemaValidationErrors,
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import { runRoutes, sessionRoutes, undoRoutes } from "./routes.ts";
import { CSRF_HEADER, frameworkErrors, guard, portOf, Session } from "./session.ts";

export interface AppOptions {
  /** The run store's folder. */
  state: string;
  session: Session;
  /** Where errors the client does not see go, such as the server's terminal. */
  log: (text: string) => void;
}

// Requests carry ids, hashes and the session token, never file contents.
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

const description = [
  "Answers on http://127.0.0.1:<port> only. Open the URL the server prints (#t=<token>) and send the token to",
  "POST /api/session once; every other request then needs the cookie cedarloom_session_<port> it sets and its csrf",
  `value in the ${CSRF_HEADER} header.`,
].join(" ");

/** The local server's routes over the application services, with the session guard on every request. */
export const buildApp = async ({ state, session, log }: AppOptions): Promise<FastifyInstance> => {
  const app = Fastify({ bodyLimit: BODY_LIMIT, frameworkErrors });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(swagger, {
    openapi: {
      openapi: "3.1.1",
      // openapi() writes the package version into the committed document.
      info: { title: "CedarLoom local API", version: "0.0.0", description },
    },
    transform: createJsonSchemaTransform({ schemaRegistry: contracts }),
    transformObject: createJsonSchemaTransformObject({ schemaRegistry: contracts }),
  });
  // Plain HTTP on loopback: no HSTS, and a CSP that allows this origin only.
  await app.register(helmet, {
    hsts: false,
    contentSecurityPolicy: {
      directives: { defaultSrc: ["'self'"], baseUri: ["'none'"], formAction: ["'none'"], frameAncestors: ["'none'"] },
    },
  });
  app.addHook("onRequest", guard(session));
  app.addHook("onSend", async (_req, reply) => void reply.header("cache-control", "no-store"));
  errors(app, log);
  await app.register(sessionRoutes, { session });
  await app.register(runRoutes, { state });
  await app.register(undoRoutes, { state });
  return app;
};

/** The OpenAPI document of the routes as @fastify/swagger generates it from their zod schemas, as JSON text. */
export const openapi = async (version: string): Promise<string> => {
  const app = await buildApp({ state: "", session: new Session(), log: console.error });
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
  const app = await buildApp({ ...options, session });
  await app.listen({ host: "127.0.0.1", port: options.port ?? 0 });
  return { url: `http://127.0.0.1:${portOf(app.server)}/#t=${session.token}`, close: () => app.close() };
};
