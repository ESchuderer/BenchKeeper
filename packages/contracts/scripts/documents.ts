import { z } from "zod";
import { contracts } from "@cedarloom/contracts";

const text = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

/** The generated documents by path below the package folder: one JSON Schema per contract (the server generates the OpenAPI document). */
export const documents = (): Map<string, string> => {
  const files = z.toJSONSchema(contracts, { target: "draft-2020-12", uri: (id) => `${id}.schema.json` }).schemas;
  return new Map(
    Object.entries(files).map(([id, schema]): [string, string] => [`schema/${id}.schema.json`, text(schema)]),
  );
};
