import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { scanTokenStats } from "../dist/transcript.js";
import { makeTempDir, usageLine, writeLines } from "./helpers/fixture.mjs";

test("scanTokenStats keeps the latest record for the same message id", async () => {
  const tmpdir = makeTempDir("ccbar-transcript-");
  const projectsDir = path.join(tmpdir, "projects");

  writeLines(path.join(projectsDir, "demo-project", "session.jsonl"), [
    usageLine({ id: "m1", ts: "2026-03-19T10:00:00Z", input: 1, output: 1 }),
    usageLine({ id: "m1", ts: "2026-03-19T10:00:01Z", input: 1, output: 5 }),
  ]);

  const stats = await scanTokenStats(
    projectsDir,
    path.join(tmpdir, "cache"),
    new Date("2026-03-19T12:00:00Z"),
  );

  assert.equal(stats.all_tok, 6);
});

test("scanTokenStats deduplicates message ids across project files", async () => {
  const tmpdir = makeTempDir("ccbar-transcript-");
  const projectsDir = path.join(tmpdir, "projects");
  const projectDir = path.join(projectsDir, "demo-project");
  const line = usageLine({ id: "msg_same", ts: "2026-03-14T10:00:00Z", input: 1000, output: 200 });

  writeLines(path.join(projectDir, "parent.jsonl"), [line]);
  writeLines(path.join(projectDir, "subagents", "child.jsonl"), [line]);

  const stats = await scanTokenStats(
    projectsDir,
    path.join(tmpdir, "cache"),
    new Date("2026-03-14T12:00:00Z"),
  );

  assert.equal(stats.all_tok, 1200);
  assert.equal(Number(stats.all_cost.toFixed(6)), 0.006);
  assert.equal(stats.projects["demo-project"].all_tok, 1200);
});

test("scanTokenStats returns zero totals when the projects directory does not exist", async () => {
  const tmpdir = makeTempDir("ccbar-transcript-");
  const stats = await scanTokenStats(
    path.join(tmpdir, "missing"),
    path.join(tmpdir, "cache"),
    new Date("2026-03-14T12:00:00Z"),
  );

  assert.equal(stats.all_tok, 0);
  assert.deepEqual(stats.projects, {});
});

test("scanTokenStats reads lines longer than one read chunk", async () => {
  const tmpdir = makeTempDir("ccbar-transcript-");
  const projectsDir = path.join(tmpdir, "projects");
  const padding = JSON.stringify({ type: "user", message: { content: "x".repeat(3 * 1024 * 1024) } });
  const bigUsage = JSON.stringify({
    type: "assistant",
    timestamp: "2026-03-14T10:00:00Z",
    message: {
      id: "big",
      model: "claude-sonnet-4-6",
      content: "y".repeat(2 * 1024 * 1024 + 17),
      usage: { input_tokens: 11, output_tokens: 22 },
    },
  });

  writeLines(path.join(projectsDir, "demo-project", "session.jsonl"), [
    padding,
    bigUsage,
    usageLine({ id: "small", ts: "2026-03-14T10:00:01Z", input: 3, output: 4 }),
  ]);

  const stats = await scanTokenStats(
    projectsDir,
    path.join(tmpdir, "cache"),
    new Date("2026-03-14T12:00:00Z"),
  );

  assert.equal(stats.all_tok, 40);
});
