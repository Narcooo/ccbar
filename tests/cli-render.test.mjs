import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { tokenFingerprint } from "../dist/quota.js";
import { quotaCachePath, quotaLockPath, readQuotaCache, writeQuotaCache } from "../dist/quota-cache.js";
import { localIso, makeTempDir, usageLine, writeLines } from "./helpers/fixture.mjs";

const CLI = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const ANSI = /\u001b\[[0-9;]*m/g;
const INPUT = {
  model: { id: "claude-opus-5-5", display_name: "Opus 5.5" },
  workspace: { current_dir: "/tmp/demo", project_dir: "/tmp/demo" },
  context_window: { used_percentage: 42 },
  cost: { total_cost_usd: 3.45, total_duration_ms: 1_234_567, total_lines_added: 156, total_lines_removed: 23 },
};

function makeEnvironment() {
  const root = makeTempDir("ccbar-cli-render-");
  const projectsDir = path.join(root, "projects");
  const cacheDir = path.join(root, "cache");
  const today = new Date();

  mkdirSync(cacheDir, { recursive: true });
  writeLines(path.join(projectsDir, "-tmp-demo", "session.jsonl"), [
    usageLine({
      id: "msg1",
      ts: localIso(today.getFullYear(), today.getMonth() + 1, today.getDate(), 0, 0, 1),
      input: 1000,
      output: 200,
    }),
  ]);

  return {
    cacheDir,
    // PATH has no `claude` or `security`, so a background refresh cannot reach the network
    env: {
      HOME: root,
      PATH: path.join(root, "no-bin"),
      COLUMNS: "200",
      CCBAR_PROJECTS_DIR: projectsDir,
      CCBAR_CACHE_DIR: cacheDir,
    },
  };
}

function runCli(env, args, stdin) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], { env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`cli exited with ${code}: ${stderr}`));
      }
    });
    child.stdin.end(stdin);
  });
}

async function waitFor(predicate, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("timed out waiting for the background refresh");
}

function seedFreshQuota(cacheDir, fiveHourResetMs = 3_600_000, sevenDayResetMs = 86_400_000) {
  const now = Date.now();
  writeQuotaCache(quotaCachePath(cacheDir), {
    authMode: "oauth",
    authCheckedAt: now,
    tokenFingerprint: tokenFingerprint("token-123"),
    attemptedAt: now,
    status: "ok",
    fetchedAt: now,
    quota: {
      five_hour: { utilization: 17, resets_at: new Date(now + fiveHourResetMs).toISOString() },
      seven_day: { utilization: 40, resets_at: new Date(now + sevenDayResetMs).toISOString() },
    },
  });
}

test("render shows cached quota and token totals without starting a refresh", async () => {
  const { env, cacheDir } = makeEnvironment();
  seedFreshQuota(cacheDir);

  const lines = (await runCli(env, [], JSON.stringify(INPUT))).replaceAll(ANSI, "").split("\n");

  assert.equal(lines.length, 3);
  assert.match(lines[0], /^5h ━─+ 17% +0h5\dm │ today 1\.2k \$0\.01 › proj 1\.2k +\$0\.01 │ week \$0\.01/);
  assert.match(lines[1], /^7d ━+─+ 40% +23h5\dm │ sess \$3\.45/);
  assert.equal(lines[2], "");
  assert.equal(existsSync(quotaLockPath(cacheDir)), false);
});

test("render without a quota cache shows -- and refreshes in a detached process", async () => {
  const { env, cacheDir } = makeEnvironment();

  const output = (await runCli(env, [], JSON.stringify(INPUT))).replaceAll(ANSI, "");

  assert.match(output, /^5h -- │ today 1\.2k/);
  assert.match(output, /\n7d -- │ sess/);

  // the refresher outlives the render, records that auth could not be resolved and unlocks
  await waitFor(() => existsSync(quotaCachePath(cacheDir)) && !existsSync(quotaLockPath(cacheDir)));
  const cache = readQuotaCache(quotaCachePath(cacheDir));
  assert.equal(cache.authMode, "unknown");
  assert.equal(cache.status, "not_applicable");
});

test("everything the render and the refresh write is private to the user", async () => {
  const { env, cacheDir } = makeEnvironment();
  rmSync(cacheDir, { recursive: true });

  await runCli(env, [], JSON.stringify(INPUT));
  await waitFor(() => existsSync(quotaCachePath(cacheDir)) && !existsSync(quotaLockPath(cacheDir)));

  const entries = readdirSync(cacheDir, { recursive: true }).map((name) => path.join(cacheDir, name));
  assert.ok(entries.some((entry) => entry.includes("shards")));
  for (const entry of [cacheDir, ...entries]) {
    assert.equal(statSync(entry).mode & 0o077, 0, `${entry} is readable by other users`);
  }
});

test("--append-model adds the model display name to the first line only", async () => {
  const { env, cacheDir } = makeEnvironment();
  // countdowns far from an hour boundary and no burn-rate projection, so two renders a
  // moment apart print the same text
  const input = JSON.stringify({ ...INPUT, cost: { ...INPUT.cost, total_duration_ms: 0 } });
  seedFreshQuota(cacheDir, 30.5 * 3_600_000, 100.5 * 3_600_000);

  const plain = (await runCli(env, [], input)).split("\n");
  const withModel = (await runCli(env, ["--append-model"], input)).split("\n");

  assert.equal(withModel[0], `${plain[0]} Opus 5.5`);
  assert.deepEqual(withModel.slice(1), plain.slice(1));
});

test("render prints nothing for empty stdin", async () => {
  const { env } = makeEnvironment();

  assert.equal(await runCli(env, ["--append-model"], ""), "");
});
