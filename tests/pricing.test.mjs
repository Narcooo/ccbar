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

  assert.equal(Number(result.baseCost.toFixed(6)), 0.0125);
  assert.equal(Number(result.cacheReadCost.toFixed(6)), 0.0001);
});

test("estimateCost prices claude-fable-5 at its own tier", () => {
  const usage = {
    input_tokens: 1000,
    output_tokens: 100,
    cache_creation_input_tokens: 500,
    cache_read_input_tokens: 200,
  };

  const result = estimateCost("claude-fable-5", usage);

  assert.equal(Number(result.baseCost.toFixed(6)), 0.02125);
  assert.equal(Number(result.cacheReadCost.toFixed(6)), 0.0002);
});

test("estimateCost prices claude-opus-4-8 at current opus rates", () => {
  const usage = {
    input_tokens: 1000,
    output_tokens: 100,
    cache_creation_input_tokens: 500,
    cache_read_input_tokens: 200,
  };

  const result = estimateCost("claude-opus-4-8", usage);

  assert.equal(Number(result.baseCost.toFixed(6)), 0.010625);
  assert.equal(Number(result.cacheReadCost.toFixed(6)), 0.0001);
});
