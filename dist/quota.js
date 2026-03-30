import { execFile } from "node:child_process";
import crypto from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
export const QUOTA_CACHE_TTL_MS = 30_000;
export const QUOTA_CACHE_PATH = path.join(os.tmpdir(), "ccbar-quota.json");
export const QUOTA_API_ENDPOINT = "https://api.anthropic.com/api/oauth/usage";
export const QUOTA_BETA_HEADER = "oauth-2025-04-20";
const execFileAsync = promisify(execFile);
const API_AUTH_METHODS = new Set(["api", "apiKey", "api-key", "accessToken"]);
async function readAuthStatus() {
    try {
        const { stdout } = await execFileAsync("claude", ["auth", "status", "--json"], {
            timeout: 5_000,
        });
        return JSON.parse(stdout);
    }
    catch {
        return null;
    }
}
async function readKeychainOauthToken() {
    try {
        const { stdout } = await execFileAsync("security", ["find-generic-password", "-s", "Claude Code-credentials", "-w"]);
        const parsed = JSON.parse(stdout.trim());
        return parsed.claudeAiOauth?.accessToken ?? "";
    }
    catch {
        return "";
    }
}
async function readQuotaCache(cachePath = QUOTA_CACHE_PATH) {
    try {
        const raw = await readFile(cachePath, "utf8");
        const parsed = JSON.parse(raw);
        if (parsed.status !== "ok" ||
            typeof parsed.authMethod !== "string" ||
            typeof parsed.tokenFingerprint !== "string" ||
            typeof parsed.fetchedAt !== "number" ||
            typeof parsed.quota !== "object" ||
            parsed.quota == null) {
            return null;
        }
        return {
            status: parsed.status,
            authMethod: parsed.authMethod,
            tokenFingerprint: parsed.tokenFingerprint,
            fetchedAt: parsed.fetchedAt,
            quota: parsed.quota,
        };
    }
    catch {
        return null;
    }
}
async function writeQuotaCache(cache, cachePath = QUOTA_CACHE_PATH) {
    await writeFile(`${cachePath}`, `${JSON.stringify(cache)}\n`, "utf8");
}
async function fetchQuotaFromApi(token) {
    const response = await fetch(QUOTA_API_ENDPOINT, {
        headers: {
            Authorization: `Bearer ${token}`,
            "anthropic-beta": QUOTA_BETA_HEADER,
        },
        signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
        const error = new Error(`quota request failed with status ${response.status}`);
        error.status = response.status;
        throw error;
    }
    return await response.json();
}
export function tokenFingerprint(token) {
    if (!token) {
        return "";
    }
    return crypto.createHash("sha256").update(token).digest("hex").slice(0, 16);
}
export async function resolveAuthMode(deps = {}) {
    const status = await (deps.readAuthStatus ?? readAuthStatus)();
    const authMethod = status?.authMethod;
    if (authMethod === "claude.ai") {
        return "oauth";
    }
    if (authMethod && API_AUTH_METHODS.has(authMethod)) {
        return "api";
    }
    return "unknown";
}
export function selectRenderableQuota(authMode, fingerprint, cache, nowTs = Date.now()) {
    if (authMode !== "oauth" || !cache) {
        return null;
    }
    if (cache.status !== "ok") {
        return null;
    }
    if (cache.authMethod !== "claude.ai") {
        return null;
    }
    if (cache.tokenFingerprint !== fingerprint) {
        return null;
    }
    if (nowTs - cache.fetchedAt > QUOTA_CACHE_TTL_MS) {
        return null;
    }
    return cache.quota;
}
function isRateLimitError(error) {
    return (typeof error === "object" &&
        error !== null &&
        "status" in error &&
        error.status === 429);
}
export async function pollQuotaWithRetry({ token, fetchQuota, sleep = async () => { }, now = () => Date.now(), maxAttempts = 5, }) {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        try {
            const quota = await fetchQuota();
            return {
                status: "ok",
                authMethod: "claude.ai",
                tokenFingerprint: tokenFingerprint(token),
                fetchedAt: now(),
                quota,
            };
        }
        catch (error) {
            if (!isRateLimitError(error) || attempt === maxAttempts - 1) {
                throw error;
            }
            await sleep(1000 + attempt * 1000);
        }
    }
    throw new Error("quota polling exhausted all attempts");
}
export async function resolveRenderableQuota(deps = {}) {
    const authMode = await resolveAuthMode({
        readAuthStatus: deps.readAuthStatus,
    });
    if (authMode !== "oauth") {
        return null;
    }
    const token = await (deps.readOauthToken ?? readKeychainOauthToken)();
    if (!token) {
        return null;
    }
    const now = deps.now ?? (() => Date.now());
    const cachedQuota = selectRenderableQuota(authMode, tokenFingerprint(token), await (deps.readCache ?? readQuotaCache)(), now());
    if (cachedQuota) {
        return cachedQuota;
    }
    try {
        const cacheEntry = await pollQuotaWithRetry({
            token,
            fetchQuota: async () => await (deps.fetchQuota ?? fetchQuotaFromApi)(token),
            sleep: deps.sleep,
            now,
        });
        await (deps.writeCache ?? writeQuotaCache)(cacheEntry);
        return cacheEntry.quota;
    }
    catch {
        return null;
    }
}
