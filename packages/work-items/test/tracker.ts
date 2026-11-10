import type { IssueRef, RemoteComment, Result } from "@cedarloom/contracts";
import type { Tracker } from "@cedarloom/work-items";

/**
 * What the next write does wrong: `refuse` and `outage` answer without writing; `lose-answer` writes and then answers as
 * an outage; `garble` writes and then answers with nothing the adapter can read; `crash` writes and then throws, as a
 * sender that ends before it settles.
 */
export type Fault = "refuse" | "outage" | "lose-answer" | "garble" | "crash";

type Issue = { labels: Set<string>; comments: Map<number, string> };

const OUTAGE = {
  ok: false,
  finding: { code: "tracker.unavailable", params: { error: "ETIMEDOUT", retryAfter: null, rateLimitReset: null } },
} as const;

/**
 * A tracker in memory: the hub's labels with their colors, issues with labels and comments, and one fault for the next
 * write.
 */
export class FakeTracker implements Tracker {
  readonly hub = "acme/tracker";
  readonly hubLabels = new Map<string, string>();
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

  async labels(): Promise<Result<string[]>> {
    return { ok: true, value: [...this.hubLabels.keys()] };
  }

  async createLabel(label: string, color: string): Promise<Result<boolean>> {
    return this.#fail(() => {
      if (this.hubLabels.has(label)) return false;
      this.hubLabels.set(label, color);
      return true;
    });
  }

  async deleteLabel(label: string): Promise<Result<null>> {
    return this.#fail(() => {
      this.hubLabels.delete(label);
      for (const issue of this.#issues.values()) issue.labels.delete(label);
      return null;
    });
  }

  #remote(ref: IssueRef, id: number): RemoteComment {
    return { id, url: `https://github.com/${ref.repo}/issues/${ref.number}#issuecomment-${id}` };
  }

  #write<T>(ref: IssueRef, write: (issue: Issue) => T): Result<T> {
    return this.#fail(() => write(this.issue(ref)));
  }

  #fail<T>(write: () => T): Result<T> {
    const fault = this.fault;
    this.fault = null;
    if (fault === "refuse")
      return { ok: false, finding: { code: "tracker.refused", params: { status: 404, error: "Not Found" } } };
    if (fault === "outage") return OUTAGE;
    const value = write();
    if (fault === "lose-answer") return OUTAGE;
    if (fault === "garble") return { ok: false, finding: { code: "tracker.invalid-answer", params: { error: "id" } } };
    if (fault === "crash") throw new Error("the sender ended");
    return { ok: true, value };
  }
}
