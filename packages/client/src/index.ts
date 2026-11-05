import { CSRF_HEADER } from "@cedarloom/contracts/http";
import createClient, { type Client } from "openapi-fetch";
import type { paths } from "../schema/api.d.ts";

export type { components, paths } from "../schema/api.d.ts";

/**
 * A typed client of the local API: `api.GET("/api/runs")` and so on, with the paths, bodies and answers of its OpenAPI
 * document. A refusal (4xx) arrives in `error`, as the 409 of an undo the files changed under.
 */
export type Api = Client<paths>;

/**
 * Exchanges the token from the page's URL fragment for the session: the browser keeps the cookie, the returned CSRF
 * token goes to `client`. The token works once, so a page keeps the CSRF token (sessionStorage) to survive a reload.
 */
export const exchange = async (baseUrl: string, token: string, fetch?: typeof globalThis.fetch): Promise<string> => {
  const api = createClient<paths>({ baseUrl, ...(fetch === undefined ? {} : { fetch }) });
  const { data, error, response } = await api.POST("/api/session", { body: { token } });
  if (data === undefined) throw new Error(`the session exchange answered ${response.status} ${error.error}`);
  return data.csrf;
};

/** A client that sends the CSRF token with every request to the API's own origin, and never to another one. */
export const client = (baseUrl: string, csrf: string, fetch?: typeof globalThis.fetch): Api => {
  const api = createClient<paths>({ baseUrl, ...(fetch === undefined ? {} : { fetch }) });
  const origin = new URL(baseUrl).origin;
  api.use({
    onRequest: ({ request }) => {
      if (new URL(request.url).origin === origin) request.headers.set(CSRF_HEADER, csrf);
      return request;
    },
  });
  return api;
};
