import { CSRF_HEADER } from "@cedarloom/contracts";
import createClient, { type Client } from "openapi-fetch";
import type { paths } from "../schema/api.d.ts";

export type { components, paths } from "../schema/api.d.ts";

/** A typed client of the local API: `api.GET("/api/runs")` and so on, with the paths, bodies and answers of its OpenAPI document. */
export type Api = Client<paths>;

/**
 * Exchanges the token from the page's URL fragment for the session, whose cookie the browser keeps, and returns a client
 * that sends the CSRF token with every request. The token works once: a second call with it is refused.
 */
export const connect = async (baseUrl: string, token: string, fetch?: typeof globalThis.fetch): Promise<Api> => {
  const api = createClient<paths>({ baseUrl, ...(fetch === undefined ? {} : { fetch }) });
  const { data, response } = await api.POST("/api/session", { body: { token } });
  if (data === undefined) throw new Error(`the session exchange answered ${response.status}`);
  api.use({
    onRequest: ({ request }) => {
      request.headers.set(CSRF_HEADER, data.csrf);
      return request;
    },
  });
  return api;
};
