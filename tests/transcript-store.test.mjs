import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  commitState,
  loadLatestState,
  readShard,
  resolveIndexDir,
} from "../dist/transcript-store.js";
import { makeTempDir } from "./helpers/fixture.mjs";

const CANDIDATE = [1, "2026-11-18T01:00:00.000Z", 5, 1984372, 0, 10, 0, 0, 0, 0];

function newIndexDir() {
  return path.join(makeTempDir("ccbar-store-"), "index");
}

function shardNames(indexDir) {
  return readdirSync(path.join(indexDir, "shards")).sort();
}

test("resolveIndexDir separates caches by projects directory", () => {
  const first = resolveIndexDir("/tmp/cache", "/tmp/projects-a");
  const second = resolveIndexDir("/tmp/cache", "/tmp/projects-b");

  assert.notEqual(first, second);
  assert.equal(path.dirname(first), "/tmp/cache");
  assert.equal(first, resolveIndexDir("/tmp/cache", "/tmp/projects-a/"));
});

test("an empty index loads as generation 0 and the first commit becomes generation 1", () => {
  const indexDir = newIndexDir();
  const initial = loadLatestState(indexDir);

  assert.equal(initial.generation, 0);
  assert.deepEqual(initial.state.files, {});

  const committed = commitState(
    indexDir,
    0,
    { ...initial.state, models: ["claude-sonnet-4-6"], projects: ["demo"] },
    new Map([["0a", { "0:m1": [CANDIDATE] }]]),
  );
  const reloaded = loadLatestState(indexDir);

  assert.equal(reloaded.generation, 1);
  assert.deepEqual(reloaded.state, committed);
  assert.deepEqual(readShard(indexDir, committed.shards["0a"]), { "0:m1": [CANDIDATE] });
  assert.deepEqual(readdirSync(indexDir).sort(), ["shards", "state-1.json"]);
});

test("a second commit from the same base loses and leaves nothing behind", () => {
  const indexDir = newIndexDir();
  const base = loadLatestState(indexDir);
  const winner = commitState(indexDir, 0, base.state, new Map([["0a", { "0:m1": [CANDIDATE] }]]));
  const loser = commitState(indexDir, 0, base.state, new Map([["0b", { "0:m2": [CANDIDATE] }]]));

  assert.equal(loser, null);
  assert.deepEqual(readdirSync(indexDir).sort(), ["shards", "state-1.json"]);
  assert.deepEqual(shardNames(indexDir), [winner.shards["0a"]]);
});

test("a committer based on a superseded generation cannot delete live shards", () => {
  const indexDir = newIndexDir();
  const base = loadLatestState(indexDir);
  const first = commitState(indexDir, 0, base.state, new Map([["0a", { "0:m1": [CANDIDATE] }]]));
  const second = commitState(indexDir, 1, first, new Map([["0b", { "0:m2": [CANDIDATE] }]]));

  // state-1.json is gone, so linking generation 1 again succeeds; it must still be rejected
  assert.equal(existsSync(path.join(indexDir, "state-1.json")), false);
  const stale = commitState(indexDir, 0, base.state, new Map([["0a", { "0:m9": [CANDIDATE] }]]));

  assert.equal(stale, null);
  assert.equal(loadLatestState(indexDir).generation, 2);
  assert.deepEqual(readdirSync(indexDir).sort(), ["shards", "state-2.json"]);
  assert.deepEqual(readShard(indexDir, second.shards["0a"]), { "0:m1": [CANDIDATE] });
  assert.deepEqual(readShard(indexDir, second.shards["0b"]), { "0:m2": [CANDIDATE] });

  // the shard it wrote is left for the next publisher to collect
  assert.equal(shardNames(indexDir).length, 3);
  const third = commitState(indexDir, 2, second, new Map());
  assert.deepEqual(shardNames(indexDir), [third.shards["0a"], third.shards["0b"]].sort());
});

test("a commit replaces rewritten shards, drops emptied ones and collects orphans", () => {
  const indexDir = newIndexDir();
  const base = loadLatestState(indexDir);
  const first = commitState(
    indexDir,
    0,
    base.state,
    new Map([
      ["0a", { "0:m1": [CANDIDATE] }],
      ["0b", { "0:m2": [CANDIDATE] }],
      ["0c", { "0:m3": [CANDIDATE] }],
    ]),
  );

  // leftovers of updaters that died before committing generations 1 and 2, and one that
  // is still working towards generation 3
  const shardsDir = path.join(indexDir, "shards");
  writeFileSync(path.join(shardsDir, "0a.1.999999.json"), "{}");
  writeFileSync(path.join(shardsDir, "0d.2.999999.json"), "{}");
  writeFileSync(path.join(shardsDir, "0d.3.999999.json"), "{}");
  writeFileSync(path.join(indexDir, "state-2.999999.tmp"), "{}");
  writeFileSync(path.join(indexDir, "state-3.999999.tmp"), "{}");

  const second = commitState(
    indexDir,
    1,
    first,
    new Map([
      ["0a", { "0:m1": [CANDIDATE], "0:m4": [CANDIDATE] }],
      ["0b", {}],
    ]),
  );

  assert.deepEqual(Object.keys(second.shards).sort(), ["0a", "0c"]);
  assert.notEqual(second.shards["0a"], first.shards["0a"]);
  assert.equal(second.shards["0c"], first.shards["0c"]);
  assert.deepEqual(shardNames(indexDir), ["0d.3.999999.json", second.shards["0a"], second.shards["0c"]].sort());
  assert.deepEqual(readdirSync(indexDir).sort(), ["shards", "state-2.json", "state-3.999999.tmp"]);
});

test("reading a shard that was superseded reports a stale state", () => {
  const indexDir = newIndexDir();
  mkdirSync(path.join(indexDir, "shards"), { recursive: true });

  assert.throws(() => readShard(indexDir, "0a.1.1.json"), { code: "CCBAR_STALE_STATE" });
});

test("a corrupt state file is reported with a stable code and the file it came from", () => {
  const indexDir = newIndexDir();
  commitState(indexDir, 0, loadLatestState(indexDir).state, new Map());
  rmSync(path.join(indexDir, "state-1.json"));
  writeFileSync(path.join(indexDir, "state-1.json"), '{"files": {');

  assert.throws(() => loadLatestState(indexDir), {
    code: "CCBAR_CACHE_CORRUPT",
    filePath: path.join(indexDir, "state-1.json"),
  });
});
