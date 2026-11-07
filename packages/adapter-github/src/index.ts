import { type Finding, type IssueRef, RemoteComment, type Result } from "@cedarloom/contracts";
import type { Tracker } from "@cedarloom/work-items";
import { Octokit } from "@octokit/core";
import { paginateRest } from "@octokit/plugin-paginate-rest";
import { z } from "zod";

const GitHub = Octokit.plugin(paginateRest);
type Client = InstanceType<typeof GitHub>;

// The REST API version these calls follow; none of its breaking changes touches issue comments or labels
// (github/rest-api-description at 2f8f80e, x-github-breaking-changes).
const VERSION = { headers: { "x-github-api-version": "2026-03-10" } };

// The parts of GitHub's list answers that are read, checked as GitHub's text is untrusted.
const Labels = z.array(z.object({ name: z.string() }));
const Comments = z.array(z.object({ id: z.number(), html_url: z.string(), body: z.string().nullish() }));

// Octokit's RequestError, known by its name: an instanceof check fails once two copies of Octokit are installed.
type HttpError = Error & { status: number; response?: { headers: Record<string, unknown> } };
const httpError = (error: unknown): error is HttpError =>
  error instanceof Error && error.name === "HttpError" && "status" in error && typeof error.status === "number";

// A rate limit is a 429, or a 403 with x-ratelimit-remaining 0, a retry-after header or, for a secondary limit, only its
// message (https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api#exceeding-the-rate-limit).
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

/**
 * A failed call as a finding. It waits (the entry stays queued) without an answer (Octokit's status 500), on a server
 * error, a rate limit or a token GitHub does not take (401), which no entry can fix; any other answer refuses the entry,
 * as does an answer CedarLoom cannot read.
 */
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

// A deletion answered with 404 found nothing left to delete, once the issue answers: GitHub also answers 404 for a
// repository the token cannot see, which the issue's own 404 then refuses.
const gone = async (github: Client, issue: IssueRef, work: () => Promise<unknown>): Promise<null> => {
  try {
    await work();
  } catch (error) {
    if (!(httpError(error) && error.status === 404)) throw error;
    await github.request("GET /repos/{owner}/{repo}/issues/{issue_number}", issueOf(issue));
  }
  return null;
};

/**
 * The tracker of the hub (`owner/name`, from local config) on GitHub's REST API, with a token of its `hub-issues` access
 * profile (A37). `fetch` stands in for the network in tests. Answers are checked before they are kept.
 */
export const githubTracker = (hub: string, token: string, fetch?: typeof globalThis.fetch): Tracker => {
  // A token a header cannot carry would make fetch's error, and so a finding, repeat it.
  if (!/^[\x21-\x7e]+$/.test(token)) throw new Error("the GitHub token holds characters an HTTP header cannot carry");
  const github = new GitHub({ auth: token, request: fetch === undefined ? {} : { fetch } });
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
        const { data } = await github.request(route, { ...issueOf(issue), body });
        return RemoteComment.parse({ id: data.id, url: data.html_url });
      }),
    deleteComment: (issue, comment) =>
      call(() =>
        gone(github, issue, () =>
          github.request("DELETE /repos/{owner}/{repo}/issues/comments/{comment_id}", {
            ...repoOf(issue),
            ...VERSION,
            comment_id: comment,
          }),
        ),
      ),
    setLabel: (issue, label, on) =>
      call(async () => {
        if (!on) {
          const route = "DELETE /repos/{owner}/{repo}/issues/{issue_number}/labels/{name}";
          return gone(github, issue, () => github.request(route, { ...issueOf(issue), name: label }));
        }
        await github.request("POST /repos/{owner}/{repo}/issues/{issue_number}/labels", {
          ...issueOf(issue),
          labels: [label],
        });
        return null;
      }),
  };
};
