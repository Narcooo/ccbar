import { createHash, randomBytes } from "node:crypto";
import { linkSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, } from "node:fs";
import path from "node:path";
import { PRIVATE_DIRECTORY_MODE, PRIVATE_FILE_MODE, parseCacheJson } from "./cache-dir.js";
export class StaleStateError extends Error {
    filePath;
    code = "CCBAR_STALE_STATE";
    constructor(filePath, cause) {
        super(`transcript shard ${filePath} was superseded`, { cause });
        this.filePath = filePath;
    }
}
const LAYOUT_VERSION = 1;
// index files are never overwritten: every write creates a file under a new name
const NEW_FILE = { encoding: "utf8", flag: "wx", mode: PRIVATE_FILE_MODE };
const STATE_FILE = /^state-(\d+)\.json$/;
const STATE_TEMP_FILE = /^state-(\d+)\.[0-9a-f]+\.tmp$/;
const SHARD_FILE = /^[0-9a-f]{2}\.(\d+)\.[0-9a-f]+\.json$/;
// Totals are kept per quarter hour of UTC time (timeSlot = epoch ms / TIME_SLOT_MS). Every
// timezone in use is offset from UTC by a multiple of 15 minutes, so local midnight always
// falls on a slot boundary and "today", "this week" and "this month" can be cut out of the
// same index at render time, in whatever timezone the render runs.
export const TIME_SLOT_MS = 15 * 60_000;
export function resolveIndexDir(cacheDir, projectsDir) {
    const key = createHash("sha1").update(path.resolve(projectsDir)).digest("hex").slice(0, 12);
    return path.join(cacheDir, `transcripts-v${LAYOUT_VERSION}-${key}`);
}
function emptyState() {
    return { nextFileId: 1, files: {}, projects: [], models: [], totals: {}, shards: {} };
}
function publishedGenerations(names) {
    return names
        .map((name) => STATE_FILE.exec(name))
        .filter((match) => match !== null)
        .map((match) => Number(match[1]));
}
function isMissing(error) {
    return error.code === "ENOENT";
}
export function loadLatestState(indexDir) {
    mkdirSync(path.join(indexDir, "shards"), { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
    for (;;) {
        const generations = publishedGenerations(readdirSync(indexDir));
        if (generations.length === 0) {
            return { generation: 0, state: emptyState() };
        }
        const generation = Math.max(...generations);
        const statePath = path.join(indexDir, `state-${generation}.json`);
        let content;
        try {
            content = readFileSync(statePath, "utf8");
        }
        catch (error) {
            if (isMissing(error)) {
                // a newer generation was published and this one collected since the listing
                continue;
            }
            throw error;
        }
        return { generation, state: parseCacheJson(statePath, content) };
    }
}
export function readShard(indexDir, fileName) {
    const shardPath = path.join(indexDir, "shards", fileName);
    let content;
    try {
        content = readFileSync(shardPath, "utf8");
    }
    catch (error) {
        if (isMissing(error)) {
            throw new StaleStateError(shardPath, error);
        }
        throw error;
    }
    return parseCacheJson(shardPath, content);
}
function removeFiles(directory, names) {
    for (const name of names) {
        rmSync(path.join(directory, name), { force: true });
    }
}
// Run by the process that has just published the newest generation: files written for
// that or an earlier generation which the new state does not reference can never be
// published any more. Files for later generations belong to updates still in progress.
function collectSuperseded(indexDir, entries, generation, published) {
    const shardsDir = path.join(indexDir, "shards");
    const isSuperseded = (match) => match !== null && Number(match[1]) <= generation;
    const referenced = new Set(Object.values(published.shards));
    removeFiles(indexDir, entries.filter((name) => name !== `state-${generation}.json` &&
        (isSuperseded(STATE_FILE.exec(name)) || isSuperseded(STATE_TEMP_FILE.exec(name)))));
    removeFiles(shardsDir, readdirSync(shardsDir).filter((name) => !referenced.has(name) && isSuperseded(SHARD_FILE.exec(name))));
}
// Publishes `state` as generation `baseGeneration + 1`, with every shard in `dirtyShards`
// rewritten (an empty shard is dropped). Returns the published state, or null when it is
// not the newest one because another process published; the caller then reloads and
// redoes whatever is still missing from the newer state.
export function commitState(indexDir, baseGeneration, state, dirtyShards) {
    const generation = baseGeneration + 1;
    const token = randomBytes(6).toString("hex");
    const shardsDir = path.join(indexDir, "shards");
    const shards = { ...state.shards };
    const writtenShards = [];
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
    const published = { ...state, shards };
    const temporaryName = `state-${generation}.${token}.tmp`;
    const stateName = `state-${generation}.json`;
    writeFileSync(path.join(indexDir, temporaryName), JSON.stringify(published), NEW_FILE);
    try {
        linkSync(path.join(indexDir, temporaryName), path.join(indexDir, stateName));
    }
    catch (error) {
        removeFiles(indexDir, [temporaryName]);
        removeFiles(shardsDir, writtenShards);
        // EEXIST: this generation is already published. ENOENT: its publisher has already
        // collected this process's temporary file as superseded.
        const code = error.code;
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
// Publishes an empty state on top of whatever is there. Every existing state and shard
// file is thereby superseded and collected, and the next update reads the transcripts
// from the start, as on a first run. If another process publishes first, its state stands.
export function discardIndex(indexDir) {
    const newest = Math.max(0, ...publishedGenerations(readdirSync(indexDir)));
    commitState(indexDir, newest, emptyState(), new Map());
}
