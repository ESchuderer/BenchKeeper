import { i18n, type MessageId, type Messages } from "@lingui/core";
import type { MessageValues } from "../schema/messages.d.ts";
import catalog from "../locales/en/messages.json" with { type: "json" };

// JSON widens the compiled message tuples to plain arrays; this checks the shape `lingui compile` writes.
const compiled = (messages: Record<string, unknown>): messages is Messages =>
  Object.values(messages).every((message) => typeof message === "string" || Array.isArray(message));

if (!compiled(catalog.messages)) throw new Error("locales/en/messages.json is not a compiled catalog");
i18n.loadAndActivate({ locale: "en", messages: catalog.messages });

type Values<Id extends MessageId> = [keyof MessageValues[Id]] extends [never] ? [] : [MessageValues[Id]];

/** The English text of a message: the compiler checks its id (Lingui's Register) and the values its placeholders take. */
export const t = <Id extends MessageId>(id: Id, ...values: Values<Id>): string => i18n._(id, values[0]);

/** A date and time in the catalog's locale. */
export const when = (iso: string): string => i18n.date(iso, { dateStyle: "medium", timeStyle: "short" });
