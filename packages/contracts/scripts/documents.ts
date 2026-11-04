import { z } from "zod";
import { contracts } from "@cedarloom/contracts";
import pkg from "../package.json" with { type: "json" };

const withoutId = (schema: z.core.JSONSchema.BaseSchema): z.core.JSONSchema.BaseSchema => {
  const { $id: _id, $schema: _dialect, ...rest } = schema;
  return rest;
};

const text = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

/** The generated documents by path below the package folder: one JSON Schema per contract and the OpenAPI document. */
export const documents = (): Map<string, string> => {
  const files = z.toJSONSchema(contracts, { target: "draft-2020-12", uri: (id) => `${id}.schema.json` }).schemas;
  const components = z.toJSONSchema(contracts, {
    target: "draft-2020-12",
    uri: (id) => `#/components/schemas/${id}`,
  }).schemas;
  const openapi = {
    openapi: "3.1.1",
    info: { title: "CedarLoom local API", version: pkg.version },
    paths: {},
    components: { schemas: Object.fromEntries(Object.entries(components).map(([id, s]) => [id, withoutId(s)])) },
  };
  return new Map([
    ...Object.entries(files).map(([id, schema]): [string, string] => [`schema/${id}.schema.json`, text(schema)]),
    ["openapi.json", text(openapi)],
  ]);
};
