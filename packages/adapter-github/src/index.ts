import { type Finding, type IssueRef, RemoteComment, type Result } from "@cedarloom/contracts";
import type { Tracker } from "@cedarloom/work-items";
import { Octokit } from "@octokit/core";
import { paginateRest } from "@octokit/plugin-paginate-rest";
import { z } from "zod";

const GitHub = Octokit.plugin(paginateRest);
type Client = InstanceType<typeof GitHub>;

// None of this version's breaking changes touch issue comments or labels (github/rest-api-description 2f8f80e).
const VERSION = { headers: { "x-github-api-version": "2026-03-10" } };

// The parts of GitHub's list answers that are read, checked as GitHub's text is untrusted.
const Labels = z.array(z.object({ name: z.string() }));
const Comment = z.object({ id: z.number(), html_url: z.string(), body: z.string().nullish() });
const Comments = z.array(Comment);
const CommentIssue = z.object({ issue_url: z.string() });

// A request GitHub has not answered in full by then is given up as an outage, so a send never holds its entry for good.
const TIMEOUT_MS = 30_000;
const deadline =
  (fetch: typeof globalThis.fetch, ms: number): typeof globalThis.fetch =>
  (input, init) => {
    const signal = AbortSignal.timeout(ms);
    return fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, signal]) : signal });
  };

// A refusal of the adapter's own, read as one of GitHub's: a comment that belongs to another issue.
class Refused extends Error {
  override readonly name = "HttpError";
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// Octokit's RequestError, known by its name: an instanceof check fails once two copies of Octokit are installed.
type HttpError = Error & { status: number; response?: { headers: Record<string, unknown> } };
const httpError = (error: unknown): error is HttpError =>
  error instanceof Error && error.name === "HttpError" && "status" in error && typeof error.status === "number";

// A 429, or one of the 403 forms GitHub documents: docs/agents/cedarloom-rationale.md#rate-limits
const limited = ({ status, response, message }: HttpError): boolean =>
  status === 429 ||
  (status === 403 &&
    (response?.headers["x-ratelimit-remaining"] === "0" ||
      response?.headers["retry-after"] !== undefined ||
      /secondary rate limit/i.test(message)));

// A header of a rate limit's answer as GitHub sent it; null for any other answer, as every one carries x-ratelimit-reset.
const header = (error: unknown, name: string): string | null => {
  const value = httpError(error) && limited(error) ? error.response?.headers[name] : undefined;
  return typeof value === "string" ? value : null;
};

// Waits (the entry stays queued) on no answer, a server error, a rate limit or a 401; anything else refuses the entry.
const failure = (error: unknown): Finding => {
  if (error instanceof z.ZodError) {
    const issues = error.issues.map(({ path, code }) => `${path.join(".")} ${code}`);
    return { code: "tracker.invalid-answer", params: { error: issues.join(", ") } };
  }
  return httpError(error) && error.status < 500 && error.status !== 401 && !limited(error)
    ? { code: "tracker.refused", params: { status: error.status, error: error.message } }
    : {
        code: "tracker.unavailable",
        params: {
          error: error instanceof Error ? error.message : String(error),
          retryAfter: header(error, "retry-after"),
          rateLimitReset: header(error, "x-ratelimit-reset"),
        },
      };
};

const call = async <T>(work: () => Promise<T>): Promise<Result<T>> => {
  try {
    return { ok: true, value: await work() };
  } catch (error) {
    return { ok: false, finding: failure(error) };
  }
};

const repoOf = ({ repo }: IssueRef): { owner: string; repo: string } => {
  const [owner = "", name = ""] = repo.split("/");
  return { owner, repo: name };
};
const issueOf = (issue: IssueRef) => ({ ...repoOf(issue), issue_number: issue.number, ...VERSION });

// null on GitHub's 404 while the issue answers: nothing left to delete; a hidden repository's 404 refuses at the issue.
const orGone = async <T>(github: Client, issue: IssueRef, work: () => Promise<T>): Promise<T | null> => {
  try {
    return await work();
  } catch (error) {
    if (!(httpError(error) && error.status === 404)) throw error;
    await github.request("GET /repos/{owner}/{repo}/issues/{issue_number}", issueOf(issue));
    return null;
  }
};

// A comment on another hub issue deletes nothing and refuses; one already gone is done.
const deleteComment = async (github: Client, issue: IssueRef, comment: number): Promise<null> => {
  const params = { ...repoOf(issue), ...VERSION, comment_id: comment };
  const found = await orGone(github, issue, () =>
    github.request("GET /repos/{owner}/{repo}/issues/comments/{comment_id}", params),
  );
  if (found === null) return null;
  if (!CommentIssue.parse(found.data).issue_url.endsWith(`/issues/${issue.number}`)) {
    throw new Refused(404, `comment ${comment} is not on issue ${issue.number}`);
  }
  await orGone(github, issue, () =>
    github.request("DELETE /repos/{owner}/{repo}/issues/comments/{comment_id}", params),
  );
  return null;
};

/**
 * The tracker of the hub (`owner/name`, from local config) on GitHub's REST API, with a token of its `hub-issues` access
 * profile (A37). `fetch` and `timeoutMs` stand in for the network and its deadline in tests. Answers are checked before
 * they are kept.
 */
export const githubTracker = (
  hub: string,
  token: string,
  { fetch = globalThis.fetch, timeoutMs = TIMEOUT_MS }: { fetch?: typeof globalThis.fetch; timeoutMs?: number } = {},
): Tracker => {
  // A token a header cannot carry would make fetch's error, and so a finding, repeat it.
  if (!/^[\x21-\x7e]+$/.test(token)) throw new Error("the GitHub token holds characters an HTTP header cannot carry");
  const github = new GitHub({ auth: token, request: { fetch: deadline(fetch, timeoutMs) } });
  return {
    hub,
    hasLabel: (issue, label) =>
      call(async () => {
        const route = "GET /repos/{owner}/{repo}/issues/{issue_number}/labels";
        const labels = Labels.parse(await github.paginate(route, { ...issueOf(issue), per_page: 100 }));
        // Without case: GitHub matches label names so (unverified), and an undo then never removes a label that was there.
        return labels.some(({ name }) => name.toLowerCase() === label.toLowerCase());
      }),
    findComment: (issue, marker) =>
      call(async () => {
        const route = "GET /repos/{owner}/{repo}/issues/{issue_number}/comments";
        const comments = Comments.parse(await github.paginate(route, { ...issueOf(issue), per_page: 100 }));
        const found = comments.find(({ body }) => body?.includes(marker) === true);
        return found === undefined ? null : RemoteComment.parse({ id: found.id, url: found.html_url });
      }),
    comment: (issue, body) =>
      call(async () => {
        const route = "POST /repos/{owner}/{repo}/issues/{issue_number}/comments";
        const answer = Comment.parse((await github.request(route, { ...issueOf(issue), body })).data);
        return RemoteComment.parse({ id: answer.id, url: answer.html_url });
      }),
    deleteComment: (issue, comment) => call(() => deleteComment(github, issue, comment)),
    setLabel: (issue, label, on) =>
      call(async () => {
        if (!on) {
          const route = "DELETE /repos/{owner}/{repo}/issues/{issue_number}/labels/{name}";
          await orGone(github, issue, () => github.request(route, { ...issueOf(issue), name: label }));
          return null;
        }
        await github.request("POST /repos/{owner}/{repo}/issues/{issue_number}/labels", {
          ...issueOf(issue),
          labels: [label],
        });
        return null;
      }),
  };
};
