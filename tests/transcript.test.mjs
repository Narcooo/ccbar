import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { reduceMessages, scanTokenStats } from "../dist/transcript.js";

test("reduceMessages keeps the latest record for the same message id", () => {
  const entries = [
    {
      timestamp: "2026-03-19T10:00:00Z",
      message: {
        id: "m1",
        usage: {
          input_tokens: 1,
          output_tokens: 1,
        },
      },
    },
    {
      timestamp: "2026-03-19T10:00:01Z",
      message: {
        id: "m1",
        usage: {
          input_tokens: 1,
          output_tokens: 5,
        },
      },
    },
  ];

  const result = reduceMessages(entries);

  assert.equal(result.length, 1);
  assert.equal(result[0].message.usage.output_tokens, 5);
});

test("scanTokenStats deduplicates message ids across project files", async () => {
  const tmpdir = await mkdtemp(path.join(os.tmpdir(), "ccbar-transcript-"));
  const projectDir = path.join(tmpdir, "demo-project");
  const usage = {
    input_tokens: 1000,
    output_tokens: 200,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  };
  const entry = {
    timestamp: "2026-03-14T10:00:00Z",
    type: "assistant",
    message: {
      id: "msg_same",
      model: "claude-sonnet-4-6",
      usage,
    },
  };

  await mkdir(path.join(projectDir, "subagents"), { recursive: true });
  await writeFile(path.join(projectDir, "parent.jsonl"), `${JSON.stringify(entry)}\n`, "utf8");
  await writeFile(
    path.join(projectDir, "subagents", "child.jsonl"),
    `${JSON.stringify(entry)}\n`,
    "utf8",
  );

  const stats = await scanTokenStats(tmpdir, new Date("2026-03-14T12:00:00Z"));

  assert.equal(stats.all_tok, 1200);
  assert.equal(Number(stats.all_cost.toFixed(6)), 0.006);
  assert.equal(stats.projects["demo-project"].all_tok, 1200);
});
