import crypto from "node:crypto";

export type AuthMode = "oauth" | "api" | "unknown";

export type RenderableQuota = Record<string, unknown>;

export type QuotaCache = {
  status: "ok" | "error";
  authMethod: string;
  tokenFingerprint: string;
  fetchedAt: number;
  quota: RenderableQuota;
};

type FetchQuota = () => Promise<RenderableQuota>;

type PollQuotaOptions = {
  token: string;
  fetchQuota: FetchQuota;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  maxAttempts?: number;
};

export const QUOTA_CACHE_TTL_MS = 30_000;

export function tokenFingerprint(token: string): string {
  if (!token) {
    return "";
  }

  return crypto.createHash("sha256").update(token).digest("hex").slice(0, 16);
}

export function selectRenderableQuota(
  authMode: AuthMode,
  fingerprint: string,
  cache: QuotaCache | null,
  nowTs: number = Date.now(),
): RenderableQuota | null {
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

function isRateLimitError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    error.status === 429
  );
}

export async function pollQuotaWithRetry({
  token,
  fetchQuota,
  sleep = async () => {},
  now = () => Date.now(),
  maxAttempts = 5,
}: PollQuotaOptions): Promise<QuotaCache> {
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
    } catch (error) {
      if (!isRateLimitError(error) || attempt === maxAttempts - 1) {
        throw error;
      }

      await sleep(1000 + attempt * 1000);
    }
  }

  throw new Error("quota polling exhausted all attempts");
}
