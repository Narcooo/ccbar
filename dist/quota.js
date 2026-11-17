import { execFile } from "node:child_process";
import crypto from "node:crypto";
import os from "node:os";
import { promisify } from "node:util";
// A refresh is started when the last attempt (successful or not) is older than this.
export const QUOTA_CACHE_TTL_MS = 30_000;
// The last fetched quota stays on screen while a refresh is pending, but never longer
// than this: older numbers are shown as "--" rather than passed off as current.
export const QUOTA_MAX_STALE_MS = 10 * 60_000;
// `claude auth status` is re-run when its last result is older than this, or as soon as
// the OAuth token changes.
export const AUTH_MODE_TTL_MS = 5 * 60_000;
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
        const { stdout } = await execFileAsync("security", ["find-generic-password", "-s", "Claude Code-credentials", "-a", os.userInfo().username, "-w"], {
            // a locked keychain makes `security` wait for an unlock prompt that may never be
            // answered
            timeout: 5_000,
        });
        const parsed = JSON.parse(stdout.trim());
        return parsed.claudeAiOauth?.accessToken ?? "";
    }
    catch {
        return "";
    }
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
export function selectRenderableQuota(cache, nowTs) {
    if (!cache || cache.authMode !== "oauth" || cache.status !== "ok") {
        return null;
    }
    if (nowTs - cache.fetchedAt > QUOTA_MAX_STALE_MS) {
        return null;
    }
    return cache.quota;
}
export function isQuotaRefreshDue(cache, nowTs) {
    return cache === null || nowTs - cache.attemptedAt > QUOTA_CACHE_TTL_MS;
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
function describeFetchFailure(error) {
    const status = typeof error === "object" && error !== null && "status" in error ? error.status : undefined;
    return {
        code: typeof status === "number" ? `quota_http_${status}` : "quota_fetch_failed",
        message: error instanceof Error ? error.message : String(error),
    };
}
function sleepFor(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}
// The slow part of quota display: resolve the auth mode, read the OAuth token and call the
// usage API. It runs in a detached process started by a render, never in the render itself.
// Every outcome, including a failure, becomes the next cache content.
export async function refreshQuota(previous, deps = {}) {
    const now = deps.now ?? (() => Date.now());
    const attemptedAt = now();
    const token = await (deps.readOauthToken ?? readKeychainOauthToken)();
    const fingerprint = tokenFingerprint(token);
    const authIsFresh = previous !== null &&
        previous.tokenFingerprint === fingerprint &&
        attemptedAt - previous.authCheckedAt <= AUTH_MODE_TTL_MS;
    const attempt = {
        authMode: authIsFresh
            ? previous.authMode
            : await resolveAuthMode({ readAuthStatus: deps.readAuthStatus }),
        authCheckedAt: authIsFresh ? previous.authCheckedAt : attemptedAt,
        tokenFingerprint: fingerprint,
        attemptedAt,
    };
    if (attempt.authMode !== "oauth") {
        return { ...attempt, status: "not_applicable" };
    }
    if (!token) {
        return {
            ...attempt,
            status: "error",
            error: { code: "oauth_token_missing", message: "no Claude Code OAuth token found" },
        };
    }
    try {
        const fetched = await pollQuotaWithRetry({
            token,
            fetchQuota: async () => await (deps.fetchQuota ?? fetchQuotaFromApi)(token),
            sleep: deps.sleep ?? sleepFor,
            now,
        });
        return { ...attempt, status: "ok", fetchedAt: fetched.fetchedAt, quota: fetched.quota };
    }
    catch (error) {
        return { ...attempt, status: "error", error: describeFetchFailure(error) };
    }
}
