import { PlainText, Quota } from "@cedarloom/contracts";
import type {
  SwitchEvent,
  TargetAccount,
  TargetParams,
  TargetPolicy,
  TargetPolicyParams,
  TargetProbe,
  TargetSelect,
  TargetSelectParams,
  TargetTick,
} from "@cedarloom/extension-sdk";
import { z } from "zod";

// What a switch target sends reaches the ledger and the screens: bounded, an alias without control characters.
const Alias = PlainText.min(1).max(64);
const When = z.iso.datetime({ offset: true });
const Text = z.string().max(200);
const Percent = z.number().min(0).max(100);
const Event: z.ZodType<SwitchEvent> = z.strictObject({
  at: When,
  from: Alias.nullable(),
  to: Alias,
  reason: Text,
  trigger: Text,
});
const Window = z.strictObject({ window: Quota, usedPercent: Percent, resetsAt: When.nullable() });
const Account = z.strictObject({
  alias: Alias,
  number: z.int().min(1),
  active: z.boolean(),
  disabled: z.boolean(),
  threshold: Percent.nullable(),
  windows: z.array(Window).max(16),
});
const Setting = z.union([Text, z.number(), z.boolean()]);

type Answers = {
  "target/probe": TargetProbe;
  "target/accounts": { accounts: TargetAccount[] };
  "target/current": { alias: string | null };
  "target/select": TargetSelect;
  "target/tick": TargetTick;
  "target/policy": TargetPolicy;
};
/** What each call of a switch target answers (protocol `target/*`); the host refuses anything else. */
export const ANSWERS: { [C in keyof Answers]: z.ZodType<Answers[C]> } = {
  "target/probe": z.strictObject({
    status: z.enum(["supported", "partial", "unsupported"]),
    detail: z.string().max(2000),
  }),
  "target/accounts": z.strictObject({ accounts: z.array(Account).max(64) }),
  "target/current": z.strictObject({ alias: Alias.nullable() }),
  "target/select": z.strictObject({ switched: z.boolean(), from: Alias.nullable(), to: Alias, reason: Text }),
  "target/tick": z.strictObject({ code: z.int().nullable(), events: z.array(Event).max(100) }),
  "target/policy": z.strictObject({
    values: z
      .record(z.string().regex(/^[a-z][a-z0-9._-]{0,63}$/), Setting)
      .refine((values) => Object.keys(values).length <= 64),
  }),
};
export type TargetCall = keyof Answers;
export type TargetAnswer<C extends TargetCall> = Answers[C];
/** What each call sends: the target, and for a select the alias, for a policy the settings to change. */
export type TargetCallParams = {
  "target/probe": TargetParams;
  "target/accounts": TargetParams;
  "target/current": TargetParams;
  "target/select": TargetSelectParams;
  "target/tick": TargetParams;
  "target/policy": TargetPolicyParams;
};

const Target = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
/** A reading of an account's window, from a switch target (`accounts/reading`). */
export const TargetReading = z.strictObject({
  target: Target,
  alias: Alias,
  window: Quota,
  usedPercent: Percent,
  resetsAt: When,
  readAt: When,
});
export type TargetReading = z.infer<typeof TargetReading>;
/** A switch a target made, for the ledger (`switch/record`). */
export const TargetRecord = z.strictObject({ target: Target, event: Event });
export type TargetRecord = z.infer<typeof TargetRecord>;
