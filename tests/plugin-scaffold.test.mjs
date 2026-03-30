import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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

test("plugin runtime build artifacts are tracked for marketplace installs", () => {
  const trackedFiles = execFileSync("git", ["ls-files", "dist"], {
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .filter(Boolean);

  assert.equal(trackedFiles.includes("dist/cli.js"), true);
  assert.equal(trackedFiles.includes("dist/config.js"), true);
  assert.equal(trackedFiles.includes("dist/install.js"), true);
  assert.equal(trackedFiles.includes("dist/pricing.js"), true);
  assert.equal(trackedFiles.includes("dist/quota.js"), true);
  assert.equal(trackedFiles.includes("dist/statusline.js"), true);
  assert.equal(trackedFiles.includes("dist/transcript.js"), true);
});
