// Interleavings of two updaters that timing-based tests cannot hit on purpose. A second
// "process" is run from inside a patched fs.readdirSync, at the exact point where the
// first one lists a directory.
import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import test from "node:test";

import { scanTokenStats } from "../dist/transcript.js";
import { updateTranscriptIndex } from "../dist/transcript-index.js";
import { commitState, loadLatestState, readShard, resolveIndexDir } from "../dist/transcript-store.js";
import { assertStatsMatch, makeTempDir, usageLine, writeLines } from "./helpers/fixture.mjs";
import { scanTokenStats as legacyScanTokenStats } from "./helpers/legacy-scan.mjs";

const NOW = new Date("2026-11-18T07:00:00.000Z");
const CANDIDATE = [1, "2026-11-18T01:00:00.000Z", 5, 1984372, 0, 10, 0, 0, 0, 0];
const realReaddirSync = fs.readdirSync;

// Runs `intruder` once, just before the first listing of `directory`.
function interruptListingOf(directory, intruder) {
  fs.readdirSync = function patchedReaddirSync(target, ...rest) {
    if (target === directory) {
      restoreReaddir();
      intruder();
    }
    return realReaddirSync.call(this, target, ...rest);
  };
  syncBuiltinESMExports();
}

function restoreReaddir() {
  fs.readdirSync = realReaddirSync;
  syncBuiltinESMExports();
}

test("a publisher overtaken before its own check keeps the shards its successor references", () => {
  const indexDir = path.join(makeTempDir("ccbar-race-"), "index");
  const base = loadLatestState(indexDir);

  // A links generation 1; before it looks at the directory again, B builds generation 2 on it
  interruptListingOf(indexDir, () => {
    const latest = loadLatestState(indexDir);
    assert.equal(latest.generation, 1);
    assert.ok(commitState(indexDir, 1, latest.state, new Map([["07", { "0:b": [CANDIDATE] }]])));
  });
  commitState(indexDir, 0, base.state, new Map([["3f", { "0:a": [CANDIDATE] }]]));
  restoreReaddir();

  const newest = loadLatestState(indexDir);
  assert.equal(newest.generation, 2);
  assert.deepEqual(Object.keys(newest.state.shards).sort(), ["07", "3f"]);
  assert.deepEqual(readShard(indexDir, newest.state.shards["3f"]), { "0:a": [CANDIDATE] });
  assert.deepEqual(readShard(indexDir, newest.state.shards["07"]), { "0:b": [CANDIDATE] });
});

function buildProject() {
  const root = makeTempDir("ccbar-race-");
  const projectsDir = path.join(root, "projects");
  const cacheDir = path.join(root, "cache");
  const session = path.join(projectsDir, "demo", "session.jsonl");

  writeLines(session, [
    usageLine({ id: "a", ts: "2026-11-18T01:00:00.000Z", input: 1, output: 10 }),
    usageLine({ id: "b", ts: "2026-11-18T01:00:01.000Z", input: 1, output: 20 }),
  ]);

  return { projectsDir, cacheDir, session, indexDir: resolveIndexDir(cacheDir, projectsDir) };
}

// What a second session's render does while the first one is in the middle of its own.
function otherSessionWritesAndRenders({ projectsDir, session, indexDir }) {
  fs.appendFileSync(session, `${usageLine({ id: "c", ts: "2026-11-18T01:00:02.000Z", input: 1, output: 300 })}\n`);
  writeLines(path.join(projectsDir, "demo", "new-session.jsonl"), [
    usageLine({ id: "d", ts: "2026-11-18T01:00:03.000Z", input: 1, output: 4000 }),
  ]);
  updateTranscriptIndex(projectsDir, indexDir);
}

for (const [moment, directoryOf] of [
  ["loads the index", (project) => project.indexDir],
  ["lists the transcripts", (project) => project.projectsDir],
]) {
  test(`another render publishing just before this one ${moment} never makes it drop records`, async () => {
    const project = buildProject();
    await scanTokenStats(project.projectsDir, project.cacheDir, NOW);

    interruptListingOf(directoryOf(project), () => otherSessionWritesAndRenders(project));
    const stats = await scanTokenStats(project.projectsDir, project.cacheDir, NOW);
    restoreReaddir();

    // this render saw the index of the other one; it must not return less than that index held
    assert.equal(stats.all_tok, 11 + 21 + 301 + 4001);
    assertStatsMatch(stats, await legacyScanTokenStats(project.projectsDir, NOW));

    const settled = updateTranscriptIndex(project.projectsDir, project.indexDir);
    assert.equal(settled.summary.bytesRead, 0);
    assert.equal(settled.state.files[path.join("demo", "session.jsonl")][2], fs.statSync(project.session).size);
  });
}

test("a transcript deleted while the directory is being listed is simply not counted", async () => {
  const project = buildProject();
  const doomed = path.join(project.projectsDir, "demo", "old-session.jsonl");
  writeLines(doomed, [usageLine({ id: "old", ts: "2026-10-01T01:00:00.000Z", input: 5, output: 50 })]);
  await scanTokenStats(project.projectsDir, project.cacheDir, NOW);

  // the listing still names the file; it is gone by the time it is examined
  fs.readdirSync = function patchedReaddirSync(target, ...rest) {
    const entries = realReaddirSync.call(this, target, ...rest);
    if (target === path.join(project.projectsDir, "demo")) {
      restoreReaddir();
      fs.rmSync(doomed);
    }
    return entries;
  };
  syncBuiltinESMExports();
  const stats = await scanTokenStats(project.projectsDir, project.cacheDir, NOW);
  restoreReaddir();

  assert.equal(stats.all_tok, 11 + 21);
  assertStatsMatch(stats, await legacyScanTokenStats(project.projectsDir, NOW));
});

for (const alreadyIndexed of [false, true]) {
  const label = alreadyIndexed ? "an indexed transcript with new lines" : "a new transcript";

  test(`${label} deleted between the listing and the read is not counted`, async () => {
  const project = buildProject();
  const doomed = path.join(project.projectsDir, "demo", "old-session.jsonl");
  writeLines(doomed, [usageLine({ id: "old", ts: "2026-10-01T01:00:00.000Z", input: 5, output: 50 })]);

  if (alreadyIndexed) {
    await scanTokenStats(project.projectsDir, project.cacheDir, NOW);
    fs.appendFileSync(doomed, `${usageLine({ id: "old2", ts: "2026-10-01T02:00:00.000Z", input: 6, output: 60 })}\n`);
  }

  const realOpenSync = fs.openSync;
  fs.openSync = function patchedOpenSync(target, ...rest) {
    if (target === doomed) {
      fs.openSync = realOpenSync;
      syncBuiltinESMExports();
      fs.rmSync(doomed);
    }
    return realOpenSync.call(this, target, ...rest);
  };
  syncBuiltinESMExports();
  const stats = await scanTokenStats(project.projectsDir, project.cacheDir, NOW);
  fs.openSync = realOpenSync;
  syncBuiltinESMExports();

  assert.equal(stats.all_tok, 11 + 21);
  assertStatsMatch(stats, await legacyScanTokenStats(project.projectsDir, NOW));
  assertStatsMatch(
    await scanTokenStats(project.projectsDir, project.cacheDir, NOW),
    await legacyScanTokenStats(project.projectsDir, NOW),
  );
  });
}
