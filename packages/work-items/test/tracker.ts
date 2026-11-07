import type { IssueRef, RemoteComment, Result } from "@cedarloom/contracts";
import type { Tracker } from "@cedarloom/work-items";

/**
 * What the next write does wrong: `refuse` and `outage` answer without writing; `lose-answer` writes and then answers as
 * an outage; `crash` writes and then throws, as a sender that ends before it settles.
 */
export type Fault = "refuse" | "outage" | "lose-answer" | "crash";

type Issue = { labels: Set<string>; comments: Map<number, string> };

const OUTAGE = { ok: false, finding: { code: "tracker.unavailable", params: { error: "ETIMEDOUT" } } } as const;

/** A tracker in memory: issues with labels and comments, and one fault for the next write. */
export class FakeTracker implements Tracker {
  readonly hub = "acme/tracker";
  readonly #issues = new Map<string, Issue>();
  #lastId = 1000;
  fault: Fault | null = null;

  constructor(issues: IssueRef[]) {
    for (const issue of issues)
      this.#issues.set(`${issue.repo}#${issue.number}`, { labels: new Set(), comments: new Map() });
  }

  issue(ref: IssueRef): Issue {
    const issue = this.#issues.get(`${ref.repo}#${ref.number}`);
    if (issue === undefined) throw new Error(`no issue ${ref.repo}#${ref.number}`);
    return issue;
  }

  async hasLabel(ref: IssueRef, label: string): Promise<Result<boolean>> {
    return { ok: true, value: [...this.issue(ref).labels].some((name) => name.toLowerCase() === label.toLowerCase()) };
  }

  async findComment(ref: IssueRef, marker: string): Promise<Result<RemoteComment | null>> {
    const found = [...this.issue(ref).comments].find(([, body]) => body.includes(marker));
    return { ok: true, value: found === undefined ? null : this.#remote(ref, found[0]) };
  }

  async comment(ref: IssueRef, body: string): Promise<Result<RemoteComment>> {
    return this.#write(ref, (issue) => {
      this.#lastId += 1;
      issue.comments.set(this.#lastId, body);
      return this.#remote(ref, this.#lastId);
    });
  }

  async deleteComment(ref: IssueRef, comment: number): Promise<Result<null>> {
    return this.#write(ref, (issue) => {
      issue.comments.delete(comment);
      return null;
    });
  }

  async setLabel(ref: IssueRef, label: string, on: boolean): Promise<Result<null>> {
    return this.#write(ref, (issue) => {
      if (on) issue.labels.add(label);
      else issue.labels.delete(label);
      return null;
    });
  }

  #remote(ref: IssueRef, id: number): RemoteComment {
    return { id, url: `https://github.com/${ref.repo}/issues/${ref.number}#issuecomment-${id}` };
  }

  #write<T>(ref: IssueRef, write: (issue: Issue) => T): Result<T> {
    const fault = this.fault;
    this.fault = null;
    if (fault === "refuse")
      return { ok: false, finding: { code: "tracker.refused", params: { status: 404, error: "Not Found" } } };
    if (fault === "outage") return OUTAGE;
    const value = write(this.issue(ref));
    if (fault === "lose-answer") return OUTAGE;
    if (fault === "crash") throw new Error("the sender ended");
    return { ok: true, value };
  }
}
