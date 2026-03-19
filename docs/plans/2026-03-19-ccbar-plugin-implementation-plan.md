# ccbar Native Plugin Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rebuild `ccbar` as a native Claude Code plugin in Node.js/TypeScript, with plugin-managed statusline setup and parity for current cost and quota monitoring behavior.

**Architecture:** Replace the Python CLI runtime with a plugin-native TypeScript runtime organized around Claude Code plugin primitives: plugin metadata, slash commands, hooks, and a statusline command entrypoint. Port the existing JSONL scanning, pricing, quota, and rendering logic into isolated TypeScript modules with regression-first tests.

**Tech Stack:** Claude Code plugins, Node.js, TypeScript, npm, Vitest or Node test runner, JSON, Claude transcript JSONL, Anthropic OAuth usage API

---

### Task 1: Scaffold the native plugin package

**Files:**
- Create: `.claude-plugin/plugin.json`
- Create: `.claude-plugin/marketplace.json`
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `src/cli.ts`
- Create: `bin/ccbar`
- Modify: `.gitignore`

**Step 1: Write the failing test**

```ts
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("plugin scaffold", () => {
  it("contains plugin metadata and launcher files", () => {
    expect(existsSync(".claude-plugin/plugin.json")).toBe(true);
    expect(existsSync("bin/ccbar")).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test`

Expected: `FAIL` because the TypeScript/plugin scaffold does not exist yet.

**Step 3: Write minimal implementation**

```json
{
  "name": "ccbar",
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run"
  }
}
```

```ts
export function main(): void {
  process.stdout.write("");
}
```

**Step 4: Run test to verify it passes**

Run: `npm test`

Expected: scaffold presence test passes.

**Step 5: Commit**

```bash
git add .claude-plugin/plugin.json .claude-plugin/marketplace.json package.json tsconfig.json src/cli.ts bin/ccbar .gitignore
git commit -m "chore: scaffold ccbar native plugin"
```

### Task 2: Add settings read/write helpers for plugin-managed statusline setup

**Files:**
- Create: `src/install.ts`
- Create: `tests/install.test.ts`
- Modify: `src/cli.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { applyStatuslineSettings } from "../src/install";

describe("applyStatuslineSettings", () => {
  it("adds ccbar statusLine without deleting unrelated settings", () => {
    const input = { theme: "dark", hooks: { enabled: true } };
    const result = applyStatuslineSettings(input, "/tmp/ccbar");

    expect(result.theme).toBe("dark");
    expect(result.hooks).toEqual({ enabled: true });
    expect(result.statusLine.command).toContain("/tmp/ccbar");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/install.test.ts`

Expected: `FAIL` because settings helpers do not exist yet.

**Step 3: Write minimal implementation**

```ts
export function applyStatuslineSettings(settings: Record<string, unknown>, launcherPath: string) {
  return {
    ...settings,
    statusLine: {
      type: "command",
      command: launcherPath,
      padding: 0,
    },
  };
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/install.test.ts`

Expected: statusline settings test passes.

**Step 5: Commit**

```bash
git add src/install.ts tests/install.test.ts src/cli.ts
git commit -m "feat: add plugin-managed statusline setup helpers"
```

### Task 3: Add slash commands and SessionStart hook for setup and repair

**Files:**
- Create: `commands/setup.md`
- Create: `commands/configure.md`
- Create: `commands/doctor.md`
- Create: `hooks/hooks.json`
- Create: `tests/hooks.test.ts`
- Modify: `.claude-plugin/plugin.json`
- Modify: `src/install.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { shouldRepairStatusline } from "../src/install";

describe("shouldRepairStatusline", () => {
  it("requests repair when statusLine is missing", () => {
    expect(shouldRepairStatusline({})).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/hooks.test.ts`

Expected: `FAIL` because repair logic and hook config are absent.

**Step 3: Write minimal implementation**

```ts
export function shouldRepairStatusline(settings: Record<string, any>): boolean {
  return !settings.statusLine || settings.statusLine.type !== "command";
}
```

```json
{
  "hooks": {
    "SessionStart": [
      {
        "command": "node dist/cli.js repair"
      }
    ]
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/hooks.test.ts`

Expected: repair predicate test passes.

**Step 5: Commit**

```bash
git add commands/setup.md commands/configure.md commands/doctor.md hooks/hooks.json .claude-plugin/plugin.json src/install.ts tests/hooks.test.ts
git commit -m "feat: add plugin commands and session repair hook"
```

### Task 4: Port model pricing and cost-calculation logic

**Files:**
- Create: `src/pricing.ts`
- Create: `tests/pricing.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { estimateCost } from "../src/pricing";

describe("estimateCost", () => {
  it("prices opus output separately from input", () => {
    const result = estimateCost("claude-opus-4-6", {
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    });

    expect(result.baseCost).toBeCloseTo(90, 5);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/pricing.test.ts`

Expected: `FAIL` because pricing logic has not been ported yet.

**Step 3: Write minimal implementation**

```ts
const PRICING_TABLE = {
  "claude-opus-4-6": { in: 15, out: 75, cc5: 18.75, cc1h: 30, cr: 1.5 },
};
```

```ts
export function estimateCost(model: string, usage: Usage) {
  const price = PRICING_TABLE[model];
  const baseCost =
    (usage.input_tokens * price.in) / 1e6 +
    (usage.output_tokens * price.out) / 1e6;
  return { baseCost, cacheReadCost: 0 };
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/pricing.test.ts`

Expected: pricing test passes.

**Step 5: Commit**

```bash
git add src/pricing.ts tests/pricing.test.ts
git commit -m "feat: port model pricing logic"
```

### Task 5: Port transcript scanning and streaming deduplication

**Files:**
- Create: `src/transcript.ts`
- Create: `tests/transcript.test.ts`
- Modify: `src/pricing.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { reduceMessages } from "../src/transcript";

describe("reduceMessages", () => {
  it("keeps the latest record for the same message id", () => {
    const entries = [
      { timestamp: "2026-03-19T10:00:00Z", message: { id: "m1", usage: { input_tokens: 1, output_tokens: 1 } } },
      { timestamp: "2026-03-19T10:00:01Z", message: { id: "m1", usage: { input_tokens: 1, output_tokens: 5 } } },
    ];

    const result = reduceMessages(entries);
    expect(result).toHaveLength(1);
    expect(result[0].message.usage.output_tokens).toBe(5);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/transcript.test.ts`

Expected: `FAIL` because transcript reduction does not exist yet.

**Step 3: Write minimal implementation**

```ts
export function reduceMessages(entries: TranscriptEntry[]) {
  const byId = new Map<string, TranscriptEntry>();
  for (const entry of entries) {
    const id = entry.message?.id;
    if (!id) continue;
    const prev = byId.get(id);
    if (!prev || entry.timestamp >= prev.timestamp) {
      byId.set(id, entry);
    }
  }
  return [...byId.values()];
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/transcript.test.ts`

Expected: transcript dedup test passes.

**Step 5: Commit**

```bash
git add src/transcript.ts tests/transcript.test.ts src/pricing.ts
git commit -m "feat: port transcript deduplication"
```

### Task 6: Port aggregate token and project rollup logic

**Files:**
- Modify: `src/transcript.ts`
- Modify: `tests/transcript.test.ts`

**Step 1: Write the failing test**

```ts
it("aggregates today and project totals separately", () => {
  const result = aggregateStats(fixtures);
  expect(result.today.totalTokens).toBeGreaterThan(0);
  expect(result.projects["my-project"].allTime.totalCost).toBeGreaterThan(0);
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/transcript.test.ts`

Expected: `FAIL` because aggregate rollups are not implemented yet.

**Step 3: Write minimal implementation**

```ts
export function aggregateStats(entries: TranscriptEntry[]) {
  return {
    today: { totalTokens: 0, totalCost: 0 },
    week: { totalTokens: 0, totalCost: 0 },
    month: { totalTokens: 0, totalCost: 0 },
    allTime: { totalTokens: 0, totalCost: 0 },
    projects: {},
  };
}
```

Then fill in the rollup logic using date cuts and per-project grouping.

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/transcript.test.ts`

Expected: aggregate transcript tests pass.

**Step 5: Commit**

```bash
git add src/transcript.ts tests/transcript.test.ts
git commit -m "feat: add aggregate transcript rollups"
```

### Task 7: Port auth-mode detection and quota cache gating

**Files:**
- Create: `src/quota.ts`
- Create: `tests/quota.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { selectRenderableQuota } from "../src/quota";

describe("selectRenderableQuota", () => {
  it("rejects oauth quota when auth mode is api", () => {
    const result = selectRenderableQuota("api", "abc", {
      status: "ok",
      authMethod: "claude.ai",
      tokenFingerprint: "abc",
      fetchedAt: Date.now(),
      quota: { five_hour: { utilization: 10 } },
    });

    expect(result).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/quota.test.ts`

Expected: `FAIL` because quota helpers do not exist yet.

**Step 3: Write minimal implementation**

```ts
export function selectRenderableQuota(
  authMode: "oauth" | "api" | "unknown",
  tokenFingerprint: string,
  cache: QuotaCache | null,
) {
  if (authMode !== "oauth" || !cache) return null;
  if (cache.status !== "ok") return null;
  if (cache.authMethod !== "claude.ai") return null;
  if (cache.tokenFingerprint !== tokenFingerprint) return null;
  return cache.quota;
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/quota.test.ts`

Expected: quota gating test passes.

**Step 5: Commit**

```bash
git add src/quota.ts tests/quota.test.ts
git commit -m "feat: port quota auth gating"
```

### Task 8: Add OAuth usage polling, retry, and cache persistence

**Files:**
- Modify: `src/quota.ts`
- Modify: `tests/quota.test.ts`

**Step 1: Write the failing test**

```ts
it("retries 429 responses and stores wrapped quota cache", async () => {
  const result = await pollQuotaWithRetry(fakeFetchSequence);
  expect(result.status).toBe("ok");
  expect(result.quota.five_hour.utilization).toBe(42);
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/quota.test.ts`

Expected: `FAIL` because retry/cache behavior is missing.

**Step 3: Write minimal implementation**

```ts
for (let attempt = 0; attempt < 5; attempt += 1) {
  try {
    return await fetchQuota();
  } catch (error) {
    if (!isRateLimit(error) || attempt === 4) throw error;
  }
}
```

Then persist successful payloads with auth metadata and timestamps.

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/quota.test.ts`

Expected: retry and cache tests pass.

**Step 5: Commit**

```bash
git add src/quota.ts tests/quota.test.ts
git commit -m "feat: add quota polling and cache persistence"
```

### Task 9: Port adaptive statusline rendering

**Files:**
- Create: `src/render/items.ts`
- Create: `src/render/layout.ts`
- Create: `src/statusline.ts`
- Create: `tests/statusline.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { renderStatusline } from "../src/statusline";

describe("renderStatusline", () => {
  it("drops trailing columns on narrow widths without truncating cell content", () => {
    const output = renderStatusline(fixtureInput, fixtureState, { columns: 50 });
    expect(output.split("\n").length).toBeGreaterThan(0);
    expect(output).not.toContain("...");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/statusline.test.ts`

Expected: `FAIL` because the renderer has not been ported yet.

**Step 3: Write minimal implementation**

```ts
export function renderStatusline() {
  return "ccbar";
}
```

Then port the existing layout, visible-width, ANSI color, and trailing-column-drop behavior.

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/statusline.test.ts`

Expected: renderer tests pass.

**Step 5: Commit**

```bash
git add src/render/items.ts src/render/layout.ts src/statusline.ts tests/statusline.test.ts
git commit -m "feat: port adaptive statusline renderer"
```

### Task 10: Wire the CLI entrypoint and plugin launcher

**Files:**
- Modify: `src/cli.ts`
- Modify: `bin/ccbar`
- Modify: `tests/statusline.test.ts`

**Step 1: Write the failing test**

```ts
it("reads Claude stdin JSON and writes rendered statusline", async () => {
  const result = await runCliWithInput(fixtureInputJson);
  expect(result.stdout).toContain("5h");
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/statusline.test.ts`

Expected: `FAIL` because the CLI is not wired to the renderer.

**Step 3: Write minimal implementation**

```ts
const input = await readStdin();
const output = renderStatusline(JSON.parse(input), await loadRuntimeState());
process.stdout.write(output);
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/statusline.test.ts`

Expected: CLI integration test passes.

**Step 5: Commit**

```bash
git add src/cli.ts bin/ccbar tests/statusline.test.ts
git commit -m "feat: wire plugin launcher to statusline runtime"
```

### Task 11: Rewrite user docs around plugin installation

**Files:**
- Modify: `README.md`
- Modify: `README_CN.md`
- Optionally delete or archive: `pyproject.toml`

**Step 1: Write the failing doc check**

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("README install docs", () => {
  it("documents plugin installation instead of pip install", () => {
    const readme = readFileSync("README.md", "utf8");
    expect(readme).toContain("/plugin install");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test`

Expected: `FAIL` because README still documents `pip install`.

**Step 3: Write minimal implementation**

```md
/plugin marketplace add <marketplace>
/plugin install ccbar
/ccbar:setup
```

Update both READMEs to explain plugin-native install, setup, configure, and doctor flows.

**Step 4: Run test to verify it passes**

Run: `npm test`

Expected: documentation check passes.

**Step 5: Commit**

```bash
git add README.md README_CN.md pyproject.toml
git commit -m "docs: switch ccbar install flow to native plugin"
```

### Task 12: Remove tracked Python runtime and finalize plugin-only release shape

**Files:**
- Delete: `src/ccbar/__init__.py`
- Delete: `src/ccbar/main.py`
- Delete: `tests/test_oauth_cli.py`
- Delete: `tests/test_cost_stats.py`
- Modify: repository root files as needed for Node-only packaging

**Step 1: Write the failing regression check**

```ts
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("runtime shape", () => {
  it("ships plugin-native runtime instead of tracked python implementation", () => {
    expect(existsSync("src/ccbar/main.py")).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test`

Expected: `FAIL` because the tracked Python runtime still exists.

**Step 3: Write minimal implementation**

Delete the tracked Python runtime and obsolete Python-only tests after confirming the TypeScript path has parity coverage.

**Step 4: Run test to verify it passes**

Run: `npm test`

Expected: plugin-native runtime shape test passes and the TypeScript suite stays green.

**Step 5: Commit**

```bash
git add -A
git commit -m "refactor: replace python runtime with native claude plugin"
```
