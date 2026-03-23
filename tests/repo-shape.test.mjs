import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

test("public github marketplace install is documented", () => {
  const marketplace = JSON.parse(readFileSync(".claude-plugin/marketplace.json", "utf8"));
  const readme = readFileSync("README.md", "utf8");
  const readmeCn = readFileSync("README_CN.md", "utf8");

  assert.equal(marketplace.name, "narcooo");
  assert.equal(readme.includes("https://github.com/Narcooo/ccbar"), true);
  assert.equal(readmeCn.includes("https://github.com/Narcooo/ccbar"), true);
  assert.equal(readme.includes("ccbar@narcooo"), true);
  assert.equal(readmeCn.includes("ccbar@narcooo"), true);
});

test("local development uses a distinct dev marketplace manifest and identifier", () => {
  const readme = readFileSync("README.md", "utf8");
  const readmeCn = readFileSync("README_CN.md", "utf8");

  assert.equal(existsSync(".claude-plugin/dev-marketplace/marketplace.json"), true);
  assert.equal(readme.includes(".claude-plugin/dev-marketplace/marketplace.json"), true);
  assert.equal(readmeCn.includes(".claude-plugin/dev-marketplace/marketplace.json"), true);
  assert.equal(readme.includes("ccbar@ccbar-dev"), true);
  assert.equal(readmeCn.includes("ccbar@ccbar-dev"), true);
  assert.equal(readme.includes("ccbar@narcooo"), true);
  assert.equal(readmeCn.includes("ccbar@narcooo"), true);
});

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
  assert.equal(readme.includes(".claude-plugin/dev-marketplace/marketplace.json"), true);
  assert.equal(readmeCn.includes(".claude-plugin/dev-marketplace/marketplace.json"), true);
});

test("READMEs distinguish official, public github, local development, and python debug installs", () => {
  const readme = readFileSync("README.md", "utf8");
  const readmeCn = readFileSync("README_CN.md", "utf8");

  assert.equal(readme.includes("official Claude Code marketplace"), true);
  assert.equal(readme.includes("public GitHub marketplace"), true);
  assert.equal(readme.includes("local development"), true);
  assert.equal(readme.includes("For local debugging only"), true);

  assert.equal(readmeCn.includes("官方 Claude Code 插件市场"), true);
  assert.equal(readmeCn.includes("公开 GitHub marketplace"), true);
  assert.equal(readmeCn.includes("本地开发"), true);
  assert.equal(readmeCn.includes("如果你只是做本地调试"), true);
});

test("release changelog exists", () => {
  assert.equal(existsSync("CHANGELOG.md"), true);
});

test("debug-only python wrapper exists alongside plugin-first install", () => {
  assert.equal(existsSync("ccbar/main.py"), true);
  assert.equal(existsSync("ccbar/__init__.py"), true);
  assert.equal(existsSync("ccbar/__main__.py"), true);
  assert.equal(existsSync("pyproject.toml"), true);

  const readme = readFileSync("README.md", "utf8");
  const readmeCn = readFileSync("README_CN.md", "utf8");
  assert.equal(readme.includes("For local debugging only"), true);
  assert.equal(readmeCn.includes("如果你只是做本地调试"), true);
});
