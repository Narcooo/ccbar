# Public GitHub Marketplace Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Convert `ccbar`'s repository marketplace from a local development manifest into a public GitHub-backed marketplace so users can install `ccbar` with `/plugin marketplace add https://github.com/Narcooo/ccbar` and `/plugin install ccbar@narcooo`.

**Architecture:** Keep the current single-repository plugin structure. Update `.claude-plugin/marketplace.json` from a development identity to a public marketplace identity, then align tests, README installation paths, and marketplace submission notes with the new GitHub-distribution flow. Preserve the official Anthropic marketplace path and local development path as separate documented modes.

**Tech Stack:** JSON manifests, Markdown docs, Node test runner, Claude plugin validation CLI.

---

### Task 1: Add failing repository-shape tests for the public marketplace contract

**Files:**
- Modify: `tests/repo-shape.test.mjs`
- Reference: `.claude-plugin/marketplace.json`
- Reference: `README.md`
- Reference: `README_CN.md`

**Step 1: Write the failing test**

Add a new test that verifies:

- `.claude-plugin/marketplace.json` has `name: "narcooo"`
- `README.md` mentions `https://github.com/Narcooo/ccbar`
- `README_CN.md` mentions `https://github.com/Narcooo/ccbar`
- both READMEs mention `/plugin install ccbar@narcooo`

Use real file reads, following the existing style:

```js
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
```

**Step 2: Run test to verify it fails**

Run: `node --test tests/repo-shape.test.mjs`
Expected: FAIL because the current marketplace name is `ccbar-dev` and the READMEs do not yet document `ccbar@narcooo`.

**Step 3: Commit**

Do not commit in red state.

### Task 2: Update marketplace identity and make the test pass

**Files:**
- Modify: `.claude-plugin/marketplace.json`
- Test: `tests/repo-shape.test.mjs`

**Step 1: Write minimal implementation**

Update the marketplace manifest to the public identity:

```json
{
  "name": "narcooo",
  "owner": {
    "name": "majunxian"
  },
  "metadata": {
    "description": "Public GitHub marketplace for the ccbar Claude Code plugin."
  },
  "plugins": [
    {
      "name": "ccbar",
      "source": "./",
      "description": "Cost and quota statusline plugin for Claude Code"
    }
  ]
}
```

Keep `plugins[0].source` as `./`.

**Step 2: Run test to verify it passes**

Run: `node --test tests/repo-shape.test.mjs`
Expected: the new public marketplace test passes, or progresses to failing only on README expectations.

**Step 3: Commit**

```bash
git add .claude-plugin/marketplace.json tests/repo-shape.test.mjs
git commit -m "feat: publish public github marketplace metadata"
```

### Task 3: Add failing README assertions for distinct install modes

**Files:**
- Modify: `tests/repo-shape.test.mjs`
- Reference: `README.md`
- Reference: `README_CN.md`

**Step 1: Write the failing test**

Add a test verifying the READMEs distinguish:

- official Anthropic marketplace install
- public GitHub marketplace install
- local development marketplace install
- local Python debug wrapper

Use concrete phrases already intended for the docs, for example:

```js
assert.equal(readme.includes("official Claude Code marketplace"), true);
assert.equal(readme.includes("public GitHub marketplace"), true);
assert.equal(readme.includes("local development"), true);
assert.equal(readme.includes("For local debugging only"), true);
```

Mirror the same idea in Chinese with exact expected phrases.

**Step 2: Run test to verify it fails**

Run: `node --test tests/repo-shape.test.mjs`
Expected: FAIL because the current install section only covers official marketplace, local path install, and Python wrapper.

**Step 3: Commit**

Do not commit in red state.

### Task 4: Rewrite README installation sections for public GitHub marketplace install

**Files:**
- Modify: `README.md`
- Modify: `README_CN.md`
- Test: `tests/repo-shape.test.mjs`

**Step 1: Write minimal documentation changes**

Refactor each README install section into four clearly labeled blocks:

1. Official Anthropic marketplace
2. Public GitHub marketplace
3. Local development marketplace
4. Local Python debug wrapper

The public GitHub marketplace block should use:

```bash
/plugin marketplace add https://github.com/Narcooo/ccbar
/plugin install ccbar@narcooo
/ccbar:setup
```

The local development block should continue to use:

```bash
/plugin marketplace add /absolute/path/to/ccbar
/plugin install ccbar@narcooo
/ccbar:setup
```

If local path installs prove to still need a different marketplace name during verification, update the plan execution notes before broadening the docs.

**Step 2: Run test to verify it passes**

Run: `node --test tests/repo-shape.test.mjs`
Expected: all README-shape assertions pass.

**Step 3: Commit**

```bash
git add README.md README_CN.md tests/repo-shape.test.mjs
git commit -m "docs: add public github marketplace install path"
```

### Task 5: Update marketplace submission notes to distinguish GitHub and official paths

**Files:**
- Modify: `docs/marketplace-submission.md`

**Step 1: Update the submission pack**

Add a short section explaining:

- public GitHub marketplace distribution is available now via `/plugin marketplace add https://github.com/Narcooo/ccbar`
- official Anthropic marketplace submission remains a separate later step
- the public marketplace identifier is `narcooo`

Keep this concise; do not rewrite the whole submission pack.

**Step 2: Run a targeted check**

Run: `rg -n "narcooo|GitHub marketplace|official Anthropic marketplace" docs/marketplace-submission.md`
Expected: the new distinctions appear in the file.

**Step 3: Commit**

```bash
git add docs/marketplace-submission.md
git commit -m "docs: distinguish github and official marketplace release paths"
```

### Task 6: Validate manifests and full test suite

**Files:**
- Verify: `.claude-plugin/plugin.json`
- Verify: `.claude-plugin/marketplace.json`
- Verify: `README.md`
- Verify: `README_CN.md`
- Verify: `tests/repo-shape.test.mjs`
- Verify: `docs/marketplace-submission.md`

**Step 1: Run plugin manifest validation**

Run: `claude plugin validate .claude-plugin/plugin.json`
Expected: PASS

**Step 2: Run marketplace manifest validation**

Run: `claude plugin validate .claude-plugin/marketplace.json`
Expected: PASS

**Step 3: Run full test suite**

Run: `npm test`
Expected: PASS with all tests green.

**Step 4: Review diff**

Run: `git diff --stat master...HEAD`
Expected: changes limited to marketplace manifest, README files, repo-shape test, and submission docs.

**Step 5: Commit any final verification-driven adjustments**

```bash
git add .claude-plugin/marketplace.json README.md README_CN.md tests/repo-shape.test.mjs docs/marketplace-submission.md
git commit -m "chore: finalize public github marketplace release docs"
```
