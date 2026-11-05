import { i18n, type Messages } from "@lingui/core";
import catalog from "../locales/en/messages.json" with { type: "json" };

// JSON widens the compiled message tuples to plain arrays; this checks the shape `lingui compile` writes.
const compiled = (messages: Record<string, unknown>): messages is Messages =>
  Object.values(messages).every((message) => typeof message === "string" || Array.isArray(message));

if (!compiled(catalog.messages)) throw new Error("locales/en/messages.json is not a compiled catalog");
i18n.loadAndActivate({ locale: "en", messages: catalog.messages });

/** An id of the catalog in locales/en/messages.po, which `pnpm run catalog` compiles. */
export type MessageId = keyof typeof catalog.messages;

/** The English text of a message, with its ICU values filled in. */
export const t = (id: MessageId, values?: Record<string, unknown>): string => i18n._(id, values);
