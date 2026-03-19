import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";

test("plugin scaffold files exist", () => {
  assert.equal(existsSync(".claude-plugin/plugin.json"), true);
  assert.equal(existsSync(".claude-plugin/marketplace.json"), true);
  assert.equal(existsSync("bin/ccbar"), true);
  assert.equal(existsSync("src/cli.ts"), true);
});
