import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  AUTH_MODE_TTL_MS,
  QUOTA_CACHE_TTL_MS,
  QUOTA_MAX_STALE_MS,
  isQuotaRefreshDue,
  pollQuotaWithRetry,
  refreshQuota,
  resolveAuthMode,
  selectRenderableQuota,
  tokenFingerprint,
} from "../dist/quota.js";
import {
  QUOTA_LOCK_STALE_MS,
  acquireRefreshLock,
  quotaCachePath,
  quotaLockPath,
  readQuotaCache,
  releaseRefreshLock,
  writeQuotaCache,
} from "../dist/quota-cache.js";
import { makeTempDir } from "./helpers/fixture.mjs";

const NOW = 1_800_000_000_000;
const QUOTA = { five_hour: { utilization: 42 } };

function okCache(overrides = {}) {
  return {
    authMode: "oauth",
    authCheckedAt: NOW,
    tokenFingerprint: tokenFingerprint("token-123"),
    attemptedAt: NOW,
    status: "ok",
    fetchedAt: NOW,
    quota: QUOTA,
    ...overrides,
  };
}

function httpError(status) {
  const error = new Error(`quota request failed with status ${status}`);
  error.status = status;
  return error;
}

test("selectRenderableQuota shows only successfully fetched oauth quota", () => {
  assert.equal(selectRenderableQuota(null, NOW), null);
  assert.deepEqual(selectRenderableQuota(okCache(), NOW), QUOTA);
  assert.equal(selectRenderableQuota(okCache({ authMode: "api" }), NOW), null);
  assert.equal(selectRenderableQuota(okCache({ authMode: "unknown" }), NOW), null);
  assert.equal(
    selectRenderableQuota(
      {
        authMode: "oauth",
        authCheckedAt: NOW,
        tokenFingerprint: "abc",
        attemptedAt: NOW,
        status: "error",
        error: { code: "quota_http_500", message: "boom" },
      },
      NOW,
    ),
    null,
  );
  assert.equal(
    selectRenderableQuota(
      { authMode: "api", authCheckedAt: NOW, tokenFingerprint: "", attemptedAt: NOW, status: "not_applicable" },
      NOW,
    ),
    null,
  );
});

test("selectRenderableQuota keeps showing the last quota while a refresh is pending, up to the staleness bound", () => {
  const cache = okCache();

  assert.deepEqual(selectRenderableQuota(cache, NOW + QUOTA_CACHE_TTL_MS + 1), QUOTA);
  assert.deepEqual(selectRenderableQuota(cache, NOW + QUOTA_MAX_STALE_MS), QUOTA);
  assert.equal(selectRenderableQuota(cache, NOW + QUOTA_MAX_STALE_MS + 1), null);
});

test("isQuotaRefreshDue is driven by the last attempt so failures back off", () => {
  assert.equal(isQuotaRefreshDue(null, NOW), true);
  assert.equal(isQuotaRefreshDue(okCache(), NOW + QUOTA_CACHE_TTL_MS), false);
  assert.equal(isQuotaRefreshDue(okCache(), NOW + QUOTA_CACHE_TTL_MS + 1), true);

  const failed = {
    authMode: "oauth",
    authCheckedAt: NOW,
    tokenFingerprint: "abc",
    attemptedAt: NOW,
    status: "error",
    error: { code: "quota_fetch_failed", message: "offline" },
  };
  assert.equal(isQuotaRefreshDue(failed, NOW + 1_000), false);
  assert.equal(isQuotaRefreshDue(failed, NOW + QUOTA_CACHE_TTL_MS + 1), true);
});

test("pollQuotaWithRetry retries 429 responses and wraps quota cache", async () => {
  const attempts = [
    { type: "error", status: 429 },
    { type: "error", status: 429 },
    { type: "ok", body: { five_hour: { utilization: 42 } } },
  ];
  const sleepCalls = [];

  const result = await pollQuotaWithRetry({
    token: "token-123",
    fetchQuota: async () => {
      const attempt = attempts.shift();
      if (!attempt) {
        throw new Error("unexpected extra attempt");
      }

      if (attempt.type === "error") {
        throw httpError(attempt.status);
      }

      return attempt.body;
    },
    sleep: async (ms) => {
      sleepCalls.push(ms);
    },
    now: () => 1234567890,
  });

  assert.equal(result.status, "ok");
  assert.equal(result.authMethod, "claude.ai");
  assert.equal(result.fetchedAt, 1234567890);
  assert.equal(result.quota.five_hour.utilization, 42);
  assert.equal(typeof result.tokenFingerprint, "string");
  assert.equal(result.tokenFingerprint.length, 16);
  assert.equal(sleepCalls.length, 2);
});

test("resolveAuthMode recognizes claude.ai subscriptions as oauth", async () => {
  const result = await resolveAuthMode({
    readAuthStatus: async () => ({
      authMethod: "claude.ai",
      subscriptionType: "max",
    }),
  });

  assert.equal(result, "oauth");
});

test("refreshQuota fetches live quota in oauth mode", async () => {
  const cache = await refreshQuota(null, {
    now: () => NOW,
    readOauthToken: async () => "token-123",
    readAuthStatus: async () => ({ authMethod: "claude.ai" }),
    fetchQuota: async (token) => {
      assert.equal(token, "token-123");
      return QUOTA;
    },
  });

  assert.deepEqual(cache, okCache());
});

test("refreshQuota never fetches in api mode", async () => {
  const cache = await refreshQuota(okCache({ authCheckedAt: NOW - AUTH_MODE_TTL_MS - 1 }), {
    now: () => NOW,
    readOauthToken: async () => "token-123",
    readAuthStatus: async () => ({ authMethod: "api" }),
    fetchQuota: async () => {
      throw new Error("must not fetch");
    },
  });

  assert.deepEqual(cache, {
    authMode: "api",
    authCheckedAt: NOW,
    tokenFingerprint: tokenFingerprint("token-123"),
    attemptedAt: NOW,
    status: "not_applicable",
  });
});

test("refreshQuota reuses a fresh auth mode and re-reads it when it expires or the token changes", async () => {
  let authReads = 0;
  const deps = (token) => ({
    now: () => NOW,
    readOauthToken: async () => token,
    readAuthStatus: async () => {
      authReads += 1;
      return { authMethod: "claude.ai" };
    },
    fetchQuota: async () => QUOTA,
  });

  const reused = await refreshQuota(okCache({ authCheckedAt: NOW - AUTH_MODE_TTL_MS }), deps("token-123"));
  assert.equal(authReads, 0);
  assert.equal(reused.authCheckedAt, NOW - AUTH_MODE_TTL_MS);

  const expired = await refreshQuota(okCache({ authCheckedAt: NOW - AUTH_MODE_TTL_MS - 1 }), deps("token-123"));
  assert.equal(authReads, 1);
  assert.equal(expired.authCheckedAt, NOW);

  const switched = await refreshQuota(okCache(), deps("token-456"));
  assert.equal(authReads, 2);
  assert.equal(switched.tokenFingerprint, tokenFingerprint("token-456"));
});

test("refreshQuota records failures with a stable code instead of keeping old quota", async () => {
  const run = (overrides) =>
    refreshQuota(okCache({ fetchedAt: NOW - 60_000, attemptedAt: NOW - 60_000 }), {
      now: () => NOW,
      readOauthToken: async () => "token-123",
      readAuthStatus: async () => ({ authMethod: "claude.ai" }),
      sleep: async () => {},
      ...overrides,
    });

  const serverError = await run({
    fetchQuota: async () => {
      throw httpError(500);
    },
  });
  assert.equal(serverError.status, "error");
  assert.equal(serverError.attemptedAt, NOW);
  assert.equal(serverError.error.code, "quota_http_500");
  assert.equal("quota" in serverError, false);

  let rateLimitedAttempts = 0;
  const rateLimited = await run({
    fetchQuota: async () => {
      rateLimitedAttempts += 1;
      throw httpError(429);
    },
  });
  assert.equal(rateLimitedAttempts, 5);
  assert.equal(rateLimited.error.code, "quota_http_429");

  const offline = await run({
    fetchQuota: async () => {
      throw new TypeError("fetch failed");
    },
  });
  assert.equal(offline.error.code, "quota_fetch_failed");
  assert.equal(offline.error.message, "fetch failed");

  const noToken = await run({ readOauthToken: async () => "" });
  assert.equal(noToken.error.code, "oauth_token_missing");
});

test("quota cache round-trips through an atomic write and a missing file reads as null", () => {
  const cacheDir = makeTempDir("ccbar-quota-");
  const cachePath = quotaCachePath(cacheDir);

  assert.equal(readQuotaCache(cachePath), null);
  writeQuotaCache(cachePath, okCache());
  assert.deepEqual(readQuotaCache(cachePath), okCache());
  assert.equal(path.dirname(cachePath), cacheDir);
});

test("a corrupt quota cache fails with a stable code", () => {
  const cacheDir = makeTempDir("ccbar-quota-");
  const cachePath = quotaCachePath(cacheDir);

  writeFileSync(cachePath, "{not json");
  assert.throws(() => readQuotaCache(cachePath), { code: "CCBAR_CACHE_CORRUPT" });
});

test("the refresh lock admits one refresher until it is released or goes stale", () => {
  const lockPath = quotaLockPath(makeTempDir("ccbar-quota-"));

  assert.equal(acquireRefreshLock(lockPath, NOW), true);
  assert.equal(acquireRefreshLock(lockPath, NOW + 1_000), false);
  assert.equal(acquireRefreshLock(lockPath, NOW + QUOTA_LOCK_STALE_MS), false);
  assert.equal(acquireRefreshLock(lockPath, NOW + QUOTA_LOCK_STALE_MS + 1), true);
  assert.equal(acquireRefreshLock(lockPath, NOW + QUOTA_LOCK_STALE_MS + 2), false);

  releaseRefreshLock(lockPath);
  assert.equal(acquireRefreshLock(lockPath, NOW + QUOTA_LOCK_STALE_MS + 3), true);
});
