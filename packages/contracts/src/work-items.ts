import { z } from "zod";
import { Finding } from "./findings.ts";
import { Sha256 } from "./plan.ts";
import { Color } from "./profile.ts";
import { PlainText } from "./text.ts";

/**
 * An issue of the hub, the only tracker (A3 b): its repository as `owner/name` and its number. The hub's name comes from
 * local config and never from CedarLoom's code (ARW1-2). `.` and `..` are no repository, so no name climbs the API path.
 */
export const IssueRef = z.strictObject({
  repo: z.string().regex(/^[A-Za-z0-9-]{1,39}\/(?!\.{1,2}$)[A-Za-z0-9._-]{1,100}$/),
  number: z.int().positive(),
});
export type IssueRef = z.infer<typeof IssueRef>;

// A label is a path segment of GitHub's API, where `.` and `..` would climb even when encoded.
const Label = PlainText.min(1)
  .max(100)
  .regex(/^(?!\.{1,2}$)/);

/**
 * A write to a hub issue, or to the hub's labels, that the file ledger cannot undo; it waits in the outbox until it is
 * sent. A comment's body leaves room for the outbox's marker under GitHub's 65,536 characters.
 */
export const Intent = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("comment"), issue: IssueRef, body: z.string().min(1).max(65_000) }),
  z.strictObject({ kind: z.literal("uncomment"), issue: IssueRef, comment: z.int().positive() }),
  z.strictObject({ kind: z.literal("label"), issue: IssueRef, label: Label }),
  z.strictObject({ kind: z.literal("unlabel"), issue: IssueRef, label: Label }),
  z.strictObject({
    kind: z.literal("create-label"),
    repo: IssueRef.shape.repo,
    label: Label,
    color: Color,
    description: PlainText.max(100).optional(),
  }),
  // `id`: the label the send created; one of the name made since is another's and stays.
  z.strictObject({ kind: z.literal("delete-label"), repo: IssueRef.shape.repo, label: Label, id: z.int().positive() }),
]);
export type Intent = z.infer<typeof Intent>;

/** A comment as the tracker keeps it. */
export const RemoteComment = z.strictObject({ id: z.int().positive(), url: z.url({ protocol: /^https$/ }) });
export type RemoteComment = z.infer<typeof RemoteComment>;

/**
 * An outbox entry: its intent, the idempotency key it was queued under (one entry per key), who approved it (the owner)
 * and how far it got. `sending` without a live sender was interrupted and is due again. `unchanged`: the issue or hub
 * already was as a label intent asks, read before its first write, so its undo has nothing to do. `remote`: the comment a
 * comment intent made, or the hub label a create-label intent made.
 */
export const OutboxEntry = z.strictObject({
  id: z.uuid(),
  key: z.string().min(1).max(200),
  intent: Intent,
  intentHash: Sha256,
  approvedBy: z.literal("owner"),
  status: z.enum(["pending", "sending", "sent", "failed"]),
  attempts: z.int().min(0),
  unchanged: z.boolean().nullable(),
  remote: RemoteComment.nullable(),
  finding: Finding.nullable(),
  createdAt: z.iso.datetime({ precision: 3 }),
  settledAt: z.iso.datetime({ precision: 3 }).nullable(),
});
export type OutboxEntry = z.infer<typeof OutboxEntry>;
