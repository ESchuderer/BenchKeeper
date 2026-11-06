import { Transform } from "node:stream";

const EMPTY = Buffer.alloc(0);
const HEADER_LIMIT = 1024;

const contentLength = (header: Buffer): number | undefined => {
  const value = /^content-length:[ \t]*(\d{1,10})[ \t]*$/im.exec(header.toString("latin1"))?.[1];
  return value === undefined ? undefined : Number(value);
};

/**
 * The plugin's output as the protocol reader may take it. vscode-jsonrpc 10.0.0's reader buffers whatever a frame
 * announces, so this follows the frames (headers, a blank line, then as many bytes as `Content-Length` says) and ends
 * the stream at a header over 1 KiB, a frame without its length, or one longer than `limit`, before reading its body.
 */
export const framesUpTo = (limit: number): Transform => {
  let header = EMPTY;
  let body = 0;
  // The bytes of `chunk` to pass on, or why the stream must end.
  const consume = (chunk: Buffer): Buffer | string => {
    const out: Buffer[] = [];
    let rest = chunk;
    while (rest.length > 0) {
      const taken = Math.min(body, rest.length);
      out.push(rest.subarray(0, taken));
      [body, rest] = [body - taken, rest.subarray(taken)];
      if (rest.length === 0) break;
      const head = Buffer.concat([header, rest]);
      const end = head.indexOf("\r\n\r\n");
      if (end < 0) {
        header = head;
        return head.length > HEADER_LIMIT ? `a frame header over ${HEADER_LIMIT} bytes` : Buffer.concat(out);
      }
      const length = contentLength(head.subarray(0, end));
      if (length === undefined) return "a frame without its Content-Length";
      if (length > limit) return `a message over ${limit} bytes`;
      out.push(head.subarray(0, end + 4));
      [header, body, rest] = [EMPTY, length, head.subarray(end + 4)];
    }
    return Buffer.concat(out);
  };
  return new Transform({
    transform: (chunk: Buffer, _encoding, done) => {
      const out = consume(chunk);
      if (typeof out === "string") done(new Error(out));
      else done(null, out);
    },
  });
};
