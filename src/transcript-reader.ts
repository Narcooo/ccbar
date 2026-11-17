import { closeSync, openSync, readSync } from "node:fs";

// One assistant usage record, reduced to the fields the statusline accounts for.
export type UsageRecord = {
  id: string;
  timestamp: string;
  model: string;
  input: number;
  output: number;
  cacheCreation: number;
  cacheCreation5m: number;
  cacheCreation1h: number;
  cacheRead: number;
};

export type ReadResult =
  | { status: "ok"; offset: number; tail: number }
  | { status: "rewritten" }
  | { status: "missing" };

type RawUsage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation?: {
    ephemeral_5m_input_tokens?: number;
    ephemeral_1h_input_tokens?: number;
  };
};

type RawEntry = {
  timestamp?: string;
  type?: string;
  message?: {
    id?: string;
    model?: string;
    usage?: RawUsage;
  };
};

const NEWLINE = 0x0a;
const USAGE_MARKER = Buffer.from('"input_tokens"');
const CHUNK_BYTES = 1 << 20;
const TAIL_BYTES = 64;

function fingerprint(bytes: Buffer): number {
  let hash = 0x811c9dc5;

  for (const byte of bytes) {
    hash = Math.imul(hash ^ byte, 0x01000193);
  }

  return hash >>> 0;
}

// Fingerprint of a file from which nothing has been consumed yet.
export const EMPTY_TAIL = fingerprint(Buffer.alloc(0));

function lastBytes(pieces: Buffer[], count: number): Buffer {
  const picked: Buffer[] = [];
  let remaining = count;

  for (let index = pieces.length - 1; index >= 0 && remaining > 0; index -= 1) {
    const piece = pieces[index];
    const taken = piece.subarray(Math.max(0, piece.length - remaining));
    picked.unshift(taken);
    remaining -= taken.length;
  }

  return Buffer.concat(picked);
}

function parseUsageRecord(line: Buffer): UsageRecord | null {
  if (line.indexOf(USAGE_MARKER) === -1) {
    return null;
  }

  let entry: RawEntry;
  try {
    entry = JSON.parse(line.toString("utf8")) as RawEntry;
  } catch {
    // A line that is not valid JSON (for example one cut short by a crash and then
    // appended to) has never counted as a usage record.
    return null;
  }

  const id = entry.message?.id;
  const usage = entry.message?.usage;
  const timestamp = entry.timestamp;
  if (
    typeof id !== "string" ||
    !id ||
    !usage ||
    typeof timestamp !== "string" ||
    !timestamp ||
    entry.type === "progress"
  ) {
    return null;
  }

  // Same split as estimateCost: a total without a 5m/1h breakdown is priced as 5m.
  const cacheCreation = usage.cache_creation_input_tokens ?? 0;
  const breakdown5m = usage.cache_creation?.ephemeral_5m_input_tokens ?? 0;
  const cacheCreation1h = usage.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  const cacheCreation5m =
    cacheCreation > 0 && breakdown5m + cacheCreation1h === 0 ? cacheCreation : breakdown5m;

  return {
    id,
    timestamp,
    model: entry.message?.model ?? "",
    input: usage.input_tokens ?? 0,
    output: usage.output_tokens ?? 0,
    cacheCreation,
    cacheCreation5m,
    cacheCreation1h,
    cacheRead: usage.cache_read_input_tokens ?? 0,
  };
}

// Streams the bytes [start, end) of a transcript and reports every usage record on a
// complete, newline-terminated line. `offset` in the result is just past the last complete
// line; an unterminated tail is left for the next read, when the rest of it has been written.
//
// `expectedTail` is the fingerprint of the bytes that preceded `start` when they were
// consumed. They are read again together with the new bytes: if they changed, the file was
// rewritten rather than appended to, nothing is reported and the caller rescans the file.
// This catches every rewrite that moves bytes (a removed or inserted line); an edit that
// keeps those last 64 bytes where they were while the file grows is not detected.
export function readUsageRecords(
  filePath: string,
  start: number,
  end: number,
  expectedTail: number,
  onRecord: (record: UsageRecord) => void,
): ReadResult {
  const seedLength = Math.min(TAIL_BYTES, start);
  let fd: number;

  try {
    fd = openSync(filePath, "r");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { status: "missing" };
    }
    throw error;
  }

  try {
    const chunk = Buffer.allocUnsafe(Math.min(CHUNK_BYTES, end - start + seedLength));
    let position = start - seedLength;
    let consumed = start;
    let tail: Buffer = Buffer.alloc(0);
    let pendingPieces: Buffer[] = [];
    let verified = seedLength === 0;

    while (position < end) {
      const bytesRead = readSync(fd, chunk, 0, Math.min(chunk.length, end - position), position);
      if (bytesRead === 0) {
        break;
      }

      const view = chunk.subarray(0, bytesRead);
      let lineStart = 0;

      if (!verified) {
        tail = Buffer.from(view.subarray(0, seedLength));
        if (tail.length < seedLength || fingerprint(tail) !== expectedTail) {
          return { status: "rewritten" };
        }

        verified = true;
        lineStart = seedLength;
      }

      const firstNewByte = lineStart;
      const carriedPieces = pendingPieces;

      for (;;) {
        const newline = view.indexOf(NEWLINE, lineStart);
        if (newline === -1) {
          break;
        }

        const lineEnd = view.subarray(lineStart, newline);
        const line = pendingPieces.length === 0 ? lineEnd : Buffer.concat([...pendingPieces, lineEnd]);
        pendingPieces = [];

        const record = parseUsageRecord(line);
        if (record) {
          onRecord(record);
        }

        lineStart = newline + 1;
      }

      if (lineStart > firstNewByte) {
        consumed = position + lineStart;
        tail = lastBytes([tail, ...carriedPieces, view.subarray(firstNewByte, lineStart)], TAIL_BYTES);
      }

      if (lineStart < bytesRead) {
        // the chunk buffer is reused by the next read, so the unfinished line is copied out
        pendingPieces.push(Buffer.from(view.subarray(lineStart)));
      }

      position += bytesRead;
    }

    if (!verified) {
      return { status: "rewritten" };
    }

    return { status: "ok", offset: consumed, tail: fingerprint(tail) };
  } finally {
    closeSync(fd);
  }
}
