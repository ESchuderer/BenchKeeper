import { Transform } from "node:stream";

const EMPTY = Buffer.alloc(0);
const HEADER_LIMIT = 1024;

// The frame's length, when its header names exactly one: vscode-jsonrpc reads the last Content-Length line, so a
// header with two could announce one length to this guard and another to the reader.
const contentLength = (header: Buffer): number | undefined => {
  const lengths = [...header.toString("latin1").matchAll(/^content-length:[ \t]*(\d{1,10})[ \t]*$/gim)];
  const [only] = lengths;
  return lengths.length === 1 && only !== undefined ? Number(only[1]) : undefined;
};

/**
 * The extension's output as the protocol reader may take it. vscode-jsonrpc 10.0.0's reader buffers whatever a frame
 * announces, so this follows the frames (headers, a blank line, then as many bytes as `Content-Length` says), ends the
 * stream at a header over 1 KiB, one without exactly one length, or a frame longer than `limit`, and passes each frame
 * on under a header of its own, so the reader sees the length this guard checked. `admit` may refuse a frame too.
 */
export const framesUpTo = (limit: number, admit: () => string | undefined = () => undefined): Transform => {
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
      // A header that came whole in one chunk is held to the same bound as one that came in pieces.
      if (end > HEADER_LIMIT) return `a frame header over ${HEADER_LIMIT} bytes`;
      const length = contentLength(head.subarray(0, end));
      if (length === undefined) return "a frame without exactly one Content-Length";
      if (length > limit) return `a message over ${limit} bytes`;
      const refused = admit();
      if (refused !== undefined) return refused;
      out.push(Buffer.from(`Content-Length: ${length}\r\n\r\n`, "ascii"));
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
