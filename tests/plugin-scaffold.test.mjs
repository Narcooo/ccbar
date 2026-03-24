import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

test("plugin scaffold files exist", () => {
  assert.equal(existsSync(".claude-plugin/plugin.json"), true);
  assert.equal(existsSync(".claude-plugin/marketplace.json"), true);
  assert.equal(existsSync("bin/ccbar"), true);
  assert.equal(existsSync("src/cli.ts"), true);
});

test("plugin manifest version stays aligned with package metadata", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const manifest = JSON.parse(readFileSync(".claude-plugin/plugin.json", "utf8"));

  assert.equal(manifest.version, pkg.version);
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
});

test("marketplace manifest includes a user-facing description", () => {
  const marketplace = JSON.parse(
    readFileSync(".claude-plugin/marketplace.json", "utf8"),
  );

  assert.equal(typeof marketplace.metadata?.description, "string");
  assert.notEqual(marketplace.metadata.description.trim(), "");
});
