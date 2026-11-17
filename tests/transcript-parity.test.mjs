import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  appendFileSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { scanTokenStats } from "../dist/transcript.js";
import { updateTranscriptIndex } from "../dist/transcript-index.js";
import { resolveIndexDir } from "../dist/transcript-store.js";
import { assertStatsMatch, localIso, makeTempDir, usageLine, writeLines } from "./helpers/fixture.mjs";
import { scanTokenStats as legacyScanTokenStats } from "./helpers/legacy-scan.mjs";

const execFileAsync = promisify(execFile);
const SCAN_CHILD = fileURLToPath(new URL("./helpers/scan-child.mjs", import.meta.url));

// Wednesday 2026-11-18 15:00 local: the week starts Mon 11-16, the month on 11-01.
const NOW = new Date(2026, 10, 18, 15, 0, 0);
const TODAY = (hour, minute = 0, second = 0) => localIso(2026, 11, 18, hour, minute, second);

function buildFixture() {
  const root = makeTempDir("ccbar-parity-");
  const projectsDir = path.join(root, "projects");
  const cacheDir = path.join(root, "cache");
  const file = (...parts) => path.join(projectsDir, ...parts);

  writeLines(file("alpha", "s1.jsonl"), [
    JSON.stringify({ type: "user", timestamp: TODAY(9), message: { role: "user", content: "hi" } }),
    // m1: streamed three times in one file, the last and largest must win
    usageLine({ id: "m1", ts: TODAY(9, 0, 1), input: 100, output: 1, cacheRead: 5000 }),
    usageLine({ id: "m1", ts: TODAY(9, 0, 2), input: 100, output: 40, cacheRead: 5000 }),
    usageLine({ id: "m1", ts: TODAY(9, 0, 3), input: 100, output: 90, cacheRead: 5000 }),
    // same timestamp: the larger output wins, and an equal one replaces (last wins)
    usageLine({ id: "m1b", ts: TODAY(9, 1), input: 7, output: 30 }),
    usageLine({ id: "m1b", ts: TODAY(9, 1), input: 7, output: 20 }),
    usageLine({ id: "m1c", ts: TODAY(9, 2), input: 5, output: 8, cacheRead: 100 }),
    usageLine({ id: "m1c", ts: TODAY(9, 2), input: 5, output: 8, cacheRead: 900 }),
    // identical timestamp and output in three files: the file read last by the full scan wins
    usageLine({ id: "tie", ts: TODAY(9, 3), input: 111, output: 11, cacheRead: 1000 }),
    usageLine({ id: "m2", ts: localIso(2026, 11, 17, 23, 30), input: 200, output: 20 }),
    usageLine({ id: "m3", ts: localIso(2026, 11, 10), input: 300, output: 30 }),
    usageLine({ id: "m4", ts: localIso(2026, 10, 20), input: 400, output: 40 }),
    usageLine({ id: "m4b", ts: localIso(2025, 12, 31, 23, 59), input: 450, output: 45 }),
    usageLine({ id: "m5", ts: TODAY(10), input: 500, output: 50 }),
    usageLine({ id: "m6", ts: TODAY(10, 5, 0), input: 600, output: 10 }),
    usageLine({ id: "m7", ts: TODAY(10, 10, 5), input: 700, output: 70 }),
    usageLine({ id: "p1", ts: TODAY(11), type: "progress", input: 9999, output: 9999 }),
    JSON.stringify({ type: "assistant", timestamp: TODAY(11), message: { usage: { input_tokens: 8888 } } }),
    '{"type":"assistant","message":{"id":"broken","usage":{"input_tokens":7777',
    // an unparseable timestamp sorts after ISO strings, wins the dedupe and counts for nothing
    usageLine({ id: "m8", ts: TODAY(11, 30), input: 800, output: 80 }),
    usageLine({ id: "m8", ts: "not-a-date", input: 800, output: 81 }),
    usageLine({
      id: "m9",
      ts: TODAY(12),
      model: "claude-opus-4-8",
      input: 900,
      output: 90,
      cacheCreate: 3000,
      cache5m: 1000,
      cache1h: 2000,
      cacheRead: 40000,
    }),
    usageLine({ id: "m10", ts: TODAY(12, 5), model: "deepseek-v4-flash", input: 1000, output: 100 }),
    usageLine({ id: "m11", ts: TODAY(12, 10), model: "claude-fable-5-2", input: 11, output: 110, cacheCreate: 4000 }),
    usageLine({ id: "m11b", ts: TODAY(12, 11), model: "<synthetic>" }),
    // one second before and exactly at local midnight of 2026-11-18 in Lord Howe (+11:00),
    // Tokyo (+9:00), Shanghai (+8:00), Kathmandu (+5:45), Kolkata (+5:30), UTC and New York
    ...[
      "2026-11-17T12:59:59.000Z",
      "2026-11-17T13:00:00.000Z",
      "2026-11-17T14:59:59.000Z",
      "2026-11-17T15:00:00.000Z",
      "2026-11-17T15:59:59.000Z",
      "2026-11-17T16:00:00.000Z",
      "2026-11-17T18:14:59.999Z",
      "2026-11-17T18:15:00.000Z",
      "2026-11-17T18:29:59.999Z",
      "2026-11-17T18:30:00.000Z",
      "2026-11-17T23:59:59.999Z",
      "2026-11-18T00:00:00.000Z",
      "2026-11-18T04:59:59.999Z",
      "2026-11-18T05:00:00.000Z",
    ].map((ts, index) => usageLine({ id: `edge-${index}`, ts, input: 10 ** (index % 7), output: 3 + index })),
  ]);
  writeLines(file("alpha", "s2.jsonl"), [
    usageLine({ id: "m5", ts: TODAY(10), input: 500, output: 50 }),
    usageLine({ id: "m6", ts: TODAY(10, 5, 1), input: 600, output: 55 }),
    usageLine({ id: "m12", ts: TODAY(13), input: 1200, output: 120 }),
    usageLine({ id: "tie", ts: TODAY(9, 3), input: 111, output: 11, cacheRead: 5000 }),
  ]);
  writeLines(file("alpha", "s1", "subagents", "agent-a.jsonl"), [
    usageLine({ id: "m7", ts: TODAY(10, 10, 0), input: 700, output: 7 }),
    usageLine({ id: "m13", ts: TODAY(13, 30), model: "claude-haiku-4-5", input: 1300, output: 130 }),
    usageLine({ id: "tie", ts: TODAY(9, 3), input: 111, output: 11, cacheRead: 9000 }),
  ]);
  writeLines(file("beta", "b1.jsonl"), [
    // same message id as project alpha: dedupe is per project, so it counts in both
    usageLine({ id: "m1", ts: TODAY(9, 0, 3), input: 100, output: 90, cacheRead: 5000 }),
    usageLine({ id: "m20", ts: localIso(2026, 11, 16, 0, 0, 1), input: 2000, output: 200 }),
  ]);
  writeLines(file("empty-project", "notes.jsonl"), [
    JSON.stringify({ type: "user", timestamp: TODAY(9), message: { role: "user", content: "no usage" } }),
  ]);
  writeLines(file("stray.jsonl"), [usageLine({ id: "stray", ts: TODAY(9), input: 1, output: 1 })]);

  return { projectsDir, cacheDir, file };
}

async function assertParity({ projectsDir, cacheDir }, label, now = NOW) {
  const incremental = await scanTokenStats(projectsDir, cacheDir, now);
  const legacy = await legacyScanTokenStats(projectsDir, now);

  assertStatsMatch(incremental, legacy, label);
  return incremental;
}

test("cold incremental scan equals the legacy full scan", async () => {
  const fixture = buildFixture();
  const stats = await assertParity(fixture, "cold");

  // m6 is counted once, from s2 (the later record), and m8 contributes nothing
  assert.deepEqual(Object.keys(stats.projects).sort(), ["alpha", "beta"]);
  assert.equal(stats.projects.beta.all_tok, 190 + 2200);
  assert.ok(stats.today_tok > 0 && stats.week_tok > stats.today_tok);
  assert.ok(stats.month_tok > stats.week_tok && stats.all_tok > stats.month_tok);
});

test("appended lines between renders are read incrementally and stay equal to the full scan", async () => {
  const fixture = buildFixture();
  const indexDir = resolveIndexDir(fixture.cacheDir, fixture.projectsDir);
  await assertParity(fixture, "cold");

  const unchanged = updateTranscriptIndex(fixture.projectsDir, indexDir);
  assert.equal(unchanged.summary.bytesRead, 0);
  assert.equal(unchanged.summary.commits, 0);

  const appended =
    `${usageLine({ id: "m1", ts: TODAY(9, 0, 4), input: 100, output: 150, cacheRead: 5000 })}\n` +
    `${usageLine({ id: "m14", ts: TODAY(14), input: 1400, output: 140 })}\n`;
  const partial = usageLine({ id: "m15", ts: TODAY(14, 5), input: 1500, output: 150 });
  appendFileSync(fixture.file("alpha", "s1.jsonl"), appended + partial.slice(0, 40));
  writeLines(fixture.file("alpha", "s3.jsonl"), [
    usageLine({ id: "m6", ts: TODAY(10, 4, 0), input: 600, output: 3 }),
    usageLine({ id: "m16", ts: TODAY(14, 10), input: 1600, output: 160 }),
  ]);

  const second = updateTranscriptIndex(fixture.projectsDir, indexDir);
  const s3Bytes = statSync(fixture.file("alpha", "s3.jsonl")).size;
  assert.equal(second.summary.bytesRead, Buffer.byteLength(appended) + 40 + s3Bytes);
  assert.equal(second.summary.filesRescanned, 0);
  await assertParity(fixture, "after append");

  // the half-written line is completed later and must be counted exactly once
  appendFileSync(fixture.file("alpha", "s1.jsonl"), `${partial.slice(40)}\n`);
  const third = updateTranscriptIndex(fixture.projectsDir, indexDir);
  assert.equal(third.summary.bytesRead, Buffer.byteLength(partial) + 1);
  const stats = await assertParity(fixture, "after completing the partial line");
  assert.equal(stats.projects.alpha.all_tok > 0, true);
});

test("truncated, rewritten, rotated and deleted files are rescanned", async () => {
  const fixture = buildFixture();
  const indexDir = resolveIndexDir(fixture.cacheDir, fixture.projectsDir);
  const before = await assertParity(fixture, "cold");

  // truncation: s2 held the winning m6 record and m12; m6 must fall back to the copy in s1
  writeLines(fixture.file("alpha", "s2.jsonl"), [usageLine({ id: "m5", ts: TODAY(10), input: 500, output: 50 })]);
  const truncated = updateTranscriptIndex(fixture.projectsDir, indexDir);
  assert.equal(truncated.summary.filesRescanned, 1);
  const afterTruncate = await assertParity(fixture, "after truncate");
  assert.equal(afterTruncate.all_tok, before.all_tok - (600 + 55) + (600 + 10) - (1200 + 120));

  // rotation: a new file (new inode) replaces b1 under the same path and is larger
  const rotated = fixture.file("beta", "b1.jsonl.new");
  writeLines(rotated, [
    usageLine({ id: "m21", ts: TODAY(8), input: 2100, output: 210 }),
    usageLine({ id: "m22", ts: TODAY(8, 5), input: 2200, output: 220 }),
    usageLine({ id: "m23", ts: TODAY(8, 10), input: 2300, output: 230 }),
  ]);
  renameSync(rotated, fixture.file("beta", "b1.jsonl"));
  await assertParity(fixture, "after rotate");

  // same size, same inode, new content and mtime
  const s3 = fixture.file("alpha", "s3.jsonl");
  writeLines(s3, [usageLine({ id: "m30", ts: TODAY(7), input: 3000, output: 300 })]);
  await assertParity(fixture, "with s3");
  const s3Stat = statSync(s3);
  writeLines(s3, [usageLine({ id: "m31", ts: TODAY(7), input: 3000, output: 999 })]);
  assert.equal(statSync(s3).size, s3Stat.size);
  utimesSync(s3, s3Stat.atime, new Date(s3Stat.mtimeMs + 5000));
  await assertParity(fixture, "after same-size rewrite");

  // a line is removed from the middle and more lines are appended: the file grows, so
  // only the bytes before the old offset reveal that this was not an append
  const s1 = fixture.file("alpha", "s1.jsonl");
  const s1Lines = readFileSync(s1, "utf8").split("\n").filter(Boolean);
  const withoutM2 = s1Lines.filter((line) => !line.includes('"id":"m2"'));
  assert.equal(withoutM2.length, s1Lines.length - 1);
  writeFileSync(
    s1,
    [
      ...withoutM2,
      usageLine({ id: "m40", ts: TODAY(14, 20), input: 4000, output: 400 }),
      usageLine({ id: "m41", ts: TODAY(14, 21), input: 4100, output: 410 }),
    ]
      .map((line) => `${line}\n`)
      .join(""),
  );
  const rewritten = updateTranscriptIndex(fixture.projectsDir, indexDir);
  assert.equal(rewritten.summary.filesRescanned, 1);
  await assertParity(fixture, "after non-append rewrite");

  // deletion: the subagent file and a whole project disappear
  rmSync(fixture.file("alpha", "s1", "subagents", "agent-a.jsonl"));
  rmSync(fixture.file("beta"), { recursive: true });
  const removed = updateTranscriptIndex(fixture.projectsDir, indexDir);
  assert.equal(removed.summary.filesRemoved, 2);
  const afterDelete = await assertParity(fixture, "after delete");
  assert.deepEqual(Object.keys(afterDelete.projects), ["alpha"]);
});

test("day, week and month buckets are computed at render time from the same cache", async () => {
  const fixture = buildFixture();
  const indexDir = resolveIndexDir(fixture.cacheDir, fixture.projectsDir);
  const today = await assertParity(fixture, "now");

  const laterMoments = [
    new Date(2026, 10, 18, 23, 59, 59),
    new Date(2026, 10, 19, 0, 0, 0),
    new Date(2026, 10, 22, 12, 0, 0),
    new Date(2026, 10, 23, 0, 0, 1),
    new Date(2026, 11, 1, 0, 0, 0),
    new Date(2027, 0, 1, 9, 0, 0),
    new Date(2026, 10, 10, 12, 0, 0),
  ];
  for (const moment of laterMoments) {
    await assertParity(fixture, `now=${moment.toISOString()}`, moment);
  }

  const tomorrow = await scanTokenStats(fixture.projectsDir, fixture.cacheDir, new Date(2026, 10, 19, 0, 0, 0));
  assert.equal(tomorrow.today_tok, 0);
  assert.equal(tomorrow.week_tok, today.week_tok);
  assert.equal(updateTranscriptIndex(fixture.projectsDir, indexDir).summary.bytesRead, 0);
});

test("a cold scan committed in per-file checkpoints equals the full scan", async () => {
  const fixture = buildFixture();
  const indexDir = resolveIndexDir(fixture.cacheDir, fixture.projectsDir);

  // checkpointMs 0 commits after every file, so every prefix of the scan is a committed state
  const result = updateTranscriptIndex(fixture.projectsDir, indexDir, { checkpointMs: 0 });
  assert.ok(result.summary.commits >= 5);
  await assertParity(fixture, "after checkpointed cold scan");
});

test("one cache serves renders in any timezone, including half and quarter hour offsets", async () => {
  const fixture = buildFixture();
  const zones = ["America/New_York", "Asia/Tokyo", "Asia/Kolkata", "Asia/Kathmandu", "Australia/Lord_Howe", "UTC"];

  for (const timeZone of zones) {
    const { stdout } = await execFileAsync(
      process.execPath,
      [SCAN_CHILD, fixture.projectsDir, fixture.cacheDir, NOW.toISOString(), "--with-legacy"],
      { env: { ...process.env, TZ: timeZone } },
    );
    const { incremental, legacy } = JSON.parse(stdout);
    assertStatsMatch(incremental, legacy, timeZone);
  }

  // every zone used the same index: it was built once and never rewritten
  const indexDir = resolveIndexDir(fixture.cacheDir, fixture.projectsDir);
  assert.deepEqual(readdirSync(fixture.cacheDir), [path.basename(indexDir)]);
  assert.deepEqual(
    readdirSync(indexDir).filter((name) => name.startsWith("state-")),
    ["state-1.json"],
  );
});

test("concurrent scans on one cache all return the full-scan totals", async () => {
  const root = makeTempDir("ccbar-concurrent-");
  const projectsDir = path.join(root, "projects");
  const cacheDir = path.join(root, "cache");
  const fileCount = 24;
  let sequence = 0;
  const batch = (fileIndex, count) =>
    Array.from({ length: count }, () => {
      sequence += 1;
      // every seventh record repeats an id that also lives in the neighbouring file
      const id = sequence % 7 === 0 ? `shared-${fileIndex % 5}` : `msg-${sequence}`;
      return usageLine({
        id,
        ts: localIso(2026, 11, 1 + (sequence % 18), 8, sequence % 60, sequence % 50),
        input: sequence,
        output: sequence % 97,
        cacheRead: sequence * 3,
      });
    });

  for (let index = 0; index < fileCount; index += 1) {
    writeLines(path.join(projectsDir, `project-${index % 3}`, `session-${index}.jsonl`), batch(index, 120));
  }

  const runConcurrently = async (label) => {
    const outputs = await Promise.all(
      Array.from({ length: 4 }, () =>
        execFileAsync(process.execPath, [SCAN_CHILD, projectsDir, cacheDir, NOW.toISOString(), "--contend"]),
      ),
    );
    const legacy = await legacyScanTokenStats(projectsDir, NOW);
    for (const { stdout } of outputs) {
      assertStatsMatch(JSON.parse(stdout).incremental, legacy, label);
    }
  };

  await runConcurrently("cold");
  for (let round = 0; round < 3; round += 1) {
    for (let index = round; index < fileCount; index += 4) {
      appendFileSync(
        path.join(projectsDir, `project-${index % 3}`, `session-${index}.jsonl`),
        batch(index, 15).map((line) => `${line}\n`).join(""),
      );
    }
    await runConcurrently(`round ${round}`);
  }

  // after the dust settles one more scan agrees, and no superseded files are left behind
  assertStatsMatch(await scanTokenStats(projectsDir, cacheDir, NOW), await legacyScanTokenStats(projectsDir, NOW));
  const indexDir = resolveIndexDir(cacheDir, projectsDir);
  const stateFiles = readdirSync(indexDir).filter((name) => name.startsWith("state-"));
  assert.equal(stateFiles.length, 1);
  const state = JSON.parse(readFileSync(path.join(indexDir, stateFiles[0]), "utf8"));
  assert.deepEqual(readdirSync(path.join(indexDir, "shards")).sort(), Object.values(state.shards).sort());
});
