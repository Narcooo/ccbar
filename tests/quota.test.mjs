import assert from "node:assert/strict";
import test from "node:test";

import { pollQuotaWithRetry, selectRenderableQuota } from "../dist/quota.js";

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
