import type { IssueRef, RemoteComment, Result } from "@cedarloom/contracts";

/**
 * The work tracker port: the hub's issues (A3 b), as the outbox reads and writes them. A write that finds the issue
 * already as asked counts as done, so an attempt can run again. A failure is `tracker.unavailable` (the entry stays
 * queued) or `tracker.refused` (it fails).
 */
export interface Tracker {
  hasLabel(issue: IssueRef, label: string): Promise<Result<boolean>>;
  /** The issue's comment whose body holds `marker`; null when none does. */
  findComment(issue: IssueRef, marker: string): Promise<Result<RemoteComment | null>>;
  comment(issue: IssueRef, body: string): Promise<Result<RemoteComment>>;
  /** Deletes a comment of the issue; one already gone counts as deleted. */
  deleteComment(issue: IssueRef, comment: number): Promise<Result<null>>;
  /** Adds the label, or removes it when `on` is false. */
  setLabel(issue: IssueRef, label: string, on: boolean): Promise<Result<null>>;
}
