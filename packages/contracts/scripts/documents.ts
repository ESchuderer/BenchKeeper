import { z } from "zod";
import { contracts, fileFormats } from "@cedarloom/contracts";

const text = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

/** The generated documents by path below the package folder: one JSON Schema per contract and file format (the server generates the OpenAPI document). */
export const documents = (): Map<string, string> =>
  new Map(
    [contracts, fileFormats].flatMap((registry) =>
      Object.entries(
        z.toJSONSchema(registry, { target: "draft-2020-12", uri: (id) => `${id}.schema.json` }).schemas,
      ).map(([id, schema]): [string, string] => [`schema/${id}.schema.json`, text(schema)]),
    ),
  );
