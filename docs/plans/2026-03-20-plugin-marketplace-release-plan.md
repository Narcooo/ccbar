# ccbar Plugin Marketplace Release Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Prepare `ccbar` for a plugin-marketplace-first release by making the plugin metadata, versioning, and install docs align with Claude Code plugin distribution guidance.

**Architecture:** Keep the runtime unchanged and focus on release-surface correctness. Add regression tests for release metadata, then make the minimum repo changes needed for a stable first plugin release: version alignment, changelog, and docs that distinguish official marketplace install from local development install.

**Tech Stack:** Claude Code plugins, Node.js, TypeScript, Node test runner, Markdown, JSON

---

### Task 1: Add release-readiness regression coverage

**Files:**
- Modify: `tests/plugin-scaffold.test.mjs`
- Modify: `tests/repo-shape.test.mjs`

**Step 1: Write the failing test**

```js
test("plugin manifest version stays aligned with package metadata", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const manifest = JSON.parse(readFileSync(".claude-plugin/plugin.json", "utf8"));

  assert.equal(manifest.version, pkg.version);
});

test("release docs include a changelog and local dev marketplace flow", () => {
  assert.equal(existsSync("CHANGELOG.md"), true);

  const readme = readFileSync("README.md", "utf8");
  assert.equal(readme.includes(".claude-plugin/marketplace.json"), true);
});
```

**Step 2: Run test to verify it fails**

Run: `npm test`

Expected: `FAIL` because `CHANGELOG.md` does not exist and the current docs do not mention the local development marketplace manifest.

**Step 3: Write minimal implementation**

```js
test("plugin manifest version stays aligned with package metadata", () => {
  // assert package/plugin version equality
});

test("release docs include a changelog and local dev marketplace flow", () => {
  // assert changelog exists and README mentions local marketplace path
});
```

**Step 4: Run test to verify it passes**

Run: `npm test`

Expected: the new release-readiness assertions pass alongside the existing plugin tests.

**Step 5: Commit**

```bash
git add tests/plugin-scaffold.test.mjs tests/repo-shape.test.mjs
git commit -m "test: add plugin release readiness coverage"
```

### Task 2: Bump the plugin to its first stable marketplace release

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.claude-plugin/plugin.json`
- Create: `CHANGELOG.md`

**Step 1: Write the failing test**

```js
test("plugin manifest version stays aligned with package metadata", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const manifest = JSON.parse(readFileSync(".claude-plugin/plugin.json", "utf8"));

  assert.equal(manifest.version, pkg.version);
  assert.equal(pkg.version, "1.0.0");
});
```

**Step 2: Run test to verify it fails**

Run: `npm test`

Expected: `FAIL` because the repository still reports `0.2.0` and no changelog exists.

**Step 3: Write minimal implementation**

```json
{
  "version": "1.0.0"
}
```

```md
# Changelog

## 1.0.0 - 2026-03-20
- First stable Claude Code plugin release.
```

**Step 4: Run test to verify it passes**

Run: `npm test`

Expected: version and changelog checks pass.

**Step 5: Commit**

```bash
git add package.json package-lock.json .claude-plugin/plugin.json CHANGELOG.md
git commit -m "chore: prepare 1.0.0 plugin release"
```

### Task 3: Document marketplace-first installation and release posture

**Files:**
- Modify: `README.md`
- Modify: `README_CN.md`

**Step 1: Write the failing test**

```js
test("README documents marketplace-first install and local dev fallback", () => {
  const readme = readFileSync("README.md", "utf8");
  const readmeCn = readFileSync("README_CN.md", "utf8");

  assert.equal(readme.includes("ccbar@claude-plugins-official"), true);
  assert.equal(readmeCn.includes("ccbar@claude-plugins-official"), true);
  assert.equal(readme.includes(".claude-plugin/marketplace.json"), true);
  assert.equal(readmeCn.includes(".claude-plugin/marketplace.json"), true);
});
```

**Step 2: Run test to verify it fails**

Run: `npm test`

Expected: `FAIL` because the READMEs still document a generic `/plugin install ccbar` path only.

**Step 3: Write minimal implementation**

```md
Official marketplace install:
/plugin install ccbar@claude-plugins-official

Before marketplace listing lands, local development install:
/plugin marketplace add /absolute/path/to/.claude-plugin/marketplace.json
/plugin install ccbar@ccbar-dev
```

**Step 4: Run test to verify it passes**

Run: `npm test`

Expected: README coverage passes and the installation story is explicit.

**Step 5: Commit**

```bash
git add README.md README_CN.md
git commit -m "docs: document marketplace-first installation"
```
