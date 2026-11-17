import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export function makeTempDir(prefix) {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

// ISO timestamp for a wall-clock time in whatever timezone the test runs in.
export function localIso(year, month, day, hour = 12, minute = 0, second = 0) {
  return new Date(year, month - 1, day, hour, minute, second).toISOString();
}

export function usageLine({
  id,
  ts,
  model = "claude-sonnet-4-6",
  type = "assistant",
  input = 0,
  output = 0,
  cacheCreate = 0,
  cacheRead = 0,
  cache5m,
  cache1h,
}) {
  const usage = {
    input_tokens: input,
    output_tokens: output,
    cache_creation_input_tokens: cacheCreate,
    cache_read_input_tokens: cacheRead,
  };

  if (cache5m != null || cache1h != null) {
    usage.cache_creation = {
      ephemeral_5m_input_tokens: cache5m ?? 0,
      ephemeral_1h_input_tokens: cache1h ?? 0,
    };
  }

  return JSON.stringify({ type, timestamp: ts, message: { id, model, usage } });
}

export function writeLines(filePath, lines) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, lines.map((line) => `${line}\n`).join(""), "utf8");
}

const COST_FIELDS = /_c?cost$/;

function assertBucketMatches(actual, expected, label) {
  for (const [field, expectedValue] of Object.entries(expected)) {
    if (field === "projects") {
      continue;
    }

    const actualValue = actual[field];
    if (COST_FIELDS.test(field)) {
      const tolerance = 1e-9 * Math.max(1, Math.abs(expectedValue));
      assert.ok(
        Math.abs(actualValue - expectedValue) <= tolerance,
        `${label}.${field}: ${actualValue} != ${expectedValue}`,
      );
    } else {
      assert.equal(actualValue, expectedValue, `${label}.${field}`);
    }
  }
}

// Token counts must match exactly; costs are summed in a different order, so they are
// compared to a relative 1e-9.
export function assertStatsMatch(actual, expected, label = "stats") {
  assert.deepEqual(Object.keys(actual.projects), Object.keys(expected.projects), `${label} projects`);
  assertBucketMatches(actual, expected, label);

  for (const [name, bucket] of Object.entries(expected.projects)) {
    assertBucketMatches(actual.projects[name], bucket, `${label}.projects[${name}]`);
  }
}
