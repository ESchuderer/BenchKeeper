import { createServer } from "node:http";
import { setDefaultAutoSelectFamily } from "node:net";
import { isPublic, transport } from "@cedarloom/extension-host";
import { afterAll, beforeAll, expect, test } from "vitest";

// A plain HTTP server on this machine: it answers with what it got, or with more than the caller takes.
const server = createServer((request, response) => {
  const chunks: Buffer[] = [];
  request.on("data", (chunk: Buffer) => chunks.push(chunk));
  request.on("end", () => {
    if (request.url === "/big") response.end("x".repeat(100));
    else response.end(`${request.method} ${String(request.headers["x-test"])} ${Buffer.concat(chunks).toString()}`);
  });
});
let base = "";
beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "localhost", resolve));
  base = `localhost:${String(Reflect.get(Object(server.address()), "port"))}`;
});
afterAll(() => {
  server.close();
});

const hop = (url: string, more: { method?: string; body?: string; maxBytes?: number; signal?: AbortSignal } = {}) => ({
  url: new URL(url),
  method: more.method ?? "GET",
  headers: { "x-test": "yes" },
  body: more.body,
  signal: more.signal ?? AbortSignal.timeout(5000),
  maxBytes: more.maxBytes ?? 1000,
});
const outcome = (answered: Promise<{ status: number; body: Buffer }>) =>
  answered.then(
    (answer) => [answer.status, answer.body.toString()],
    (error: unknown) => String(Reflect.get(Object(error), "message")),
  );

test("public addresses only: no loopback, private, link-local, shared, reserved, multicast or special IPv6 range", () => {
  const closed = ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0"];
  const special = [
    "224.0.0.1",
    "255.255.255.255",
    "::1",
    "::",
    "fe80::1",
    "fc00::1",
    "::ffff:127.0.0.1",
    "2001:db8::1",
  ];
  const tunnels = ["2002:7f00:1::1", "2001::1", "64:ff9b::7f00:1", "not an address"];
  const open = ["8.8.8.8", "1.1.1.1", "2606:4700::1111", "2a00:1450:4001:80b::200e"];
  expect([...closed, ...special, ...tunnels, ...open].map(isPublic)).toEqual([
    ...[...closed, ...special, ...tunnels].map(() => false),
    ...open.map(() => true),
  ]);
});

test("the default transport refuses an address that is not public, by its literal or by what its name resolves to", async () => {
  const send = transport();
  expect(
    await Promise.all([
      outcome(send(hop("https://127.0.0.1:1/"))),
      outcome(send(hop(`https://${base}/`))),
      outcome(send(hop("https://name.invalid/"))),
    ]),
  ).toEqual([
    "127.0.0.1 is not a public address",
    "localhost resolves to an address that is not public",
    expect.stringMatching(/ENOTFOUND|EAI_AGAIN/),
  ]);
});

test("a transport sends the method, headers and body, speaks TLS for https, caps the answer, and stops on its signal", async () => {
  const send = transport(() => true);
  const answers = await Promise.all([
    outcome(send(hop(`http://${base}/`))),
    outcome(send(hop(`http://${base}/`, { method: "POST", body: "{}" }))),
    outcome(send(hop(`https://${base}/`))),
    outcome(send(hop(`http://${base}/big`, { maxBytes: 10 }))),
    outcome(send(hop(`http://${base}/`, { signal: AbortSignal.abort() }))),
  ]);
  // A connection without Happy Eyeballs asks the lookup for one address.
  setDefaultAutoSelectFamily(false);
  const single = await outcome(send(hop(`http://${base}/`)));
  setDefaultAutoSelectFamily(true);
  expect([...answers, single]).toEqual([
    [200, "GET yes "],
    [200, "POST yes {}"],
    expect.stringMatching(/SSL|TLS|EPROTO|wrong version/i),
    "a response over 10 bytes",
    expect.stringMatching(/abort/i),
    [200, "GET yes "],
  ]);
});
