import { randomBytes } from "node:crypto";
import { appendFileSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
export class CacheCorruptError extends Error {
    filePath;
    code = "CCBAR_CACHE_CORRUPT";
    constructor(filePath, cause) {
        super(`ccbar cache file is corrupt: ${filePath}`, { cause });
        this.filePath = filePath;
    }
}
// The cache holds project names, message ids, token counts and quota figures. Claude Code
// keeps its transcripts private to the user, and so does everything derived from them.
export const PRIVATE_DIRECTORY_MODE = 0o700;
export const PRIVATE_FILE_MODE = 0o600;
export function resolveCacheDir(env = process.env) {
    return env.CCBAR_CACHE_DIR ?? path.join(os.homedir(), ".cache", "ccbar");
}
// Several renders can run at once, so readers must never see a half-written file.
export function writeFileAtomic(filePath, content) {
    const directory = path.dirname(filePath);
    const temporaryPath = path.join(directory, `.${path.basename(filePath)}.${randomBytes(6).toString("hex")}.tmp`);
    mkdirSync(directory, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
    writeFileSync(temporaryPath, content, { encoding: "utf8", mode: PRIVATE_FILE_MODE });
    renameSync(temporaryPath, filePath);
}
// Cache files are written only by ccbar, always atomically; content that does not parse
// means the file was damaged afterwards (in practice: power was lost before it reached
// the disk).
export function parseCacheJson(filePath, content) {
    try {
        return JSON.parse(content);
    }
    catch (error) {
        throw new CacheCorruptError(filePath, error);
    }
}
// Everything in the cache is derived data, so a damaged file is discarded and derived
// again rather than left to break every render. That must not go unnoticed: each time it
// happens, one line with the time, the file and the reason is appended to this log.
export function recordRebuild(cacheDir, error) {
    const entry = {
        at: new Date().toISOString(),
        file: error.filePath,
        error: error.cause instanceof Error ? error.cause.message : String(error.cause),
    };
    mkdirSync(cacheDir, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
    appendFileSync(path.join(cacheDir, "rebuild.log"), `${JSON.stringify(entry)}\n`, {
        encoding: "utf8",
        mode: PRIVATE_FILE_MODE,
    });
}
