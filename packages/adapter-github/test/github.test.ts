import { readFileSync } from "node:fs";
import { join } from "node:path";
import { githubTracker } from "@cedarloom/adapter-github";
import type { IssueRef } from "@cedarloom/contracts";
import { expect, test } from "vitest";
import { z } from "zod";

const Fixtures = z.object({
  comments: z.array(z.unknown()).min(1),
  labels: z.array(z.unknown()),
  notFound: z.unknown(),
});
const fixtures = Fixtures.parse(JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", "github.json"), "utf8")));
const issue: IssueRef = { repo: "acme/tracker", number: 7 };
const API = "https://api.github.com/repos/acme/tracker";

/** A recorded answer: its status, headers and body, or an error for a request that got none. */
type Answer = { status: number; headers?: Record<string, string>; body?: unknown } | Error;

/** A fetch that answers each request with the next recorded answer and keeps the requests as GitHub would see them. */
const replay = (answers: Answer[]) => {
  const requests: { method: string; url: string; auth: string | null; body?: unknown }[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const text = await request.text();
    const body: { body?: unknown } = text === "" ? {} : { body: JSON.parse(text) };
    requests.push({ method: request.method, url: request.url, auth: request.headers.get("authorization"), ...body });
    const answer = answers.shift();
    if (answer === undefined || answer instanceof Error) throw answer ?? new Error("no answer recorded");
    const headers = { "content-type": "application/json; charset=utf-8", ...answer.headers };
    return new Response(answer.body === undefined ? null : JSON.stringify(answer.body), {
      status: answer.status,
      headers,
    });
  };
  return { requests, tracker: githubTracker("acme/tracker", "test-token", fetch) };
};

test("a comment is posted to the issue with the token in its header, and GitHub's answer gives its id and link", async () => {
  const { requests, tracker } = replay([{ status: 201, body: fixtures.comments[0] }]);
  expect(await tracker.comment(issue, "Run ended.")).toEqual({
    ok: true,
    value: { id: 1, url: "https://github.com/octocat/Hello-World/issues/1347#issuecomment-1" },
  });
  expect(requests).toEqual([
    { method: "POST", url: `${API}/issues/7/comments`, auth: "token test-token", body: { body: "Run ended." } },
  ]);
});

test("a comment is found by text in its body, and none holds a marker that was never posted", async () => {
  const { requests, tracker } = replay([
    { status: 200, body: fixtures.comments },
    { status: 200, body: fixtures.comments },
  ]);
  expect(await tracker.findComment(issue, "Me too")).toEqual({
    ok: true,
    value: { id: 1, url: "https://github.com/octocat/Hello-World/issues/1347#issuecomment-1" },
  });
  expect(await tracker.findComment(issue, "<!-- cedarloom-outbox:never -->")).toEqual({ ok: true, value: null });
  expect(requests.map(({ url }) => url)).toEqual([
    `${API}/issues/7/comments?per_page=100`,
    `${API}/issues/7/comments?per_page=100`,
  ]);
});

test("a label is found in any case, added by name, and removed by its name in the path", async () => {
  const { requests, tracker } = replay([
    { status: 200, body: fixtures.labels },
    { status: 200, body: fixtures.labels },
    { status: 200, body: fixtures.labels },
  ]);
  expect(await tracker.hasLabel(issue, "BUG")).toEqual({ ok: true, value: true });
  expect(await tracker.setLabel(issue, "agent:review", true)).toEqual({ ok: true, value: null });
  expect(await tracker.setLabel(issue, "agent:review", false)).toEqual({ ok: true, value: null });
  expect(requests.map(({ method, url, body }) => [method, url, body])).toEqual([
    ["GET", `${API}/issues/7/labels?per_page=100`, undefined],
    ["POST", `${API}/issues/7/labels`, { labels: ["agent:review"] }],
    ["DELETE", `${API}/issues/7/labels/agent%3Areview`, undefined],
  ]);
});

test("a deletion of what is gone is done, and a missing issue refuses the write", async () => {
  const { tracker } = replay([
    { status: 404, body: fixtures.notFound },
    { status: 404, body: fixtures.notFound },
    { status: 404, body: fixtures.notFound },
  ]);
  expect(await tracker.deleteComment(issue, 1)).toEqual({ ok: true, value: null });
  expect(await tracker.setLabel(issue, "agent:review", false)).toEqual({ ok: true, value: null });
  expect(await tracker.comment(issue, "Run ended.")).toMatchObject({
    ok: false,
    finding: { code: "tracker.refused", params: { status: 404 } },
  });
});

test("a rate limit, a refused token, a server error and no answer keep the write waiting; a forbidden write or an answer that is no comment fails", async () => {
  const forbidden = { message: "Resource not accessible by personal access token" };
  const { tracker } = replay([
    { status: 403, headers: { "x-ratelimit-remaining": "0" }, body: { message: "API rate limit exceeded" } },
    { status: 429, headers: { "retry-after": "60" }, body: { message: "secondary rate limit" } },
    { status: 401, body: { message: "Bad credentials" } },
    { status: 502, body: { message: "Server Error" } },
    new TypeError("fetch failed"),
    { status: 403, body: forbidden },
    { status: 201, body: { id: 1, html_url: "javascript:alert(1)" } },
  ]);
  const codes: string[] = [];
  for (let i = 0; i < 7; i += 1) {
    const sent = await tracker.comment(issue, "Run ended.");
    codes.push(sent.ok ? "sent" : sent.finding.code);
  }
  expect(codes).toEqual([
    "tracker.unavailable",
    "tracker.unavailable",
    "tracker.unavailable",
    "tracker.unavailable",
    "tracker.unavailable",
    "tracker.refused",
    "tracker.invalid-answer",
  ]);
});
