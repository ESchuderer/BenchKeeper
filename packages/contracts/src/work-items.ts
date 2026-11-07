import { z } from "zod";
import { Finding } from "./findings.ts";
import { Sha256 } from "./plan.ts";
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

const Label = PlainText.min(1).max(100);

/**
 * A write to a hub issue that the file ledger cannot undo; it waits in the outbox until it is sent. A comment's body
 * leaves room for the outbox's marker under GitHub's 65,536 characters.
 */
export const Intent = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("comment"), issue: IssueRef, body: z.string().min(1).max(65_000) }),
  z.strictObject({ kind: z.literal("uncomment"), issue: IssueRef, comment: z.int().positive() }),
  z.strictObject({ kind: z.literal("label"), issue: IssueRef, label: Label }),
  z.strictObject({ kind: z.literal("unlabel"), issue: IssueRef, label: Label }),
]);
export type Intent = z.infer<typeof Intent>;

/** A comment as the tracker keeps it. */
export const RemoteComment = z.strictObject({ id: z.int().positive(), url: z.url() });
export type RemoteComment = z.infer<typeof RemoteComment>;

/**
 * An outbox entry: its intent, the idempotency key it was queued under (one entry per key), who approved it (the owner,
 * or a repository's mirroring opt-in, A36 a) and how far it got. `sending` without a live sender was interrupted and is
 * due again. `unchanged`: the issue already was as a label intent asks, read before its first write, so its undo has
 * nothing to do. `remote`: the comment a comment intent made.
 */
export const OutboxEntry = z.strictObject({
  id: z.uuid(),
  key: z.string().min(1).max(200),
  intent: Intent,
  intentHash: Sha256,
  approvedBy: z.enum(["owner", "mirroring"]),
  status: z.enum(["pending", "sending", "sent", "failed", "cancelled"]),
  attempts: z.int().min(0),
  unchanged: z.boolean().nullable(),
  remote: RemoteComment.nullable(),
  finding: Finding.nullable(),
  createdAt: z.iso.datetime({ precision: 3 }),
  settledAt: z.iso.datetime({ precision: 3 }).nullable(),
});
export type OutboxEntry = z.infer<typeof OutboxEntry>;

/** A run linked to a hub issue, kept in the local ledger only: public commits and pull requests never cite it (ARW1-2). */
export const IssueLink = z.strictObject({
  runId: z.uuid(),
  issue: IssueRef,
  linkedAt: z.iso.datetime({ precision: 3 }),
});
export type IssueLink = z.infer<typeof IssueLink>;
