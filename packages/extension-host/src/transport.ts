import { lookup as resolve } from "node:dns";
import { type IncomingMessage, type RequestOptions, request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";

/** One request the host sends for an extension, without following a redirect. */
export type Hop = {
  url: URL;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
  signal: AbortSignal;
  /** The largest answer body taken; a longer one fails the request. */
  maxBytes: number;
};
export type HopAnswer = { status: number; headers: Record<string, string>; body: Buffer };
/** How the host sends a request for an extension. */
export type Transport = (hop: Hop) => Promise<HopAnswer>;

// IPv4 ranges that are no public host (IANA special-purpose registry, https://www.iana.org/assignments/iana-ipv4-special-registry):
// "this network", private, shared (CGNAT), loopback, link-local (cloud metadata), protocol assignments, documentation,
// 6to4 relay, benchmarking, and multicast with reserved and broadcast above it.
const closed4 = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 3],
] as const) {
  closed4.addSubnet(network, prefix, "ipv4");
}
// IPv6: global unicast only (2000::/3), without the ranges in it that carry an IPv4 address or are no host (Teredo and
// the other protocol assignments, documentation, 6to4; https://www.iana.org/assignments/iana-ipv6-special-registry).
// Outside it are loopback, IPv4-mapped and NAT64 addresses, unique-local, link-local and multicast.
const global6 = new BlockList();
global6.addSubnet("2000::", 3, "ipv6");
const closed6 = new BlockList();
for (const [network, prefix] of [
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
] as const) {
  closed6.addSubnet(network, prefix, "ipv6");
}

/**
 * Whether an address is a public host. The host reaches public addresses only, so a granted name that resolves to this
 * machine, the local network or a cloud metadata service reaches none of them (Q-N19).
 */
export const isPublic = (address: string): boolean => {
  const family = isIP(address);
  if (family === 4) return !closed4.check(address, "ipv4");
  return family === 6 && global6.check(address, "ipv6") && !closed6.check(address, "ipv6");
};

// Resolves a name as the connection would and refuses it when any address is not allowed, so the address checked is the
// address connected to (no second lookup a changed DNS answer could slip into).
const checked =
  (allowed: (address: string) => boolean): LookupFunction =>
  (hostname, options, callback) => {
    // On an error Node passes no list; with none, the lookup has answered with at least one address.
    resolve(hostname, { ...options, all: true }, (error, addresses) => {
      if (error !== null) callback(error, "", 0);
      else if (addresses.some(({ address }) => !allowed(address))) {
        callback(new Error(`${hostname} resolves to an address that is not public`), "", 0);
      } else if (options.all === true) callback(null, addresses);
      else callback(null, String(addresses[0]?.address), Number(addresses[0]?.family));
    });
  };

// The body, up to `maxBytes`; breaking off the loop destroys the response and its connection.
const bodyOf = async (response: IncomingMessage, maxBytes: number): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of response) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > maxBytes) throw new Error(`a response over ${maxBytes} bytes`);
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
};

// The response to one request, once its headers have come.
const responseOf = (url: URL, options: RequestOptions, body: string | undefined): Promise<IncomingMessage> =>
  new Promise((done, fail) => {
    const send = url.protocol === "https:" ? httpsRequest : httpRequest;
    const request = send(url, options, done);
    request.on("error", fail);
    request.end(body);
  });

/**
 * The transport the host sends with: Node's own HTTP client, a new connection per request, no redirect followed, no
 * proxy, and a TLS connection for `https:` (the grant holds https origins only). `allowed` decides which addresses it
 * connects to: public ones unless a test says otherwise.
 */
export const transport =
  (allowed: (address: string) => boolean = isPublic): Transport =>
  async ({ url, method, headers, body, signal, maxBytes }) => {
    // A literal address is connected to without a lookup.
    const literal = url.hostname.replace(/^\[(.*)\]$/, "$1");
    if (isIP(literal) !== 0 && !allowed(literal)) throw new Error(`${literal} is not a public address`);
    const response = await responseOf(url, { method, headers, signal, lookup: checked(allowed), agent: false }, body);
    return { status: Number(response.statusCode), headers: flat(response), body: await bodyOf(response, maxBytes) };
  };

// Each header once, a repeated one's values joined by commas as RFC 9110 section 5.3 allows.
const flat = (response: IncomingMessage): Record<string, string> =>
  Object.fromEntries(Object.entries(response.headers).map(([name, value]) => [name, String(value)]));
