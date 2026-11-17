import { randomBytes } from "node:crypto";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export class CacheCorruptError extends Error {
  readonly code = "CCBAR_CACHE_CORRUPT";
}

// The cache holds project names, message ids, token counts and quota figures. Claude Code
// keeps its transcripts private to the user, and so does everything derived from them.
export const PRIVATE_DIRECTORY_MODE = 0o700;
export const PRIVATE_FILE_MODE = 0o600;

export function resolveCacheDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.CCBAR_CACHE_DIR ?? path.join(os.homedir(), ".cache", "ccbar");
}

// Several renders can run at once, so readers must never see a half-written file.
export function writeFileAtomic(filePath: string, content: string): void {
  const directory = path.dirname(filePath);
  const temporaryPath = path.join(
    directory,
    `.${path.basename(filePath)}.${randomBytes(6).toString("hex")}.tmp`,
  );

  mkdirSync(directory, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
  writeFileSync(temporaryPath, content, { encoding: "utf8", mode: PRIVATE_FILE_MODE });
  renameSync(temporaryPath, filePath);
}

// Cache files are written only by ccbar, always atomically; content that does not parse
// means the file was damaged, which is reported rather than silently rebuilt.
export function parseCacheJson(filePath: string, content: string): unknown {
  try {
    return JSON.parse(content);
  } catch (error) {
    throw new CacheCorruptError(
      `ccbar cache file is corrupt: ${filePath} (delete ${path.dirname(filePath)} to rebuild it)`,
      { cause: error },
    );
  }
}
