import assert from "node:assert/strict";
import test from "node:test";

import { estimateCost } from "../dist/pricing.js";

test("estimateCost normalizes versioned models and prices 1h cache creation", () => {
  const usage = {
    input_tokens: 1000,
    output_tokens: 100,
    cache_creation_input_tokens: 500,
    cache_read_input_tokens: 200,
    cache_creation: {
      ephemeral_5m_input_tokens: 0,
      ephemeral_1h_input_tokens: 500,
    },
  };

  const result = estimateCost("claude-opus-4-5-20251101", usage);

  assert.equal(Number(result.baseCost.toFixed(6)), 0.0375);
  assert.equal(Number(result.cacheReadCost.toFixed(6)), 0.0003);
});
