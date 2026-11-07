import { z } from "zod";
import { sized } from "./extension.ts";
import { sortKeys } from "./json.ts";
import { fileFormats } from "./registry.ts";

/** The components map format (`components.json` in CedarLoom's config folder) this CedarLoom writes and reads. */
export const COMPONENTS_SCHEMA_VERSION = 1;

/** A first-party part's switch: `auto`, on when its precondition holds, or `off`. */
export const Switch = z.enum(["auto", "off"]);
export type Switch = z.infer<typeof Switch>;

const ComponentId = z.string().regex(/^[a-z][a-z0-9-]{0,63}(\.[a-z][a-z0-9-]{0,63})?$/);

/**
 * The switch of each first-party part by its id (agent-studio DECISIONS row "Core, components, adapters and
 * extensions"); a part not listed is `auto`. A bundled extension is listed by its extension id.
 */
export const Components = z
  .strictObject({
    schemaVersion: z.literal(COMPONENTS_SCHEMA_VERSION),
    kind: z.literal("cedarloom.components"),
    components: sized(z.record(ComponentId, Switch), 100),
  })
  .register(fileFormats, { id: "Components" });
export type Components = z.infer<typeof Components>;

/** The file text of the components map: keys sorted, two spaces, a final line break. */
export const formatComponents = (components: Components): string =>
  `${JSON.stringify(Components.parse(sortKeys(components)), null, 2)}\n`;
