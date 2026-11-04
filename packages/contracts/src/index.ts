import { z } from "zod";

/** The contracts published as JSON Schema 2020-12 documents and OpenAPI components, keyed by `id`. */
export const contracts = z.registry<{ id: string }>();

/** Format version of a persisted JSON document; a reader refuses a version newer than the ones it knows. */
export const SchemaVersion = z
  .int()
  .positive()
  .describe("Format version of a persisted JSON document")
  .register(contracts, { id: "SchemaVersion" });
