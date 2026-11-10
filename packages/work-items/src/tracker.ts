import type { IssueRef, RemoteComment, Result } from "@cedarloom/contracts";

/**
 * The work tracker port: the issues and labels of the hub, the only tracker (A3 b), as the outbox reads and writes
 * them. A call never throws: a failure is `tracker.unavailable` (the entry stays queued) or a refusal (it fails), and
 * an answer is checked before it is returned. A write that finds the hub already as asked counts as done, so an
 * attempt can run again.
 */
export interface Tracker {
  /** The hub as `owner/name`, from local config; the outbox writes to no other repository. */
  readonly hub: string;
  /** Whether the issue has the label, its name compared without case. */
  hasLabel(issue: IssueRef, label: string): Promise<Result<boolean>>;
  /** The first of all the issue's comments whose body holds `marker`; null when none does. */
  findComment(issue: IssueRef, marker: string): Promise<Result<RemoteComment | null>>;
  comment(issue: IssueRef, body: string): Promise<Result<RemoteComment>>;
  /** Deletes a comment of the issue; one already gone counts as deleted. */
  deleteComment(issue: IssueRef, comment: number): Promise<Result<null>>;
  /** Adds the label, or removes it when `on` is false. */
  setLabel(issue: IssueRef, label: string, on: boolean): Promise<Result<null>>;
  /** The names of the hub's labels. */
  labels(): Promise<Result<string[]>>;
  /** Creates a label of the hub, with its id; null when it already exists, which is left as it is. */
  createLabel(label: string, color: string, description?: string): Promise<Result<RemoteComment | null>>;
  /** Deletes a label of the hub, which takes it off every issue; one already gone counts as deleted. */
  deleteLabel(label: string, id: number): Promise<Result<null>>;
}
