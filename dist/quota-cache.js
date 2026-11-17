import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CacheCorruptError, PRIVATE_DIRECTORY_MODE, PRIVATE_FILE_MODE, parseCacheJson, recordRebuild, writeFileAtomic, } from "./cache-dir.js";
// A refresh runs `claude auth status` (5 s timeout) and up to five quota requests (5 s
// timeout each, 10 s of backoff between them). A lock older than that belongs to a
// refresher that died.
export const QUOTA_LOCK_STALE_MS = 60_000;
export function quotaCachePath(cacheDir) {
    return path.join(cacheDir, "quota-v1.json");
}
export function quotaLockPath(cacheDir) {
    return path.join(cacheDir, "quota-refresh.lock");
}
function readIfPresent(filePath) {
    try {
        return readFileSync(filePath, "utf8");
    }
    catch (error) {
        if (error.code === "ENOENT") {
            return null;
        }
        throw error;
    }
}
// A damaged quota cache is recorded and removed. The caller then sees no cache at all,
// which is the state of a first run: the render shows "--" and starts a refresh.
export function readQuotaCache(cachePath) {
    const content = readIfPresent(cachePath);
    if (content === null) {
        return null;
    }
    try {
        return parseCacheJson(cachePath, content);
    }
    catch (error) {
        if (!(error instanceof CacheCorruptError)) {
            throw error;
        }
        recordRebuild(path.dirname(cachePath), error);
        rmSync(cachePath, { force: true });
        return null;
    }
}
export function writeQuotaCache(cachePath, cache) {
    writeFileAtomic(cachePath, `${JSON.stringify(cache)}\n`);
}
function createLock(lockPath, nowTs) {
    try {
        writeFileSync(lockPath, `${nowTs}`, { encoding: "utf8", flag: "wx", mode: PRIVATE_FILE_MODE });
        return true;
    }
    catch (error) {
        if (error.code === "EEXIST") {
            return false;
        }
        throw error;
    }
}
// Renders run concurrently (one per open session); only the one that creates the lock file
// starts a refresh. The lock only prevents duplicate refreshes: if two renders both take
// over a stale lock, the worst case is one extra quota request.
export function acquireRefreshLock(lockPath, nowTs) {
    mkdirSync(path.dirname(lockPath), { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
    if (createLock(lockPath, nowTs)) {
        return true;
    }
    const heldSince = readIfPresent(lockPath);
    if (heldSince === null) {
        // released between the two calls: a refresh has just finished
        return false;
    }
    if (nowTs - Number(heldSince) <= QUOTA_LOCK_STALE_MS) {
        return false;
    }
    rmSync(lockPath, { force: true });
    return createLock(lockPath, nowTs);
}
export function releaseRefreshLock(lockPath) {
    rmSync(lockPath, { force: true });
}
