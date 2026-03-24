import assert from "node:assert/strict";
import test from "node:test";

import {
  pollQuotaWithRetry,
  resolveAuthMode,
  resolveRenderableQuota,
  selectRenderableQuota,
} from "../dist/quota.js";

test("selectRenderableQuota rejects oauth quota when auth mode is api", () => {
  const result = selectRenderableQuota("api", "abc", {
    status: "ok",
    authMethod: "claude.ai",
    tokenFingerprint: "abc",
    fetchedAt: Date.now(),
    quota: {
      five_hour: {
        utilization: 10,
      },
    },
  });

  assert.equal(result, null);
});

test("pollQuotaWithRetry retries 429 responses and wraps quota cache", async () => {
  const attempts = [
    { type: "error", status: 429 },
    { type: "error", status: 429 },
    {
      type: "ok",
      body: {
        five_hour: {
          utilization: 42,
        },
      },
    },
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
        const error = new Error("rate limited");
        error.status = attempt.status;
        throw error;
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

test("resolveRenderableQuota hides cached oauth quota in api mode", async () => {
  const quota = await resolveRenderableQuota({
    readAuthStatus: async () => ({
      authMethod: "api",
    }),
    readCache: async () => ({
      status: "ok",
      authMethod: "claude.ai",
      tokenFingerprint: "abc",
      fetchedAt: Date.now(),
      quota: {
        five_hour: {
          utilization: 42,
        },
      },
    }),
  });

  assert.equal(quota, null);
});

test("resolveRenderableQuota fetches and caches live quota in oauth mode when cache is missing", async () => {
  let writtenCache = null;

  const quota = await resolveRenderableQuota({
    readAuthStatus: async () => ({
      authMethod: "claude.ai",
    }),
    readOauthToken: async () => "token-123",
    readCache: async () => null,
    writeCache: async (cache) => {
      writtenCache = cache;
    },
    fetchQuota: async (token) => {
      assert.equal(token, "token-123");
      return {
        five_hour: {
          utilization: 42,
        },
      };
    },
    now: () => 1234567890,
  });

  assert.equal(quota.five_hour.utilization, 42);
  assert.equal(writtenCache.status, "ok");
  assert.equal(writtenCache.authMethod, "claude.ai");
  assert.equal(writtenCache.fetchedAt, 1234567890);
  assert.equal(writtenCache.quota.five_hour.utilization, 42);
});
