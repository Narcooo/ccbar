import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

test("README documents plugin installation instead of pip install", () => {
  const readme = readFileSync("README.md", "utf8");
  const readmeCn = readFileSync("README_CN.md", "utf8");

  assert.equal(readme.includes("/plugin install"), true);
  assert.equal(readmeCn.includes("/plugin install"), true);
});

test("README documents marketplace-first install and local dev fallback", () => {
  const readme = readFileSync("README.md", "utf8");
  const readmeCn = readFileSync("README_CN.md", "utf8");

  assert.equal(readme.includes("ccbar@claude-plugins-official"), true);
  assert.equal(readmeCn.includes("ccbar@claude-plugins-official"), true);
  assert.equal(readme.includes(".claude-plugin/marketplace.json"), true);
  assert.equal(readmeCn.includes(".claude-plugin/marketplace.json"), true);
});

test("release changelog exists", () => {
  assert.equal(existsSync("CHANGELOG.md"), true);
});

test("tracked python runtime is removed", () => {
  assert.equal(existsSync("src/ccbar/main.py"), false);
  assert.equal(existsSync("src/ccbar/__init__.py"), false);
  assert.equal(existsSync("pyproject.toml"), false);
});
