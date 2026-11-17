import { createHash, randomBytes } from "node:crypto";
import {
  linkSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { PRIVATE_DIRECTORY_MODE, PRIVATE_FILE_MODE, parseCacheJson } from "./cache-dir.js";

// On-disk transcript index.
//
//   <indexDir>/state-<generation>.json     root: file table, per-day token totals, shard table
//   <indexDir>/shards/<key>.<generation>.<token>.json   message-id candidates, 256 hash shards
//
// Nothing is ever modified in place. An update writes new shard files, then publishes a new
// state file with link(2), which fails if that generation already exists. A state therefore
// only ever references shard files that were complete before it became visible, and an
// update that is killed at any point leaves the previous state intact.

// [fileId, inode, size, mtimeMs, offset, tail]: `offset` is the end of the last complete
// line consumed, `tail` fingerprints the bytes just before it.
export type FileEntry = [number, number, number, number, number, number];

// [input, output, cacheCreation, cacheCreation5m, cacheCreation1h, cacheRead]
export type TokenRow = [number, number, number, number, number, number];

// The best record one file holds for a message id:
// [fileId, timestamp, output, timeSlot | null, modelIndex,
//  input, cacheCreation, cacheCreation5m, cacheCreation1h, cacheRead]
export type Candidate = [
  number,
  string,
  number,
  number | null,
  number,
  number,
  number,
  number,
  number,
  number,
];

// "<projectIndex>:<messageId>" -> candidates, one per file; the first one is the record
// currently counted in the totals.
export type Shard = Record<string, Candidate[]>;

export type IndexState = {
  nextFileId: number;
  // path relative to the projects directory -> entry
  files: Record<string, FileEntry>;
  projects: string[];
  models: string[];
  // projectIndex -> timeSlot -> modelIndex -> tokens
  totals: Record<string, Record<string, Record<string, TokenRow>>>;
  // shard key -> file name under shards/
  shards: Record<string, string>;
};

export class StaleStateError extends Error {
  readonly code = "CCBAR_STALE_STATE";
}

const LAYOUT_VERSION = 1;
// index files are never overwritten: every write creates a file under a new name
const NEW_FILE = { encoding: "utf8", flag: "wx", mode: PRIVATE_FILE_MODE } as const;
const STATE_FILE = /^state-(\d+)\.json$/;
const STATE_TEMP_FILE = /^state-(\d+)\.[0-9a-f]+\.tmp$/;
const SHARD_FILE = /^[0-9a-f]{2}\.(\d+)\.[0-9a-f]+\.json$/;

// Totals are kept per quarter hour of UTC time (timeSlot = epoch ms / TIME_SLOT_MS). Every
// timezone in use is offset from UTC by a multiple of 15 minutes, so local midnight always
// falls on a slot boundary and "today", "this week" and "this month" can be cut out of the
// same index at render time, in whatever timezone the render runs.
export const TIME_SLOT_MS = 15 * 60_000;

export function resolveIndexDir(cacheDir: string, projectsDir: string): string {
  const key = createHash("sha1").update(path.resolve(projectsDir)).digest("hex").slice(0, 12);

  return path.join(cacheDir, `transcripts-v${LAYOUT_VERSION}-${key}`);
}

function emptyState(): IndexState {
  return { nextFileId: 1, files: {}, projects: [], models: [], totals: {}, shards: {} };
}

function publishedGenerations(names: string[]): number[] {
  return names
    .map((name) => STATE_FILE.exec(name))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => Number(match[1]));
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

export function loadLatestState(indexDir: string): { generation: number; state: IndexState } {
  mkdirSync(path.join(indexDir, "shards"), { recursive: true, mode: PRIVATE_DIRECTORY_MODE });

  for (;;) {
    const generations = publishedGenerations(readdirSync(indexDir));
    if (generations.length === 0) {
      return { generation: 0, state: emptyState() };
    }

    const generation = Math.max(...generations);
    const statePath = path.join(indexDir, `state-${generation}.json`);
    let content: string;

    try {
      content = readFileSync(statePath, "utf8");
    } catch (error) {
      if (isMissing(error)) {
        // a newer generation was published and this one collected since the listing
        continue;
      }
      throw error;
    }

    return { generation, state: parseCacheJson(statePath, content) as IndexState };
  }
}

export function readShard(indexDir: string, fileName: string): Shard {
  const shardPath = path.join(indexDir, "shards", fileName);
  let content: string;

  try {
    content = readFileSync(shardPath, "utf8");
  } catch (error) {
    if (isMissing(error)) {
      throw new StaleStateError(`transcript shard ${shardPath} was superseded`, { cause: error });
    }
    throw error;
  }

  return parseCacheJson(shardPath, content) as Shard;
}

function removeFiles(directory: string, names: string[]): void {
  for (const name of names) {
    rmSync(path.join(directory, name), { force: true });
  }
}

// Run by the process that has just published the newest generation: files written for
// that or an earlier generation which the new state does not reference can never be
// published any more. Files for later generations belong to updates still in progress.
function collectSuperseded(
  indexDir: string,
  entries: string[],
  generation: number,
  published: IndexState,
): void {
  const shardsDir = path.join(indexDir, "shards");
  const isSuperseded = (match: RegExpExecArray | null) => match !== null && Number(match[1]) <= generation;
  const referenced = new Set(Object.values(published.shards));

  removeFiles(
    indexDir,
    entries.filter(
      (name) =>
        name !== `state-${generation}.json` &&
        (isSuperseded(STATE_FILE.exec(name)) || isSuperseded(STATE_TEMP_FILE.exec(name))),
    ),
  );
  removeFiles(
    shardsDir,
    readdirSync(shardsDir).filter((name) => !referenced.has(name) && isSuperseded(SHARD_FILE.exec(name))),
  );
}

// Publishes `state` as generation `baseGeneration + 1`, with every shard in `dirtyShards`
// rewritten (an empty shard is dropped). Returns the published state, or null when it is
// not the newest one because another process published; the caller then reloads and
// redoes whatever is still missing from the newer state.
export function commitState(
  indexDir: string,
  baseGeneration: number,
  state: IndexState,
  dirtyShards: Map<string, Shard>,
): IndexState | null {
  const generation = baseGeneration + 1;
  const token = randomBytes(6).toString("hex");
  const shardsDir = path.join(indexDir, "shards");
  const shards = { ...state.shards };
  const writtenShards: string[] = [];

  for (const [key, shard] of dirtyShards) {
    if (Object.keys(shard).length === 0) {
      delete shards[key];
      continue;
    }

    const fileName = `${key}.${generation}.${token}.json`;
    writeFileSync(path.join(shardsDir, fileName), JSON.stringify(shard), NEW_FILE);
    writtenShards.push(fileName);
    shards[key] = fileName;
  }

  const published: IndexState = { ...state, shards };
  const temporaryName = `state-${generation}.${token}.tmp`;
  const stateName = `state-${generation}.json`;
  writeFileSync(path.join(indexDir, temporaryName), JSON.stringify(published), NEW_FILE);

  try {
    linkSync(path.join(indexDir, temporaryName), path.join(indexDir, stateName));
  } catch (error) {
    removeFiles(indexDir, [temporaryName]);
    removeFiles(shardsDir, writtenShards);
    // EEXIST: this generation is already published. ENOENT: its publisher has already
    // collected this process's temporary file as superseded.
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EEXIST" || code === "ENOENT") {
      return null;
    }
    throw error;
  }

  removeFiles(indexDir, [temporaryName]);

  // A newer state file at this point means one of two things. Either this generation had
  // been published before and collected since, so the link above revived a dead name; or
  // the link was genuine and another process has already published on top of it, in which
  // case that newer state references the shards written here. The two cannot be told
  // apart, so nothing but the state file is removed: if the shards are unreferenced, the
  // next publisher collects them.
  const entries = readdirSync(indexDir);
  if (publishedGenerations(entries).some((other) => other > generation)) {
    removeFiles(indexDir, [stateName]);
    return null;
  }

  collectSuperseded(indexDir, entries, generation, published);
  return published;
}
