import { type Finding, type IssueRef, RemoteComment, type Result } from "@cedarloom/contracts";
import type { Tracker } from "@cedarloom/work-items";
import { Octokit } from "@octokit/core";
import { paginateRest } from "@octokit/plugin-paginate-rest";
import { RequestError } from "@octokit/request-error";
import { z } from "zod";

const GitHub = Octokit.plugin(paginateRest);

// The REST API version these calls follow; none of its breaking changes touches issue comments or labels
// (github/rest-api-description at 2f8f80e, x-github-breaking-changes).
const VERSION = { headers: { "x-github-api-version": "2026-03-10" } };

// A rate limit is a 429, or a 403 with x-ratelimit-remaining 0 or a retry-after header
// (https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api#exceeding-the-rate-limit).
const limited = ({ status, response }: RequestError): boolean =>
  status === 429 ||
  (status === 403 &&
    (response?.headers["x-ratelimit-remaining"] === "0" || response?.headers["retry-after"] !== undefined));

/**
 * A failed call as a finding. It waits (the entry stays queued) without an answer (Octokit's status 500), on a server
 * error, a rate limit or a token GitHub does not take (401), which no entry can fix; any other answer refuses the entry,
 * as does one that is no comment.
 */
const failure = (error: unknown): Finding => {
  if (error instanceof z.ZodError) {
    const issues = error.issues.map(({ path, code }) => `${path.join(".")} ${code}`);
    return { code: "tracker.invalid-answer", params: { error: issues.join(", ") } };
  }
  return error instanceof RequestError && error.status < 500 && error.status !== 401 && !limited(error)
    ? { code: "tracker.refused", params: { status: error.status, error: error.message } }
    : { code: "tracker.unavailable", params: { error: error instanceof Error ? error.message : String(error) } };
};

const call = async <T>(work: () => Promise<T>): Promise<Result<T>> => {
  try {
    return { ok: true, value: await work() };
  } catch (error) {
    return { ok: false, finding: failure(error) };
  }
};

// A deletion that GitHub answers with 404 found nothing left to delete.
const gone = async (work: () => Promise<unknown>): Promise<null> => {
  try {
    await work();
  } catch (error) {
    if (!(error instanceof RequestError && error.status === 404)) throw error;
  }
  return null;
};

const repoOf = ({ repo }: IssueRef): { owner: string; repo: string } => {
  const [owner = "", name = ""] = repo.split("/");
  return { owner, repo: name };
};
const issueOf = (issue: IssueRef) => ({ ...repoOf(issue), issue_number: issue.number, ...VERSION });

/**
 * The tracker of the hub (`owner/name`, from local config) on GitHub's REST API, with a token of its `hub-issues` access
 * profile (A37). `fetch` stands in for the network in tests. Answers are checked before they are kept, as GitHub's text
 * is untrusted.
 */
export const githubTracker = (hub: string, token: string, fetch?: typeof globalThis.fetch): Tracker => {
  const github = new GitHub({ auth: token, request: fetch === undefined ? {} : { fetch } });
  return {
    hub,
    hasLabel: (issue, label) =>
      call(async () => {
        const route = "GET /repos/{owner}/{repo}/issues/{issue_number}/labels";
        const labels = await github.paginate(route, { ...issueOf(issue), per_page: 100 });
        // Without case: GitHub matches label names so (unverified), and an undo then never removes a label that was there.
        return labels.some(({ name }) => name.toLowerCase() === label.toLowerCase());
      }),
    findComment: (issue, marker) =>
      call(async () => {
        const route = "GET /repos/{owner}/{repo}/issues/{issue_number}/comments";
        const comments = await github.paginate(route, { ...issueOf(issue), per_page: 100 });
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
        gone(() =>
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
          return gone(() => github.request(route, { ...issueOf(issue), name: label }));
        }
        await github.request("POST /repos/{owner}/{repo}/issues/{issue_number}/labels", {
          ...issueOf(issue),
          labels: [label],
        });
        return null;
      }),
  };
};
