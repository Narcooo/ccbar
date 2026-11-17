import assert from "node:assert/strict";
import { appendFileSync, existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { quotaCachePath, readQuotaCache } from "../dist/quota-cache.js";
import { scanTokenStats } from "../dist/transcript.js";
import { updateTranscriptIndex } from "../dist/transcript-index.js";
import { resolveIndexDir } from "../dist/transcript-store.js";
import { assertStatsMatch, makeTempDir, usageLine, writeLines } from "./helpers/fixture.mjs";
import { scanTokenStats as legacyScanTokenStats } from "./helpers/legacy-scan.mjs";

const NOW = new Date("2026-11-18T07:00:00.000Z");

function buildProjects() {
  const root = makeTempDir("ccbar-rebuild-");
  const projectsDir = path.join(root, "projects");
  const cacheDir = path.join(root, "cache");
  const file = (...parts) => path.join(projectsDir, ...parts);
  const lines = (prefix, count) =>
    Array.from({ length: count }, (_, index) =>
      usageLine({
        id: `${prefix}-${index}`,
        ts: `2026-11-18T01:${String(index % 60).padStart(2, "0")}:00.000Z`,
        input: 100 + index,
        output: 10 + index,
        cacheRead: 1000 * index,
      }),
    );

  writeLines(file("alpha", "one.jsonl"), [...lines("one", 40), ...lines("shared", 5)]);
  writeLines(file("alpha", "two.jsonl"), [...lines("two", 40), ...lines("shared", 5)]);
  writeLines(file("beta", "three.jsonl"), lines("three", 40));

  return { projectsDir, cacheDir, file, indexDir: resolveIndexDir(cacheDir, projectsDir) };
}

function readRebuildLog(cacheDir) {
  const logPath = path.join(cacheDir, "rebuild.log");
  if (!existsSync(logPath)) {
    return [];
  }

  return readFileSync(logPath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function stateFile(indexDir) {
  const name = readdirSync(indexDir).find((entry) => /^state-\d+\.json$/.test(entry));
  return path.join(indexDir, name);
}

function anyShardFile(indexDir) {
  const state = JSON.parse(readFileSync(stateFile(indexDir), "utf8"));
  return path.join(indexDir, "shards", Object.values(state.shards)[0]);
}

function truncate(filePath) {
  const content = readFileSync(filePath, "utf8");
  writeFileSync(filePath, content.slice(0, Math.floor(content.length / 2)));
}

async function assertRenderMatchesFullScan(project) {
  const stats = await scanTokenStats(project.projectsDir, project.cacheDir, NOW);
  assertStatsMatch(stats, await legacyScanTokenStats(project.projectsDir, NOW));

  // the rebuilt index is complete: nothing is left to read
  assert.equal(updateTranscriptIndex(project.projectsDir, project.indexDir).summary.bytesRead, 0);
  return stats;
}

function assertLogged(entry, filePath, errorPattern) {
  assert.equal(entry.file, filePath);
  assert.match(entry.error, errorPattern);
  assert.ok(Math.abs(Date.parse(entry.at) - Date.now()) < 60_000, `timestamp ${entry.at}`);
}

test("a healthy cache writes no rebuild log", async () => {
  const project = buildProjects();

  await assertRenderMatchesFullScan(project);
  await assertRenderMatchesFullScan(project);
  assert.deepEqual(readRebuildLog(project.cacheDir), []);
});

test("a corrupt shard is recorded, discarded and rebuilt from the transcripts", async () => {
  const project = buildProjects();
  await assertRenderMatchesFullScan(project);

  const shard = anyShardFile(project.indexDir);
  truncate(shard);
  // dropping a transcript makes the next render read every shard, including the damaged one
  rmSync(project.file("alpha", "two.jsonl"));

  const stats = await assertRenderMatchesFullScan(project);
  assert.deepEqual(Object.keys(stats.projects).sort(), ["alpha", "beta"]);

  const log = readRebuildLog(project.cacheDir);
  assert.equal(log.length, 1);
  assertLogged(log[0], shard, /JSON/);
  assert.equal(statSync(path.join(project.cacheDir, "rebuild.log")).mode & 0o077, 0);
});

test("a corrupt state file is recorded, discarded and rebuilt from the transcripts", async () => {
  const project = buildProjects();
  await assertRenderMatchesFullScan(project);

  const state = stateFile(project.indexDir);
  truncate(state);
  appendFileSync(
    project.file("beta", "three.jsonl"),
    `${usageLine({ id: "late", ts: "2026-11-18T02:00:00.000Z", input: 7, output: 70 })}\n`,
  );

  await assertRenderMatchesFullScan(project);

  const log = readRebuildLog(project.cacheDir);
  assert.equal(log.length, 1);
  assertLogged(log[0], state, /JSON/);
});

test("a corrupt shard and a corrupt state file together need one rebuild, and a second damage a second one", async () => {
  const project = buildProjects();
  await assertRenderMatchesFullScan(project);

  const state = stateFile(project.indexDir);
  truncate(anyShardFile(project.indexDir));
  writeFileSync(state, "");
  await assertRenderMatchesFullScan(project);
  assert.deepEqual(readRebuildLog(project.cacheDir).map((entry) => entry.file), [state]);

  const shard = anyShardFile(project.indexDir);
  writeFileSync(shard, "\u0000\u0000\u0000");
  rmSync(project.file("alpha", "one.jsonl"));
  await assertRenderMatchesFullScan(project);
  assert.deepEqual(readRebuildLog(project.cacheDir).map((entry) => entry.file), [state, shard]);
});

test("a shard file that vanished from the newest index is rebuilt as well", async () => {
  const project = buildProjects();
  await assertRenderMatchesFullScan(project);

  const shard = anyShardFile(project.indexDir);
  rmSync(shard);
  rmSync(project.file("alpha", "two.jsonl"));

  await assertRenderMatchesFullScan(project);

  const log = readRebuildLog(project.cacheDir);
  assert.equal(log.length, 1);
  assertLogged(log[0], shard, /ENOENT/);
});

test("a corrupt quota cache is recorded and discarded, so the next refresh starts from nothing", () => {
  const cacheDir = makeTempDir("ccbar-rebuild-quota-");
  const cachePath = quotaCachePath(cacheDir);

  writeFileSync(cachePath, '{"authMode":"oauth","quota":{"five_hour"');

  assert.equal(readQuotaCache(cachePath), null);
  assert.equal(existsSync(cachePath), false);

  const log = readRebuildLog(cacheDir);
  assert.equal(log.length, 1);
  assertLogged(log[0], cachePath, /JSON/);
  assert.equal(readQuotaCache(cachePath), null);
  assert.equal(readRebuildLog(cacheDir).length, 1);
});
