import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { main } from "../dist/cli.js";
import { renderStatusline } from "../dist/statusline.js";

const PROJECT_STATS = {
  today_tok: 1200,
  today_cost: 0.006,
  today_ccost: 0,
  today_cr_tok: 0,
  today_in_tok: 1000,
  week_tok: 1200,
  week_cost: 0.006,
  week_ccost: 0,
  week_cr_tok: 0,
  week_in_tok: 1000,
  month_tok: 1200,
  month_cost: 0.006,
  month_ccost: 0,
  all_tok: 1200,
  all_cost: 0.006,
  all_ccost: 0,
  all_cr_tok: 0,
  all_in_tok: 1000,
};

const TOKENS = {
  ...PROJECT_STATS,
  projects: {
    "-tmp-demo": PROJECT_STATS,
  },
};

const INPUT = {
  model: { display_name: "Claude Sonnet 4.6" },
  workspace: {
    current_dir: "/tmp/demo",
    project_dir: "/tmp/demo",
  },
  context_window: {
    used_percentage: 35,
  },
  cost: {
    total_cost_usd: 1.5,
    total_duration_ms: 3_600_000,
    total_lines_added: 10,
    total_lines_removed: 2,
  },
};

test("renderStatusline drops trailing columns on narrow widths without truncating cells", () => {
  const output = renderStatusline(INPUT, {
    tokens: TOKENS,
    quota: null,
    columns: 50,
    now: new Date("2026-03-19T10:00:00Z"),
  });

  assert.equal(output.includes("..."), false);
  assert.equal(output.includes("5h"), true);
  assert.equal(output.includes("sess"), true);
});

test("main reads Claude stdin JSON and writes rendered statusline", async () => {
  const tmpdir = await mkdtemp(path.join(os.tmpdir(), "ccbar-cli-"));
  const projectDir = path.join(tmpdir, "-tmp-demo");
  const entry = {
    timestamp: "2026-03-19T10:00:00Z",
    type: "assistant",
    message: {
      id: "msg1",
      model: "claude-sonnet-4-6",
      usage: {
        input_tokens: 1000,
        output_tokens: 200,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    },
  };
  let stdout = "";
  const previousProjectsDir = process.env.CCBAR_PROJECTS_DIR;

  await mkdir(projectDir, { recursive: true });
  await writeFile(path.join(projectDir, "session.jsonl"), `${JSON.stringify(entry)}\n`, "utf8");
  process.env.CCBAR_PROJECTS_DIR = tmpdir;

  try {
    await main(
      [],
      {
        readStdin: async () => JSON.stringify(INPUT),
        writeStdout: (value) => {
          stdout += value;
        },
      },
    );
  } finally {
    if (previousProjectsDir == null) {
      delete process.env.CCBAR_PROJECTS_DIR;
    } else {
      process.env.CCBAR_PROJECTS_DIR = previousProjectsDir;
    }
  }

  assert.equal(stdout.includes("5h"), true);
  assert.equal(stdout.includes("today"), true);
});
