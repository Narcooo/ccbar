import os from "node:os";
import path from "node:path";
export class CacheCorruptError extends Error {
    code = "CCBAR_CACHE_CORRUPT";
}
// The cache holds project names, message ids, token counts and quota figures. Claude Code
// keeps its transcripts private to the user, and so does everything derived from them.
export const PRIVATE_DIRECTORY_MODE = 0o700;
export const PRIVATE_FILE_MODE = 0o600;
export function resolveCacheDir(env = process.env) {
    return env.CCBAR_CACHE_DIR ?? path.join(os.homedir(), ".cache", "ccbar");
}
// Cache files are written only by ccbar, always atomically; content that does not parse
// means the file was damaged, which is reported rather than silently rebuilt.
export function parseCacheJson(filePath, content) {
    try {
        return JSON.parse(content);
    }
    catch (error) {
        throw new CacheCorruptError(`ccbar cache file is corrupt: ${filePath} (delete ${path.dirname(filePath)} to rebuild it)`, { cause: error });
    }
}
